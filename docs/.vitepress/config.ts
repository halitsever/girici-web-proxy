import { defineConfig } from "vitepress";

const repo = "https://github.com/halitsever/girici-web-proxy";

export default defineConfig({
  lang: "en-US",
  title: "Girici",
  description: "A self-hosted web proxy built on its own service worker engine.",
  // "/" for local dev; the Pages workflow sets DOCS_BASE to the project path.
  base: process.env.DOCS_BASE || "/",
  appearance: "dark",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#0A0F1E" }],
    ["meta", { property: "og:title", content: "Girici" }],
    ["meta", { property: "og:description", content: "A self-hosted web proxy built on its own service worker engine." }],
  ],
  themeConfig: {
    logo: "/girici-icon-dark.svg",
    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "Configuration", link: "/guide/configuration" },
      { text: "Contributing", link: "/contributing" },
    ],
    sidebar: [
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
    ],
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
