import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import SiteBadge from "../SiteBadge.vue";

const render = (host: string) => renderToString(createSSRApp({ render: () => h(SiteBadge, { host }) }));

describe("SiteBadge", () => {
  it("asks the server for the site's icon and shows its first letter until it loads", async () => {
    const html = await render("news.ycombinator.com");
    expect(html).toContain('src="/_g/favicon?host=news.ycombinator.com"');
    expect(html).toMatch(/aria-hidden="true"[^>]*>N</);
  });

  it("encodes the host into the icon address", async () => {
    expect(await render("a&b.test")).toContain('src="/_g/favicon?host=a%26b.test"');
  });
});
