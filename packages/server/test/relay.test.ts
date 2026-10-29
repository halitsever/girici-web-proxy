import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { decodeHeaderList, encodeHeaderList, encodeHeaderValue } from "@girici/engine/shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { HostBlocklist } from "../src/upstream/blocklist.ts";
import { createTestCert, relayFetch, startRelay, startUpstream, type TestCert } from "./helpers/upstream.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let cert: TestCert;
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  cert = await createTestCert(["site-a.test"]);
});

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

async function setup(
  handler: Handler,
  options: { trustCa?: boolean; maxRequestBody?: number; headersTimeout?: number; blocked?: string[] } = {},
) {
  const upstream = await startUpstream(handler, cert);
  const relay = await startRelay({
    testUpstreams: new Map([["site-a.test", { host: "127.0.0.1", port: upstream.port }]]),
    testCa: options.trustCa === false ? undefined : cert.cert,
    maxRequestBody: options.maxRequestBody,
    headersTimeout: options.headersTimeout,
    blocklist: options.blocked ? new HostBlocklist(options.blocked, []) : undefined,
  });
  cleanups.push(relay.close, upstream.close);
  return { upstream, base: relay.base };
}

function envelope(res: Response, name = "x-girici-headers"): Array<[string, string]> {
  return decodeHeaderList(res.headers.get(name) ?? "");
}

