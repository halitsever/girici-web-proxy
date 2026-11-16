import { describe, expect, it } from "vitest";
import { LABEL_RPC_LIMIT, PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { handleLabelRpc } from "../src/sw/label-rpc.ts";

const post = (body: unknown) =>
  new Request("https://own.proxy.test/_g/rpc/label", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const hostOf = (url: URL) => `https://${url.hostname.replace(/\./g, "-")}.proxy.test`;

describe("handleLabelRpc", () => {
  it("names the host of each origin it is asked for", async () => {
    const response = await handleLabelRpc(
      post({ v: PROTOCOL_VERSION, origins: ["https://www.site-a.test", "http://site-c.test", "javascript:x"] }),
      hostOf,
    );
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      hosts: [
        ["https://www.site-a.test", "https://www-site-a-test.proxy.test"],
        ["http://site-c.test", "https://site-c-test.proxy.test"],
        ["javascript:x", null],
      ],
    });
  });

  it("names nothing for what is not a web address", async () => {
    const response = await handleLabelRpc(
      post({ v: PROTOCOL_VERSION, origins: ["null", "data:text/html,x", "/relative", "blob:https://a.test/1"] }),
      hostOf,
    );
    expect((await response.json()).hosts.map(([, host]: [string, string | null]) => host)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("refuses more than 16 origins", async () => {
    const origins = Array.from({ length: LABEL_RPC_LIMIT + 1 }, (_, index) => `https://s${index}.test`);
    expect((await handleLabelRpc(post({ v: PROTOCOL_VERSION, origins }), hostOf)).status).toBe(400);
    const most = origins.slice(0, LABEL_RPC_LIMIT);
    expect((await handleLabelRpc(post({ v: PROTOCOL_VERSION, origins: most }), hostOf)).status).toBe(200);
  });

  it("refuses a wrong version, bad JSON and a malformed list", async () => {
    expect((await handleLabelRpc(post({ v: 0, origins: [] }), hostOf)).status).toBe(400);
    expect((await handleLabelRpc(post("{"), hostOf)).status).toBe(400);
    expect((await handleLabelRpc(post({ v: PROTOCOL_VERSION, origins: "x" }), hostOf)).status).toBe(400);
    expect((await handleLabelRpc(post({ v: PROTOCOL_VERSION, origins: [1] }), hostOf)).status).toBe(400);
    expect((await handleLabelRpc(post(null), hostOf)).status).toBe(400);
  });

  it("names nothing before it has a key", async () => {
    const response = await handleLabelRpc(post({ v: PROTOCOL_VERSION, origins: ["https://site-a.test"] }), null);
    expect(await response.json()).toEqual({ hosts: [["https://site-a.test", null]] });
  });
});
