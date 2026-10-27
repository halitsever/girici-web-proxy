import { describe, expect, it } from "vitest";
import { classifyRequest, type Route, type RouteInput } from "../src/sw/route.ts";

const origin = "http://127.0.0.1:41000";
const page = `${origin}/~/https/site-a.test/dir/page`;

function input(url: string, extra: Partial<RouteInput> = {}): RouteInput {
  return { url, origin, navigation: false, clientUrl: page, referrer: null, ...extra };
}

// URL objects carry no own enumerable properties, so toEqual would call any two of them equal.
function summary(route: Route) {
  return route.kind === "proxy" ? { kind: route.kind, target: route.target.href, navigation: route.navigation } : route;
}

describe("classifyRequest", () => {
  it("passes reserved paths through", () => {
    for (const path of ["/", "/robots.txt", "/_g/sw.js", "/_g/r/https/x/"]) {
      expect(summary(classifyRequest(input(origin + path)))).toEqual({ kind: "passthrough" });
    }
  });

  it("proxies proxy paths and canonicalises them", () => {
    expect(
      summary(classifyRequest(input(`${origin}/~/https/site-a.test/x?y=1`, { navigation: true, clientUrl: null }))),
    ).toEqual({ kind: "proxy", target: "https://site-a.test/x?y=1", navigation: true });
    expect(
      summary(classifyRequest(input(`${origin}/~/https/site-a.test`, { navigation: true, clientUrl: null }))),
    ).toEqual({ kind: "redirect", location: "/~/https/site-a.test/" });
    expect(summary(classifyRequest(input(`${origin}/~/ftp/x/`)))).toEqual({ kind: "invalid" });
  });

  it("maps root-relative requests onto the page's real origin", () => {
    expect(summary(classifyRequest(input(`${origin}/style.css?v=2`)))).toEqual({
      kind: "redirect",
      location: "/~/https/site-a.test/style.css?v=2",
    });
    expect(
      summary(classifyRequest(input(`${origin}/page2`, { navigation: true, clientUrl: null, referrer: page }))),
    ).toEqual({ kind: "redirect", location: "/~/https/site-a.test/page2" });
  });

  it("proxies cross-origin subresources of proxied pages", () => {
    expect(summary(classifyRequest(input("https://cdn.site-a.test/b.png")))).toEqual({
      kind: "proxy",
      target: "https://cdn.site-a.test/b.png",
      navigation: false,
    });
  });

  it("leaves requests from the Girici UI alone", () => {
    expect(summary(classifyRequest(input("https://cdn.example.com/x.png", { clientUrl: `${origin}/` })))).toEqual({
      kind: "passthrough",
    });
    expect(summary(classifyRequest(input(`${origin}/unknown`, { clientUrl: `${origin}/` })))).toEqual({
      kind: "passthrough",
    });
  });
});