describe("relay", () => {
  it("relays a GET and exposes upstream headers in the envelope", async () => {
    const { base } = await setup((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "x-upstream": "yes" });
      res.end("hello");
    });
    const res = await relayFetch(base, "https/site-a.test/hi?x=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-girici-status")).toBe("200");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(envelope(res)).toContainEqual(["x-upstream", "yes"]);
    expect(await res.text()).toBe("hello");
  });

  it("moves Set-Cookie into its own header and disables caching", async () => {
    const { base } = await setup((_req, res) => {
      res.setHeader("set-cookie", ["a=1", "b=2"]);
      res.end();
    });
    const res = await relayFetch(base, "https/site-a.test/");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(envelope(res, "x-girici-set-cookie")).toEqual([
      ["set-cookie", "a=1"],
      ["set-cookie", "b=2"],
    ]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("never follows redirects", async () => {
    const { base, upstream } = await setup((_req, res) => {
      res.writeHead(302, { location: "/next" });
      res.end();
    });
    const res = await relayFetch(base, "https/site-a.test/old");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-girici-status")).toBe("302");
    expect(envelope(res)).toContainEqual(["location", "/next"]);
    expect(upstream.requestCount()).toBe(1);
  });

  it("passes 304 and 206 through", async () => {
    const { base } = await setup((req, res) => {
      if (req.headers["if-none-match"] === '"v1"') {
        res.writeHead(304, { etag: '"v1"' });
        res.end();
      } else if (req.headers.range === "bytes=0-1") {
        res.writeHead(206, { "content-range": "bytes 0-1/5", "content-length": "2" });
        res.end("he");
      } else {
        res.end("hello");
      }
    });
    expect((await relayFetch(base, "https/site-a.test/e", { headers: { "if-none-match": '"v1"' } })).status).toBe(304);
    const ranged = await relayFetch(base, "https/site-a.test/r", { headers: { range: "bytes=0-1" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 0-1/5");
  });

  it("streams the body", async () => {
    const { base } = await setup((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("first");
      setTimeout(() => res.end("second"), 300);
    });
    const started = Date.now();
    const reader = (await relayFetch(base, "https/site-a.test/slow")).body!.getReader();
    await reader.read();
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("aborts the upstream request when the client goes away", async () => {
    let upstreamClosed = false;
    const { base } = await setup((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("part");
      res.on("close", () => {
        upstreamClosed = true;
      });
    });
    const controller = new AbortController();
    const res = await relayFetch(base, "https/site-a.test/hang", { signal: controller.signal });
    await res.body!.getReader().read();
    controller.abort();
    await expect.poll(() => upstreamClosed, { timeout: 1000 }).toBe(true);
  });

  it("passes compressed bodies through untouched", async () => {
    const { base } = await setup((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      res.end(gzipSync("hello"));
    });
    const raw = await new Promise<{ headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const request = httpRequest(
        `${base}/_g/r/https/site-a.test/z`,
        { headers: { "x-girici-relay": "1" } },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(raw.headers["content-encoding"]).toBe("gzip");
    expect([...raw.body.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
  });

  it("forwards the page's request and nothing of ours", async () => {
    const { base } = await setup((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.headers));
    });
    const res = await relayFetch(base, "https/site-a.test/echo", {
      headers: {
        cookie: "girici=1",
        "x-girici-cookie": encodeHeaderValue("sid=abc"),
        "x-girici-headers": encodeHeaderList([["x-test", "1"]]),
        "x-girici-fetch": encodeHeaderValue("empty;cors;same-origin;"),
      },
    });
    const seen = (await res.json()) as Record<string, string>;
    expect(seen["x-test"]).toBe("1");
    expect(seen["sec-fetch-site"]).toBe("same-origin");
    expect(seen.host).toBe("site-a.test");
    expect(seen.cookie).toBe("sid=abc");
    expect(Object.keys(seen).filter((name) => name.startsWith("x-girici-"))).toEqual([]);
  });

  it("relays other methods through POST", async () => {
    const { base } = await setup((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ method: req.method, body }));
      });
    });
    const res = await relayFetch(base, "https/site-a.test/api", {
      method: "POST",
      body: "data",
      headers: { "x-girici-method": "PUT", origin: base },
    });
    expect(await res.json()).toEqual({ method: "PUT", body: "data" });
  });

  it("accepts a POST from its own host behind a TLS terminator", async () => {
    const { base } = await setup((req, res) => {
      req.resume();
      req.on("end", () => res.end(req.method));
    });
    const res = await relayFetch(base, "https/site-a.test/api", {
      method: "POST",
      body: "data",
      headers: { origin: base.replace("http:", "https:"), "x-forwarded-proto": "https" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("POST");
  });

  it("keeps the content length of uploads", async () => {
    const { base } = await setup((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(req.headers));
      });
    });
    const res = await relayFetch(base, "https/site-a.test/upload", {
      method: "POST",
      body: "a".repeat(300 * 1024),
      headers: { "x-girici-method": "PUT", origin: base },
    });
    const seen = (await res.json()) as Record<string, string>;
    expect(seen["content-length"]).toBe(String(300 * 1024));
    expect(seen["transfer-encoding"]).toBeUndefined();
  });

  it("rejects requests without the marker, from other sites, or with other methods", async () => {
    const { base } = await setup((_req, res) => res.end("ok"));
    const noMarker = await fetch(`${base}/_g/r/https/site-a.test/`);
    expect(noMarker.status).toBe(403);
    expect(noMarker.headers.get("x-girici-error")).toBe("bad_request");
    expect((await relayFetch(base, "https/site-a.test/", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(
      403,
    );
    expect(
      (
        await relayFetch(base, "https/site-a.test/", {
          method: "POST",
          body: "x",
          headers: { origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect((await relayFetch(base, "https/site-a.test/", { method: "DELETE" })).status).toBe(405);
  });

  it("blocks private targets", async () => {
    const { base } = await setup((_req, res) => res.end("ok"));
    for (const tail of [
      "http/127.0.0.1/",
      "http/localhost/",
      "https/unmapped.test/",
      "http/2130706433/",
      "https/example.com:22/",
    ]) {
      const res = await relayFetch(base, tail);
      expect(res.status).toBe(403);
      expect(res.headers.get("x-girici-error")).toBe("ssrf_blocked");
    }
    expect((await relayFetch(base, "ftp/example.com/")).headers.get("x-girici-error")).toBe("bad_request");
  });

  it("refuses blocked hosts and their subdomains before connecting", async () => {
    const { base, upstream } = await setup((_req, res) => res.end("ok"), { blocked: ["site-a.test"] });
    for (const tail of ["https/site-a.test/", "https/WWW.site-a.test./x"]) {
      const res = await relayFetch(base, tail);
      expect(res.status).toBe(403);
      expect(res.headers.get("x-girici-error")).toBe("blocked");
    }
    expect(upstream.requestCount()).toBe(0);
  });

  it("verifies upstream TLS", async () => {
    const { base } = await setup((_req, res) => res.end("ok"), { trustCa: false });
    const res = await relayFetch(base, "https/site-a.test/");
    expect(res.status).toBe(502);
    expect(res.headers.get("x-girici-error")).toBe("tls");
  });

  it("times out slow upstreams", async () => {
    const { base } = await setup(() => {}, { headersTimeout: 200 });
    const res = await relayFetch(base, "https/site-a.test/");
    expect(res.status).toBe(504);
    expect(res.headers.get("x-girici-error")).toBe("timeout");
  });

  it("limits request bodies", async () => {
    const { base } = await setup((_req, res) => res.end("ok"), { maxRequestBody: 1024 });
    const res = await relayFetch(base, "https/site-a.test/", {
      method: "POST",
      body: "a".repeat(2048),
      headers: { origin: base },
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("x-girici-error")).toBe("too_large");
  });

  it("accepts large envelopes", async () => {
    const { base } = await setup((_req, res) => res.end("ok"));
    const res = await relayFetch(base, "https/site-a.test/hi", {
      headers: { "x-girici-headers": encodeHeaderList([["x-big", "a".repeat(40_000)]]) },
    });
    expect(res.status).toBe(200);
  });

  it("keeps non-ASCII header bytes", async () => {
    const { base } = await setup((_req, res) => {
      res.setHeader("x-name", Buffer.from("çğ").toString("latin1"));
      res.end();
    });
    const res = await relayFetch(base, "https/site-a.test/");
    expect(envelope(res)).toContainEqual(["x-name", Buffer.from("çğ").toString("latin1")]);
  });
});
