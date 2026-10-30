import { describe, expect, it } from "vitest";
import { cookieDeliveries } from "../src/sw/cookie-broadcast.ts";
import type { CookieSnapshot } from "../src/shared/protocol.ts";

const origin = "https://girici.test";
const win = (id: string, url: string) => ({ id, type: "window", url: `${origin}/~/https/${url}` });

function snapshot(name: string, domain: string): CookieSnapshot {
  return { name, value: "1", domain, path: "/", hostOnly: true, secure: false, expires: null, creation: 1 };
}

describe("cookieDeliveries", () => {
  it("sends a change only to windows of the cookie's site", () => {
    const sid = { ...snapshot("sid", "a.test"), hostOnly: false };
    const clients = [
      win("a", "a.test/x"),
      win("www", "www.a.test/"),
      win("b", "b.test/"),
      { id: "ui", type: "window", url: `${origin}/settings` },
      { id: "w", type: "worker", url: `blob:${origin}/1` },
    ];
    expect(cookieDeliveries(clients, [sid], origin).map((d) => d.client.id)).toEqual(["a", "www"]);
  });

  it("keeps a host-only cookie to its exact host", () => {
    const clients = [win("a", "a.test/"), win("www", "www.a.test/")];
    expect(cookieDeliveries(clients, [snapshot("h", "a.test")], origin).map((d) => d.client.id)).toEqual(["a"]);
  });

  it("gives each window only the changes meant for it", () => {
    const clients = [win("a", "a.test/"), win("b", "b.test/")];
    const deliveries = cookieDeliveries(clients, [snapshot("x", "a.test"), snapshot("y", "b.test")], origin);
    expect(deliveries.map((d) => [d.client.id, d.changes.map((c) => c.name)])).toEqual([
      ["a", ["x"]],
      ["b", ["y"]],
    ]);
  });

  it("skips clients without a decodable proxy URL", () => {
    const clients = [
      { id: "blob", type: "window", url: `blob:${origin}/1` },
      { id: "blank", type: "window", url: "about:blank" },
      { id: "foreign", type: "window", url: "https://a.test/" },
    ];
    expect(cookieDeliveries(clients, [snapshot("x", "a.test")], origin)).toEqual([]);
  });

  it("gives a trailing-dot host nothing, as the client mirror would not match it either", () => {
    expect(cookieDeliveries([win("dot", "a.test./")], [snapshot("x", "a.test")], origin)).toEqual([]);
  });

  it("keeps a nested frame of another site out of the tab's site changes", () => {
    const clients = [win("top", "a.test/"), win("frame", "b.test/embed")];
    expect(cookieDeliveries(clients, [snapshot("x", "a.test")], origin).map((d) => d.client.id)).toEqual(["top"]);
  });
});
