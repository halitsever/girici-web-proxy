import { STATUS_CODES } from "node:http";
import type { ErrorRequestHandler } from "express";
import type { Logger } from "../log.ts";

/** Client errors such as malformed percent-encoding keep their 4xx status; scanners send them constantly. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, next) => {
    const clientStatus = clientErrorStatus(error);
    if (clientStatus === undefined) {
      logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    } else {
      logger.debug(`${clientStatus} ${error instanceof Error ? error.message : String(error)}`);
    }
    // Express closes the connection itself when the response is already underway.
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = clientStatus ?? 500;
    res.status(status).set("Cache-Control", "no-store").type("text/plain").send(STATUS_CODES[status]);
  };
}

function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 499 ? value : undefined;
}
