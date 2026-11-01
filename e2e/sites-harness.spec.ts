import { request } from "node:http";
import { connect } from "node:net";
import type { TestInfo } from "@playwright/test";
import { expect, isSiteProject, PRIVATE_SITES, siteHost, SITES, test } from "./support/test.ts";

const TRAP = { host: "127.0.0.1", port: 41999 };
const TRAP_LOG = "http://127.0.0.1:41999/log";
const TRAP_FORWARDED = "http://127.0.0.1:41999/forwarded";

/** An absolute-form request, as a browser sends one through its proxy. */
function throughTrap(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ ...TRAP, path: url, headers: { host: new URL(url).host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** A CONNECT tunnel to `authority`, then one plain GET inside it; resolves with the raw answer. */
function tunnelTo(authority: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(TRAP.port, TRAP.host, () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    let answer = "";
    let open = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      answer += chunk;
      if (!open && answer.includes("\r\n\r\n")) {
        open = true;
        if (!/^HTTP\/1\.1 200/.test(answer)) {
          socket.end();
          return;
        }
        answer = "";
        socket.write(`GET ${path} HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`);
      }
    });
    socket.on("end", () => resolve(answer));
    socket.on("error", reject);
  });
}

test("the site-mode servers answer on their root and site hosts as secure contexts", async ({ page }, testInfo) => {
  await fetch(TRAP_FORWARDED, { method: "DELETE" });
  for (const url of [`${SITES}/healthz`, `${siteHost("https://site-a.test/")}/healthz`, `${PRIVATE_SITES}/healthz`]) {
    await page.goto(url);
    await expect(page.locator("body")).toHaveText("ok");
    expect(await page.evaluate(() => isSecureContext), url).toBe(true);
  }
  // Reported on every platform so CI shows which way each browser reached the hosts; macOS was probed directly.
  const forwarded = (await (await fetch(TRAP_FORWARDED)).json()) as string[];
  const how = forwarded.length === 0 ? "resolved by the browser" : "forwarded by the trap";
  testInfo.annotations.push({ type: "site hosts", description: how });
  console.log(`${testInfo.project.name}: site hosts ${how}`);
  if (process.platform === "darwin") expect(forwarded).toEqual([]);
});

test("site hosts in tests are the fixed ones", () => {
  expect(siteHost("https://www.site-a.test/x")).toBe("http://cmkprjpf6pvd57ha4qtfwpo3wp.girici.localhost:41005");
  expect(siteHost("https://site-b.test/", PRIVATE_SITES)).toBe(
    "http://o4c2jfkqruc7ol6sfac763awxd.private.localhost:41006",
  );
  expect(siteHost("http://site-c.test/")).toBe("http://rsvoxyxmtqtjcs4lghr65wtluy.girici.localhost:41005");
});

test("specs can tell a subdomain-mode project from a single-origin one", ({}, testInfo) => {
  expect(isSiteProject(testInfo)).toBe(true);
  expect(isSiteProject({ project: { name: "webkit" } } as TestInfo)).toBe(false);
});

test("pages registered for subdomain mode open through the site-mode server", async ({ page }) => {
  await page.goto("/~/https/site-a.test/sites/harness");
  await expect(page.locator("h1")).toHaveText("Subdomain harness");
});

test("the trap forwards site-mode hosts a browser hands it instead of counting them as escapes", async () => {
  await fetch(TRAP_FORWARDED, { method: "DELETE" });
  const siteA = `${siteHost("https://site-a.test/")}/healthz`;
  expect(await throughTrap(siteA)).toEqual({ status: 200, body: "ok" });
  expect(await throughTrap(`${PRIVATE_SITES}/healthz`)).toEqual({ status: 200, body: "ok" });
  const siteB = new URL(siteHost("https://site-b.test/", PRIVATE_SITES)).host;
  expect(await tunnelTo(siteB, "/healthz")).toMatch(/^HTTP\/1\.1 200 [^]*\r\n\r\nok$/);
  expect(await (await fetch(TRAP_FORWARDED)).json()).toEqual([
    `GET ${siteA}`,
    `GET ${PRIVATE_SITES}/healthz`,
    `CONNECT ${siteB}`,
  ]);

  // Other hosts and ports stay refused and logged; the log is emptied so the escape guard checks only the above.
  expect((await throughTrap("http://www.girici.localhost:41005/healthz")).status).toBe(403);
  expect((await throughTrap("http://girici.localhost:41000/healthz")).status).toBe(403);
  expect(await tunnelTo("private.localhost:41005", "/healthz")).toMatch(/^HTTP\/1\.1 403/);
  expect(await (await fetch(TRAP_LOG)).json()).toEqual([
    "GET http://www.girici.localhost:41005/healthz",
    "GET http://girici.localhost:41000/healthz",
    "CONNECT private.localhost:41005",
  ]);
  await fetch(TRAP_LOG, { method: "DELETE" });
});
