import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSiteDomain } from "@girici/engine/shared";
import { createApp } from "../../src/app.ts";
import { AuthStore } from "../../src/auth/store.ts";
import { BrandStore } from "../../src/brand/store.ts";
import { openDb } from "../../src/db/open.ts";
import { createLogger } from "../../src/log.ts";
import { deriveSiteKeys, type SiteSetup } from "../../src/sites/keys.ts";
import { createUpstreamAgent } from "../../src/upstream/agent.ts";

export interface Sent {
  status: number;
  headers: IncomingHttpHeaders;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface SendOptions {
  host: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface SiteApp {
  store: AuthStore;
  setup: SiteSetup;
  /** fetch cannot set Host, so requests go through node:http. */
  send(path: string, options: SendOptions): Promise<Sent>;
  close(): Promise<void>;
}

export const siteSetup = (): SiteSetup => ({
  domain: parseSiteDomain("proxy.test")!,
  keys: deriveSiteKeys("s".repeat(32)),
});

/** A public instance with an admin, in subdomain mode on proxy.test; null runs it in single-origin mode. */
export async function startSiteApp(sites: SiteSetup | null = siteSetup()): Promise<SiteApp> {
  const store = new AuthStore(openDb(":memory:"));
  store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  store.setPublicAccess(true);
  const webDistDir = mkdtempSync(join(tmpdir(), "girici-web-"));
  writeFileSync(join(webDistDir, "index.html"), "<!doctype html><title>girici-test</title>");
  const engineBundlesDir = mkdtempSync(join(tmpdir(), "girici-engine-"));
  writeFileSync(join(engineBundlesDir, "boot.js"), "void 0;");
  writeFileSync(join(engineBundlesDir, "sw.js"), "void 0;");
  const brandDir = mkdtempSync(join(tmpdir(), "girici-brand-"));
  const agent = createUpstreamAgent();
  const server: Server = createServer(
    createApp({
      webDistDir,
      engineBundlesDir,
      sourceUrl: "https://example.com/source",
      logger: createLogger("error", () => {}),
      authStore: store,
      brand: new BrandStore(join(brandDir, "brand"), store),
      relay: { agent, allowedTestHosts: new Set(), maxRequestBody: 1_048_576 },
      sites: sites ?? undefined,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const send = (path: string, options: SendOptions): Promise<Sent> =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: options.method ?? "GET",
          headers: { ...options.headers, host: options.host },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("error", reject);
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              text: async () => body,
              json: async () => JSON.parse(body) as unknown,
            });
          });
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });

  return {
    store,
    setup: sites ?? siteSetup(),
    send,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await agent.close();
      store.close();
      for (const dir of [webDistDir, engineBundlesDir, brandDir]) rmSync(dir, { recursive: true, force: true });
    },
  };
}
