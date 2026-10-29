import { HEADER, type RelayErrorCode } from "@girici/engine/shared";
import type { Response } from "express";

/** The service worker reads the refusal from these headers, whichever layer of the data path refused. */
export function sendRelayError(res: Response, code: RelayErrorCode, status: number): void {
  res.setHeader(HEADER.error, code);
  res.setHeader(HEADER.status, String(status));
  res.setHeader("Cache-Control", "no-store");
  res.status(status).type("text/plain").send(code);
}
