import { createServer, type RequestListener, type Server } from "node:http";
import { createServer as createSecureServer } from "node:https";
import type { AddressInfo } from "node:net";
import express from "express";
import { generate } from "selfsigned";
import { errorHandler } from "../../src/http/error-handler.ts";
import { createHttpServer } from "../../src/http/server.ts";
import { createLogger } from "../../src/log.ts";
import { relayRouter } from "../../src/routes/relay.ts";
import { createUpstreamAgent } from "../../src/upstream/agent.ts";

export interface TestCert {
  key: string;
  cert: string;
}

export async function createTestCert(hostnames: string[]): Promise<TestCert> {
  const pems = await generate([{ name: "commonName", value: hostnames[0] ?? "localhost" }], {
    extensions: [
      { name: "basicConstraints", cA: true },
      { name: "subjectAltName", altNames: hostnames.map((value) => ({ type: 2, value })) },
    ],
  });
  return { key: pems.private, cert: pems.cert };
}

export async function startUpstream(
  handler: RequestListener,
  tls?: TestCert,
): Promise<{ port: number; requestCount(): number; close(): Promise<void> }> {
  let count = 0;
  const counting: RequestListener = (req, res) => {
    count++;
    handler(req, res);
  };
  // Large enough for the relay's 64 KiB envelopes to reach the handler.
  const options = { maxHeaderSize: 65_536 };
  const server = tls
    ? createSecureServer({ ...options, key: tls.key, cert: tls.cert }, counting)
    : createServer(options, counting);
  const port = await listen(server);
  return { port, requestCount: () => count, close: () => closeServer(server) };
}

export async function startRelay(options: {
  testUpstreams: Map<string, { host: string; port: number }>;
  testCa?: string;
  maxRequestBody?: number;
  headersTimeout?: number;
}): Promise<{ base: string; close(): Promise<void> }> {
  const logger = createLogger("error", () => {});
  const agent = createUpstreamAgent({
    testUpstreams: options.testUpstreams,
    testCa: options.testCa,
    headersTimeout: options.headersTimeout,
  });
  const app = express();
  app.use(
    relayRouter({
      agent,
      allowedTestHosts: new Set(options.testUpstreams.keys()),
      maxRequestBody: options.maxRequestBody ?? 50 * 1024 * 1024,
      logger,
    }),
  );
  app.use(errorHandler(logger));
  const server = createHttpServer(app);
  const port = await listen(server);
  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await closeServer(server);
      await agent.close();
    },
  };
}

export function relayFetch(base: string, tail: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("x-girici-relay")) headers.set("x-girici-relay", "1");
  return fetch(`${base}/_g/r/${tail}`, { ...init, headers });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}
