import type { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { openTunnel } from "../src/upstream/tunnel.ts";
import { httpProxy, socksProxy, startConnectProxy, startEcho, startSocks5Proxy } from "./helpers/proxies.ts";
import { createTestCert } from "./helpers/upstream.ts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

const local = (port: number) => ({ host: "127.0.0.1", port });
const target = { host: "203.0.113.7", port: 443 };

async function track<T extends { close(): Promise<void> }>(server: Promise<T>): Promise<T> {
  const started = await server;
  cleanups.push(() => started.close());
  return started;
}

function keep(socket: Socket): Socket {
  cleanups.push(() => void socket.destroy());
  return socket;
}

// openTunnel hands sockets back paused, so each reader resumes the one it reads.
function roundTrip(socket: Socket, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("data", (data: Buffer) => resolve(data.toString()));
    socket.once("error", reject);
    socket.resume();
    socket.write(text);
  });
}

function firstChunk(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("data", (data: Buffer) => resolve(data.toString()));
    socket.resume();
  });
}

describe("openTunnel", () => {
  it("opens an HTTP CONNECT tunnel with basic auth and carries bytes both ways", async () => {
    const echo = await track(startEcho());
    const proxy = await track(startConnectProxy({ auth: "user:pass" }));
    const socket = keep(
      await openTunnel(
        { protocol: "http", host: "127.0.0.1", port: proxy.port, username: "user", password: "pass" },
        local(echo.port),
        { timeout: 2000 },
      ),
    );
    expect(await roundTrip(socket, "ping")).toBe("ping");
    expect(proxy.targets).toEqual([`127.0.0.1:${echo.port}`]);
    expect(proxy.authHeaders).toEqual([`Basic ${Buffer.from("user:pass").toString("base64")}`]);
  });

  it("keeps tunneled bytes that share a packet with the CONNECT reply", async () => {
    const echo = await track(startEcho());
    const proxy = await track(startConnectProxy({ earlyData: "hello" }));
    const socket = keep(await openTunnel(httpProxy(proxy.port), local(echo.port), { timeout: 2000 }));
    expect(await firstChunk(socket)).toBe("hello");
  });

  it("tells a refused proxy login apart from an unreachable target", async () => {
    const refused = await track(startConnectProxy({ status: 407 }));
    await expect(openTunnel(httpProxy(refused.port), target, { timeout: 2000 })).rejects.toMatchObject({
      kind: "proxy",
    });
    const gateway = await track(startConnectProxy({ status: 502 }));
    await expect(openTunnel(httpProxy(gateway.port), target, { timeout: 2000 })).rejects.toMatchObject({
      kind: "target",
    });
  });

  it("speaks TLS to an https proxy", async () => {
    const cert = await createTestCert(["localhost"]);
    const echo = await track(startEcho());
    const proxy = await track(startConnectProxy({ tls: cert }));
    const socket = keep(
      await openTunnel({ protocol: "https", host: "localhost", port: proxy.port }, local(echo.port), {
        timeout: 2000,
        ca: [cert.cert],
      }),
    );
    expect(await roundTrip(socket, "ping")).toBe("ping");
  });

  it("encodes IPv4, IPv6 and domain targets for SOCKS5", async () => {
    const proxy = await track(startSocks5Proxy({ reply: 5 }));
    for (const host of ["203.0.113.7", "2001:db8::1", "site.example"]) {
      await expect(openTunnel(socksProxy(proxy.port), { host, port: 443 }, { timeout: 2000 })).rejects.toMatchObject({
        kind: "target",
      });
    }
    expect(proxy.targets).toEqual([
      { type: "ipv4", host: "203.0.113.7", port: 443 },
      { type: "ipv6", host: "2001:db8::1", port: 443 },
      { type: "domain", host: "site.example", port: 443 },
    ]);
  });

  it("logs in to SOCKS5 and reports a wrong password as a proxy error", async () => {
    const echo = await track(startEcho());
    const proxy = await track(startSocks5Proxy({ auth: { username: "u", password: "p" } }));
    const ok = keep(
      await openTunnel({ ...socksProxy(proxy.port), username: "u", password: "p" }, local(echo.port), {
        timeout: 2000,
      }),
    );
    expect(await roundTrip(ok, "ping")).toBe("ping");
    await expect(
      openTunnel({ ...socksProxy(proxy.port), username: "u", password: "x" }, local(echo.port), { timeout: 2000 }),
    ).rejects.toMatchObject({ kind: "proxy" });
  });

  it("reads a SOCKS5 reply split across packets", async () => {
    const echo = await track(startEcho());
    const proxy = await track(startSocks5Proxy({ splitReply: true }));
    const socket = keep(await openTunnel(socksProxy(proxy.port), local(echo.port), { timeout: 2000 }));
    expect(await roundTrip(socket, "ping")).toBe("ping");
  });

  it("reports a SOCKS5 ruleset refusal as a proxy error", async () => {
    const proxy = await track(startSocks5Proxy({ reply: 2 }));
    await expect(openTunnel(socksProxy(proxy.port), target, { timeout: 2000 })).rejects.toMatchObject({
      kind: "proxy",
    });
  });

  it("gives up on a silent proxy after the timeout", async () => {
    const proxy = await track(startSocks5Proxy({ silent: true }));
    const started = Date.now();
    await expect(openTunnel(socksProxy(proxy.port), target, { timeout: 200 })).rejects.toMatchObject({
      kind: "proxy",
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
