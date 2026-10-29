import type { IncomingMessage, ServerResponse } from "node:http";
import { createSecureServer, type Http2ServerRequest, type Http2ServerResponse } from "node:http2";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { UpstreamProxy } from "../src/upstream/proxy-config.ts";
import { createGuardedLookup } from "../src/upstream/ssrf.ts";
import { httpProxy, socksProxy, startConnectProxy, startSocks5Proxy } from "./helpers/proxies.ts";
import { createTestCert, relayFetch, startRelay, startUpstream, type TestCert } from "./helpers/upstream.ts";

let cert: TestCert;
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  cert = await createTestCert(["site-a.test"]);
});

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

const fakeLookup = createGuardedLookup(async (host) => [
  { address: host === "internal.example.com" ? "10.0.0.5" : "93.184.216.34", family: 4 },
]);

const helloHandler = (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("hello");
};

async function track<T extends { close(): Promise<void> }>(server: Promise<T>): Promise<T> {
  const started = await server;
  cleanups.push(() => started.close());
  return started;
}

async function setup(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  options: { proxy: UpstreamProxy; trustCa?: boolean; tls?: boolean },
) {
  const upstream = await startUpstream(handler, options.tls === false ? undefined : cert);
  const relay = await startRelay({
    testUpstreams: new Map([["site-a.test", { host: "127.0.0.1", port: upstream.port }]]),
    testCa: options.trustCa === false ? undefined : cert.cert,
    proxy: options.proxy,
  });
  cleanups.push(relay.close, upstream.close);
  return { base: relay.base, upstream };
}

async function setupH2(
  handler: (req: Http2ServerRequest, res: Http2ServerResponse) => void,
  options: { proxy: UpstreamProxy },
) {
  const server = createSecureServer({ key: cert.key, cert: cert.cert, allowHTTP1: true }, handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const relay = await startRelay({
    testUpstreams: new Map([["site-a.test", { host: "127.0.0.1", port: (server.address() as AddressInfo).port }]]),
    testCa: cert.cert,
    proxy: options.proxy,
  });
  cleanups.push(relay.close, () => new Promise<void>((resolve) => server.close(() => resolve())));
  return { base: relay.base };
}

async function closedPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("relay through an upstream proxy", () => {
  it("relays HTTPS through an HTTP CONNECT proxy on localhost and checks the target certificate", async () => {
    const proxy = await track(startConnectProxy());
    const { base, upstream } = await setup(helloHandler, { proxy: httpProxy(proxy.port) });
    const res = await relayFetch(base, "https/site-a.test/hi");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(proxy.targets).toEqual([`127.0.0.1:${upstream.port}`]);
    const untrusted = await setup(helloHandler, { proxy: httpProxy(proxy.port), trustCa: false });
    expect((await relayFetch(untrusted.base, "https/site-a.test/hi")).headers.get("x-girici-error")).toBe("tls");
  });

  it("relays plain HTTP through the tunnel", async () => {
    const proxy = await track(startSocks5Proxy());
    const { base, upstream } = await setup(helloHandler, { proxy: socksProxy(proxy.port), tls: false });
    const res = await relayFetch(base, "http/site-a.test/hi");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(proxy.targets).toEqual([{ type: "ipv4", host: "127.0.0.1", port: upstream.port }]);
  });

  it("negotiates h2 through the tunnel when the upstream offers it", async () => {
    const proxy = await track(startConnectProxy());
    const { base } = await setupH2((req, res) => res.end(req.httpVersion), { proxy: httpProxy(proxy.port) });
    expect(await (await relayFetch(base, "https/site-a.test/")).text()).toBe("2.0");
    expect(proxy.targets).toHaveLength(1);
  });

  it("hands a SOCKS5 proxy the vetted address and a SOCKS5h proxy the name", async () => {
    const socks = await track(startSocks5Proxy({ reply: 5 }));
    const pinned = await startRelay({ testUpstreams: new Map(), proxy: socksProxy(socks.port), lookup: fakeLookup });
    cleanups.push(pinned.close);
    expect((await relayFetch(pinned.base, "https/pinned.example.com/")).headers.get("x-girici-error")).toBe("connect");
    const named = await startRelay({
      testUpstreams: new Map(),
      proxy: { ...socksProxy(socks.port), protocol: "socks5h" },
      lookup: fakeLookup,
    });
    cleanups.push(named.close);
    await relayFetch(named.base, "https/pinned.example.com/");
    expect(socks.targets).toEqual([
      { type: "ipv4", host: "93.184.216.34", port: 443 },
      { type: "domain", host: "pinned.example.com", port: 443 },
    ]);
  });

  it("pins an IPv4 address for SOCKS5 when the name also has IPv6", async () => {
    const socks = await track(startSocks5Proxy({ reply: 5 }));
    const dualStack = createGuardedLookup(async () => [
      { address: "2606:4700::1111", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ]);
    const relay = await startRelay({ testUpstreams: new Map(), proxy: socksProxy(socks.port), lookup: dualStack });
    cleanups.push(relay.close);
    await relayFetch(relay.base, "https/dual.example.com/");
    expect(socks.targets).toEqual([{ type: "ipv4", host: "93.184.216.34", port: 443 }]);
  });

  it("refuses private targets without contacting the proxy", async () => {
    const proxy = await track(startConnectProxy());
    const { base, close } = await startRelay({
      testUpstreams: new Map(),
      proxy: httpProxy(proxy.port),
      lookup: fakeLookup,
    });
    cleanups.push(close);
    for (const tail of ["https/internal.example.com/", "https/127.0.0.1/", "http/169.254.169.254/"]) {
      const res = await relayFetch(base, tail);
      expect(res.status).toBe(403);
      expect(res.headers.get("x-girici-error")).toBe("ssrf_blocked");
    }
    expect(proxy.targets).toEqual([]);
  });

  it("answers 502 proxy when the proxy is down and warns once without credentials", async () => {
    const port = await closedPort();
    const logLines: string[] = [];
    const { base, close } = await startRelay({
      testUpstreams: new Map(),
      proxy: { protocol: "http", host: "127.0.0.1", port, username: "user", password: "secret" },
      lookup: fakeLookup,
      logLines,
    });
    cleanups.push(close);
    for (let i = 0; i < 2; i++) {
      const res = await relayFetch(base, "https/pinned.example.com/");
      expect(res.status).toBe(502);
      expect(res.headers.get("x-girici-error")).toBe("proxy");
    }
    expect(logLines.filter((line) => line.includes("Upstream proxy failed"))).toHaveLength(1);
    expect(logLines.join("\n")).not.toContain("secret");
  });
});
