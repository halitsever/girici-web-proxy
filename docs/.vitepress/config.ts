import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineConfig, type DefaultTheme, type SiteConfig } from "vitepress";

const repo = "https://github.com/halitsever/girici-web-proxy";

const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: "Guide",
    items: [
      { text: "Getting started", link: "/guide/getting-started" },
      { text: "How it works", link: "/guide/how-it-works" },
      { text: "Admin and auth", link: "/guide/admin-and-auth" },
      { text: "Configuration", link: "/guide/configuration" },
      { text: "Running with Docker", link: "/guide/docker" },
    ],
  },
  {
    text: "Project",
    items: [
      { text: "Contributing", link: "/contributing" },
      { text: "Security policy", link: `${repo}/security/policy` },
      { text: "License (AGPL-3.0)", link: `${repo}/blob/main/LICENSE` },
    ],
  },
];

/** Builds llms.txt from the sidebar and ships each page's markdown next to its HTML for LLM tools. */
async function writeLlmsTxt({ srcDir, outDir, site }: SiteConfig) {
  const header = `# ${site.title}\n\n> ${site.description}`;
  const sections: string[] = [];
  const pages: string[] = [];
  for (const group of sidebar) {
    const lines = [`## ${group.text}`, ""];
    for (const { text, link } of group.items ?? []) {
      if (!link) continue;
      if (!link.startsWith("/")) {
        lines.push(`- [${text}](${link})`);
        continue;
      }
      const page = (await readFile(join(srcDir, `${link}.md`), "utf8"))
        .replace(/^---\n[\s\S]*?\n---\n/, "")
        .replaceAll("](/", `](${site.base}`)
        .trim();
      const target = join(outDir, `${link}.md`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${page}\n`);
      // The paragraph under the H1 doubles as the page summary.
      const intro = page.split(/\n\s*\n/)[1] ?? "";
      const summary = /^(#|```|:::|\||-|>|<)/.test(intro) ? "" : `: ${intro.replace(/\s*\n\s*/g, " ")}`;
      lines.push(`- [${text}](${site.base}${link.slice(1)}.md)${summary}`);
      pages.push(page);
    }
    sections.push(lines.join("\n"));
  }
  await writeFile(join(outDir, "llms.txt"), `${[header, ...sections].join("\n\n")}\n`);
  await writeFile(join(outDir, "llms-full.txt"), `${[header, ...pages].join("\n\n---\n\n")}\n`);
}

export default defineConfig({
  lang: "en-US",
  title: "Girici",
  description: "A self-hosted web proxy built on its own service worker engine.",
  // "/" for local dev; the Pages workflow sets DOCS_BASE to the project path.
  base: process.env.DOCS_BASE || "/",
  // The app is dark-only; drop the toggle so the docs match it.
  appearance: "force-dark",
  cleanUrls: true,
  lastUpdated: true,
  buildEnd: writeLlmsTxt,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#0A0F1E" }],
    ["meta", { property: "og:title", content: "Girici" }],
    [
      "meta",
      { property: "og:description", content: "A self-hosted web proxy built on its own service worker engine." },
    ],
  ],
  themeConfig: {
    logo: "/girici-icon-dark.svg",
    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "Configuration", link: "/guide/configuration" },
      { text: "Contributing", link: "/contributing" },
    ],
    sidebar,
    socialLinks: [{ icon: "github", link: repo }],
    search: { provider: "local" },
    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the AGPL-3.0 License.",
      copyright: "Copyright © 2024-present Halit Sever",
    },
  },
});
