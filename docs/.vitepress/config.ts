import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineConfig, type DefaultTheme, type HeadConfig, type SiteConfig } from "vitepress";

const repo = "https://github.com/halitsever/girici-web-proxy";
const siteUrl = "https://projects.halit.org/girici-web-proxy/";
// "/" for local dev; the Pages workflow sets DOCS_BASE to the project path.
const base = process.env.DOCS_BASE || "/";
const description =
  "Girici is a self-hosted web proxy for Node.js, written in TypeScript and Vue. A Node.js alternative to php-proxy that runs in Docker.";

const license = "https://www.gnu.org/licenses/agpl-3.0.html";
const person = { "@type": "Person", name: "Halit Sever", url: "https://halit.org" };
const author = { "@type": "Person", name: "Halit Sever", url: "https://github.com/halitsever" };

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareSourceCode",
      "@id": `${siteUrl}#source`,
      name: "Girici",
      description,
      url: siteUrl,
      image: `${siteUrl}og.png`,
      codeRepository: repo,
      programmingLanguage: "TypeScript",
      license,
      author,
    },
  ],
};

/** BlogPosting and breadcrumbs for posts, FAQPage wherever the page shows an FAQ. */
function pageJsonLd(fm: Record<string, any>, url: string, title: string, pageDescription: string) {
  const graph: object[] = [];
  if (fm.date) {
    graph.push(
      {
        "@type": "BlogPosting",
        headline: fm.headline ?? title,
        description: pageDescription,
        url,
        mainEntityOfPage: url,
        datePublished: fm.date,
        dateModified: fm.date,
        inLanguage: "en",
        image: `${siteUrl}og.png`,
        keywords: fm.keyword,
        author: person,
        publisher: person,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Girici", item: siteUrl },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${siteUrl}blog/` },
          { "@type": "ListItem", position: 3, name: fm.headline ?? title, item: url },
        ],
      },
    );
  }
  if (fm.faq?.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: fm.faq.map((f: { q: string; a: string }) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a.replace(/<[^>]+>|`|\*\*/g, "") },
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: "Guide",
    items: [
      { text: "Getting started", link: "/guide/getting-started" },
      { text: "How it works", link: "/guide/how-it-works" },
      { text: "Admin and auth", link: "/guide/admin-and-auth" },
      { text: "Configuration", link: "/guide/configuration" },
      { text: "Running with Docker", link: "/guide/docker" },
      { text: "Supported sites", link: "/guide/supported-sites" },
      { text: "php-proxy alternative", link: "/guide/php-proxy-alternative" },
      { text: "Deploy", link: "/deploy/" },
    ],
  },
  {
    text: "Operate",
    items: [
      { text: "Reverse proxies", link: "/guide/reverse-proxy" },
      { text: "Subdomain mode", link: "/guide/subdomain-mode" },
      { text: "Cloud platforms", link: "/guide/cloud-platforms" },
      { text: "Monitoring", link: "/guide/monitoring" },
      { text: "Troubleshooting and FAQ", link: "/guide/troubleshooting" },
      { text: "Migrating from v1", link: "/guide/migrating-from-v1" },
      { text: "Threat model", link: "/guide/threat-model" },
    ],
  },
  {
    text: "Blog",
    collapsed: true,
    items: [
      { text: "All posts", link: "/blog/" },
      { text: "Proxy server vs web proxy", link: "/blog/proxy-server-browser" },
      { text: "YouTube through a web proxy", link: "/blog/youtube-web-proxy" },
      { text: "Cloudflare Tunnel error 1033", link: "/blog/cloudflare-tunnel-error-1033" },
      { text: "Proxyium alternative", link: "/blog/proxyium-alternative" },
      { text: "Free web proxies vs self-hosted", link: "/blog/free-online-web-proxy-vs-self-hosted" },
      { text: "Cloudflare Tunnel and WebSockets", link: "/blog/cloudflare-tunnel-websocket" },
      { text: "Create a web proxy with Docker", link: "/blog/create-web-proxy-server-docker" },
      { text: "proxy.py vs a web proxy", link: "/blog/proxypy-alternative" },
      { text: "Forward vs reverse proxy", link: "/blog/forward-proxy-vs-reverse-proxy" },
      { text: "VPN vs proxy", link: "/blog/vpn-vs-proxy" },
      { text: "X-Forwarded-For", link: "/blog/x-forwarded-for" },
      { text: "SSRF in a web proxy", link: "/blog/ssrf-web-proxy" },
      { text: "DNS rebinding", link: "/blog/dns-rebinding" },
      { text: "SSH SOCKS5 proxy", link: "/blog/ssh-socks5-proxy" },
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

const llmsIntro = [
  "Install: `docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest`, then",
  "enter the setup code from `docker logs girici` at http://localhost:3000. Service workers need HTTPS on any address",
  "other than localhost, and the operator of an instance can read all proxied traffic.",
].join(" ");

const llmsOptional = [
  "## Optional",
  "",
  `- [Source](${repo}): repository`,
  "- [Docker Hub](https://hub.docker.com/r/halitsever/girici-web-proxy): container image",
].join("\n");

/** Builds llms.txt from the sidebar and ships each page's markdown next to its HTML for LLM tools. */
async function writeLlmsTxt({ srcDir, outDir, site }: SiteConfig) {
  const header = `# ${site.title}\n\n> ${site.description}\n\n${llmsIntro}`;
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
      // Folder links such as /deploy/ come from an index.md.
      const file = link.endsWith("/") ? `${link}index` : link;
      const source = await readFile(join(srcDir, `${file}.md`), "utf8");
      const page = source
        .replace(/^---\n[\s\S]*?\n---\n/, "")
        .replaceAll("](/", `](${site.base}`)
        .trim();
      const target = join(outDir, `${file}.md`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${page}\n`);
      // The front matter description is the page summary; the paragraph under the H1 is the fallback.
      const described = /^---\n[\s\S]*?^description: "(.*)"$/m.exec(source)?.[1];
      const intro = page.split(/\n\s*\n/)[1] ?? "";
      const fallback = /^(#|```|:::|\||-|>|<)/.test(intro) ? "" : intro.replace(/\s*\n\s*/g, " ");
      const summary = described ?? fallback;
      lines.push(`- [${text}](${siteUrl}${file.slice(1)}.md)${summary ? `: ${summary}` : ""}`);
      pages.push(page);
    }
    sections.push(lines.join("\n"));
  }
  await writeFile(join(outDir, "llms.txt"), `${[header, ...sections, llmsOptional].join("\n\n")}\n`);
  await writeFile(join(outDir, "llms-full.txt"), `${[header, ...pages].join("\n\n---\n\n")}\n`);
}

