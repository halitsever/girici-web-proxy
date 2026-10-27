import { createServer, type RequestListener, type Server } from "node:http";

export const MAX_HEADER_SIZE = 65_536;

/** Relay envelopes carry whole cookie and header lists, which outgrow Node's 16 KiB header default. */
export function createHttpServer(app: RequestListener): Server {
  return createServer({ maxHeaderSize: MAX_HEADER_SIZE }, app);
}
