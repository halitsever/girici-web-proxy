import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { siteModePort } from "./support/site-mode.ts";

export const TRAP_PORT = 41999;

/**
 * Browsers send every non-loopback request here, so anything logged is a request that escaped Girici. The
 * subdomain-mode hosts are local, and a browser that hands them to the proxy anyway gets them forwarded. Those are
 * listed apart at /forwarded, which shows whether a browser resolves `*.localhost` itself.
 */
export function startTrapProxy(): Promise<Server> {
  const log: string[] = [];
  const forwarded: string[] = [];
  const server = createServer((req, res) => {
    const list = req.url?.startsWith("/log") ? log : req.url?.startsWith("/forwarded") ? forwarded : null;
    if (list) {
      if (req.method === "DELETE") list.length = 0;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(list));
      return;
    }
    const target = URL.parse(req.url ?? "");
    const port = target && siteModePort(target.hostname, target.port);
    if (target && port) {
      forwarded.push(`${req.method} ${req.url}`);
      forward(req, res, port, target);
      return;
    }
    log.push(`${req.method} ${req.url}`);
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("blocked by the girici e2e trap");
  });
  server.on("connect", (req, socket, head) => {
    const target = URL.parse(`http://${req.url}`);
    const port = target && siteModePort(target.hostname, target.port);
    if (port) {
      forwarded.push(`CONNECT ${req.url}`);
      tunnel(socket, head, port);
      return;
    }
    log.push(`CONNECT ${req.url}`);
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  return new Promise((resolve) => server.listen(TRAP_PORT, "127.0.0.1", () => resolve(server)));
}

/** Keeps the browser's Host header, which the server classifies the request by. */
function forward(req: IncomingMessage, res: ServerResponse, port: number, target: URL): void {
  const headers = { ...req.headers };
  delete headers["proxy-connection"];
  const upstream = request(
    { host: "127.0.0.1", port, method: req.method, path: target.pathname + target.search, headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.statusMessage, answer.rawHeaders);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
}

function tunnel(client: Duplex, head: Buffer, port: number): void {
  const upstream = connect(port, "127.0.0.1", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    client.destroy();
  };
  upstream.on("error", close);
  client.on("error", close);
}
