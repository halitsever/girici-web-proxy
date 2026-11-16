import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { CERT_PATH } from "./fixtures/cert.ts";
import { COMPAT_ROUTES, mergeRoutes } from "./fixtures/compat/index.ts";
import { ROUTES, type Route } from "./fixtures/sites.ts";
import { expect, test } from "./support/test.ts";

/** ws hands these to tls.connect, so the fixture certificate is checked against the site's name. */
const TLS = { ca: readFileSync(CERT_PATH), servername: "site-a.test" };

function open(path: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  const socket = new WebSocket(`wss://127.0.0.1:41443${path}`, { ...TLS, headers });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** Text frames come back as strings and binary frames as byte arrays, so a test sees which kind arrived. */
function roundTrip(socket: WebSocket, message: string | Uint8Array): Promise<string | number[]> {
  return new Promise((resolve) => {
    socket.once("message", (data: Buffer, binary: boolean) => resolve(binary ? [...data] : data.toString()));
    socket.send(message);
  });
}

function closed(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
  });
}

test("the fixture socket echoes, reports its cookie and logs how the client closed", async ({ request }) => {
  const id = test.info().testId;
  const socket = await open(`/echo-socket?id=${id}`, { cookie: "k=v" });
  expect(await roundTrip(socket, "hello")).toBe("hello");
  expect(await roundTrip(socket, "cookie?")).toBe("cookie:k=v");
  socket.close(4001, "bye");
  await expect
    .poll(async () =>
      (await request.get(`http://127.0.0.1:41080/socket-log?id=${id}`, { headers: { host: "site-a.test" } })).json(),
    )
    .toEqual({ code: 4001, reason: "bye" });
});

test("the fixture socket echoes binary as binary", async () => {
  const socket = await open("/echo-socket");
  expect(await roundTrip(socket, new Uint8Array([1, 2, 3]))).toEqual([1, 2, 3]);
  socket.close();
});

test("the fixture socket closes or drops when asked, and logs only closes the client started", async ({ request }) => {
  const id = test.info().testId;
  const asked = await open(`/echo-socket?id=${id}`);
  const askedClose = closed(asked);
  asked.send("close:4002:srv:x");
  expect(await askedClose).toEqual({ code: 4002, reason: "srv:x" });
  const dropped = await open(`/echo-socket?id=${id}`);
  const droppedClose = closed(dropped);
  dropped.send("drop");
  expect((await droppedClose).code).toBe(1006);
  const log = await request.get(`http://127.0.0.1:41080/socket-log?id=${id}`, { headers: { host: "site-a.test" } });
  expect(await log.json()).toBeNull();
});

test("the fixture still sends one binary frame on the binary socket and refuses other paths", async () => {
  const socket = new WebSocket("wss://127.0.0.1:41443/binary-socket", TLS);
  const frame = await new Promise<number[]>((resolve) => socket.once("message", (data: Buffer) => resolve([...data])));
  expect(frame).toEqual([1, 2, 3]);
  socket.close();
  await expect(open("/no-such-socket")).rejects.toThrow();
});

test("no compat route shadows a fixture route, and two tracks never serve one path", () => {
  for (const [host, paths] of Object.entries(COMPAT_ROUTES)) {
    for (const path of Object.keys(paths)) expect(ROUTES[host]?.[path], `${host}${path}`).toBeUndefined();
  }
  const route: Route = (_req, res) => res.end();
  expect(() => mergeRoutes({ "site-a.test": { "/x": route } }, { "site-a.test": { "/x": route } })).toThrow(
    "site-a.test/x",
  );
  expect(mergeRoutes({ "site-a.test": { "/x": route } }, { "site-a.test": { "/y": route } })).toEqual({
    "site-a.test": { "/x": route, "/y": route },
  });
});