export default defineConfig({
  /** keeps the page hash map out of every page's HTML, which Semrush reads as a low text-to-HTML ratio */
  metaChunk: true,
  lang: "en-US",
  title: "Girici",
  description,
  base,
  // The app is dark-only; drop the toggle so the docs match it.
  appearance: "force-dark",
  cleanUrls: true,
  lastUpdated: true,
  buildEnd: writeLlmsTxt,
  head: [
    /** Cloudflare Web Analytics, one token for every page on projects.halit.org. */
    [
      "script",
      {
        defer: "",
        src: "https://static.cloudflareinsights.com/beacon.min.js",
        "data-cf-beacon": '{"token": "dd7e54d3f48841c187d72d9dbb92a6b6"}',
      },
    ],
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}favicon.svg` }],
    ["meta", { name: "theme-color", content: "#0A0F1E" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Girici" }],
    ["meta", { property: "og:image", content: `${siteUrl}og.png` }],
    ["meta", { property: "og:image:width", content: "1280" }],
    ["meta", { property: "og:image:height", content: "640" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: `${siteUrl}og.png` }],
    ["script", { type: "application/ld+json" }, JSON.stringify(jsonLd)],
  ],
  sitemap: { hostname: siteUrl },
  transformHead({ pageData, title, description: pageDescription }) {
    if (pageData.isNotFound) return;
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
    const url = `${siteUrl}${path}`;
    const fm = pageData.frontmatter;
    const head: HeadConfig[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: pageDescription }],
    ];
    if (fm.date) head.push(["meta", { property: "article:published_time", content: fm.date }]);
    if (fm.date || fm.faq)
      head.push([
        "script",
        { type: "application/ld+json" },
        JSON.stringify(pageJsonLd(fm, url, title, pageDescription)),
      ]);
    return head;
  },
  themeConfig: {
    logo: { src: "/girici-icon-dark.svg", alt: "Girici logo" },
    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "Configuration", link: "/guide/configuration" },
      { text: "Deploy", link: "/deploy/" },
      { text: "Blog", link: "/blog/", activeMatch: "/blog/" },
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
