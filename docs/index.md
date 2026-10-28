---
layout: home
hero:
  name: Girici
  text: Your own web proxy.
  tagline: A self-hosted proxy built on its own service worker engine. Open any site through a single origin, with safe defaults and a one-command setup.
  image:
    src: /girici-icon-dark.svg
    alt: Girici
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: How it works
      link: /guide/how-it-works
    - theme: alt
      text: GitHub
      link: https://github.com/halitsever/girici-web-proxy
features:
  - icon: 🌐
    title: HTTP, HTTPS and WebSocket
    details: Classic sites, single-page apps, media, and realtime connections all route through one origin.
  - icon: 🔒
    title: Safe by default
    details: An SSRF guard, CSRF checks, no sensitive logging, and an admin login gate are on out of the box.
  - icon: 🧑‍💻
    title: Your server's connection
    details: Run Girici on a server and browse through its network, wherever you deploy it.
  - icon: 🐳
    title: One-command Docker
    details: A single image, a persistent volume for its database, and an optional Caddy profile for HTTPS.
---

<div style="max-width: 1152px; margin: 56px auto 0; padding: 0 24px;">

![The Girici browse screen](/screenshot.png)

</div>
