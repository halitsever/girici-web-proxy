import { createServer, type Server } from "node:http";

export const TRAP_PORT = 41999;

/** Browsers send every non-loopback request here, so anything logged is a request that escaped Girici. */
export function startTrapProxy(): Promise<Server> {
  const log: string[] = [];
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/log")) {
      if (req.method === "DELETE") log.length = 0;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(log));
      return;
    }
    log.push(`${req.method} ${req.url}`);
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("blocked by the girici e2e trap");
  });
  server.on("connect", (req, socket) => {
    log.push(`CONNECT ${req.url}`);
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  return new Promise((resolve) => server.listen(TRAP_PORT, "127.0.0.1", () => resolve(server)));
}
