import type { IncomingMessage, ServerResponse } from "node:http";

/** Serves a byte buffer with HTTP range support: 206 for a satisfiable range, 416 otherwise, 200 with no Range. */
export function rangeRoute(body: Buffer, contentType: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const total = body.length;
    const range = parseRange(req.headers.range, total);
    if (range === "unsatisfiable") {
      res.writeHead(416, { "content-range": `bytes */${total}`, "accept-ranges": "bytes" });
      res.end();
      return;
    }
    if (!range) {
      res.writeHead(200, { "content-type": contentType, "accept-ranges": "bytes", "content-length": String(total) });
      res.end(body);
      return;
    }
    const slice = body.subarray(range.start, range.end + 1);
    res.writeHead(206, {
      "content-type": contentType,
      "accept-ranges": "bytes",
      "content-range": `bytes ${range.start}-${range.end}/${total}`,
      "content-length": String(slice.length),
    });
    res.end(slice);
  };
}

/** A never-ending stream plus a check route, so a test can see its own cancelled fetch reach and abort the upstream. */
export function abortableRoutes() {
  // Keyed by the caller's id: one fixture server serves every browser and repeat, so a shared count passes on any earlier abort.
  const aborted = new Set<string>();
  const idOf = (req: IncomingMessage) => new URL(req.url ?? "/", "http://fixture").searchParams.get("id") ?? "";
  const stream = (req: IncomingMessage, res: ServerResponse): void => {
    res.on("close", () => {
      if (!res.writableFinished) aborted.add(idOf(req));
    });
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.write("start");
    // The response is held open on purpose; only the client aborting ends it.
  };
  const check = (req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ aborted: aborted.has(idOf(req)) }));
  };
  return { stream, check };
}

/** Writes one chunk at once and another after a delay, so a test can see the proxy stream the first before the last. */
export function slowStreamRoute(delayMs: number) {
  return (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.write("first");
    setTimeout(() => res.end("last"), delayMs);
  };
}

type Range = { start: number; end: number };

function parseRange(header: string | undefined, total: number): Range | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    // A suffix range such as "bytes=-500" asks for the final bytes.
    const length = Math.min(Number(rawEnd), total);
    return length > 0 ? { start: total - length, end: total - 1 } : "unsatisfiable";
  }
  const start = Number(rawStart);
  if (start >= total) return "unsatisfiable";
  const end = rawEnd === "" ? total - 1 : Math.min(Number(rawEnd), total - 1);
  return { start, end };
}
