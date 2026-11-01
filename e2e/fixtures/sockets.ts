import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

const server = new WebSocketServer({ noServer: true });
const closes = new Map<string, { code: number; reason: string }>();

/** How the client closed the echo socket opened with this id, or null while it has not. */
export function socketLog(id: string): { code: number; reason: string } | null {
  return closes.get(id) ?? null;
}

/** The sockets every HTTPS fixture host serves; any other path is refused. */
export function handleSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(req.url ?? "/", "https://fixture");
  if (url.pathname === "/binary-socket") {
    // Lets pages check the type a binary frame reaches them as.
    server.handleUpgrade(req, socket, head, (ws) => ws.send(Buffer.from([1, 2, 3])));
  } else if (url.pathname === "/echo-socket") {
    const headers = { cookie: req.headers.cookie ?? "", origin: req.headers.origin ?? "" };
    server.handleUpgrade(req, socket, head, (ws) => echo(ws, headers, url.searchParams.get("id")));
  } else {
    socket.destroy();
  }
}

/** A few text commands let a test drive the server's side of the socket. */
function echo(ws: WebSocket, headers: { cookie: string; origin: string }, id: string | null): void {
  let serverEnded = false;
  ws.on("message", (data: Buffer, binary: boolean) => {
    if (binary) {
      ws.send(data, { binary: true });
      return;
    }
    const text = data.toString();
    if (text === "cookie?") {
      ws.send("cookie:" + headers.cookie);
    } else if (text === "origin?") {
      ws.send("origin:" + headers.origin);
    } else if (text === "drop") {
      serverEnded = true;
      ws.terminate();
    } else if (text.startsWith("close:")) {
      const [, code, ...reason] = text.split(":");
      serverEnded = true;
      ws.close(Number(code), reason.join(":"));
    } else {
      ws.send(text);
    }
  });
  ws.on("close", (code: number, reason: Buffer) => {
    if (id !== null && !serverEnded) closes.set(id, { code, reason: reason.toString() });
  });
}
