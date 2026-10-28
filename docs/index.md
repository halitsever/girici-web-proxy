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
  - icon:
      src: /icons/globe.svg
      width: 28
      height: 28
    title: HTTP, HTTPS and WebSocket
    details: Classic sites, single-page apps, media, and realtime connections all route through one origin.
  - icon:
      src: /icons/shield.svg
      width: 28
      height: 28
    title: Safe by default
    details: An SSRF guard, CSRF checks, no sensitive logging, and an admin login gate are on out of the box.
  - icon:
      src: /icons/server.svg
      width: 28
      height: 28
    title: Your server's connection
    details: Run Girici on a server and browse through its network, wherever you deploy it.
  - icon:
      src: /icons/box.svg
      width: 28
      height: 28
    title: One-command Docker
    details: A single image, a persistent volume for its database, and an optional Caddy profile for HTTPS.
---

<div class="gi-home">

<section class="gi-section">
  <div class="gi-head gi-reveal">
    <h2 class="gi-h2">One window to the whole web</h2>
    <p class="gi-lead">Every site opens from a single origin, so links, logins and media keep working. Here are the browse screen, first-run setup, and the sign-in gate.</p>
  </div>
  <div class="gi-showcase">
    <figure class="gi-shot gi-reveal">
      <img src="/screenshot.png" alt="The Girici browse screen" />
      <figcaption>Browse: type a URL or search, and it routes through one origin.</figcaption>
    </figure>
    <div class="gi-shot-row">
      <figure class="gi-shot gi-reveal">
        <img src="/screenshot-setup.png" alt="The first-run setup screen" />
        <figcaption>First run: create the single admin account.</figcaption>
      </figure>
      <figure class="gi-shot gi-reveal">
        <img src="/screenshot-signin.png" alt="The sign-in screen" />
        <figcaption>Private by default: sign in to keep browsing.</figcaption>
      </figure>
    </div>
  </div>
</section>

<section class="gi-section">
  <div class="gi-head gi-reveal">
    <h2 class="gi-h2">How it works</h2>
    <p class="gi-lead">A service worker catches every request a page makes. The rewriting happens in your browser; the server only relays bytes.</p>
  </div>
  <ol class="gi-steps">
    <li class="gi-step gi-reveal">
      <span class="gi-step-n">1</span>
      <h3>Register the worker</h3>
      <p>The web UI registers <code>/_g/sw.js</code> at the root scope, so it sees every subrequest the page makes.</p>
    </li>
    <li class="gi-step gi-reveal">
      <span class="gi-step-n">2</span>
      <h3>Route through one origin</h3>
      <p>Pages open as <code>/~/https/site/…</code>, so the browser resolves relative links, imports and <code>url()</code> on its own.</p>
    </li>
    <li class="gi-step gi-reveal">
      <span class="gi-step-n">3</span>
      <h3>Rewrite and relay</h3>
      <p>The engine rewrites HTML, CSS and JS in the worker and relays the bytes through an SSRF-guarded server.</p>
    </li>
  </ol>
</section>

<section class="gi-section gi-section-last">
  <div class="gi-head gi-reveal">
    <h2 class="gi-h2">Get started in one command</h2>
    <p class="gi-lead">Run the published image, or build from source. On first run, Girici walks you through creating the admin.</p>
  </div>
  <div class="gi-reveal">
    <pre class="gi-code"><span class="gi-code-prompt">$</span>docker run -d -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest</pre>
    <div class="gi-cta-actions">
      <a class="gi-btn gi-btn-primary" href="/guide/getting-started">Get started</a>
      <a class="gi-btn" href="/guide/docker">Run with Docker</a>
    </div>
  </div>
</section>

</div>
