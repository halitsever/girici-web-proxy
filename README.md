<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/web/src/assets/brand/girici-icon-dark.svg">
    <img src="packages/web/src/assets/brand/girici-icon.svg" height="120" alt="Girici">
  </picture>
</p>
<h1 align="center">Girici</h1>

<p align="center">
🌐 Web proxy project written in Typescript & Vue.js. Node.js alternative for php-proxy.
<br/>
<br/>
<img src="https://img.shields.io/github/sponsors/halitsever"/>
<img src="https://img.shields.io/github/license/halitsever/girici-web-proxy"/>
<a href="https://hub.docker.com/r/halitsever/girici-web-proxy"><img src="https://img.shields.io/docker/pulls/halitsever/girici-web-proxy"/></a>
<a href="https://hub.docker.com/r/halitsever/girici-web-proxy"><img src="https://img.shields.io/docker/v/halitsever/girici-web-proxy?sort=semver&label=docker"/></a>
</p>

> **Note:** Girici v1 is no longer maintained. v2, built on its own service worker engine, is the current release.
> `latest` now points to v2; the last v1 image stays available as `halitsever/girici-web-proxy:v1`.

<div align="center">
<img src="https://halitsever-api.vercel.app/api/details"/>
</div>

- 📝 [**Http/Https Support**](#) - http/https protocols are supported
- 🧑‍💻 [**Can run inside docker**](#) - you can run girici inside of container
- 🎨 [**Fancy UI**](#) - looking good ui for surfing on internet without restriction
- 🎨 [**Use internet of server**](#) - you can install girici on server and you can use server's internet as web proxy

Girici runs on a server you control and lets you browse other sites through it. Pages open from Girici's own
address, and a service worker in your browser rewrites them so links, forms, logins, media and WebSockets keep
working inside the proxy. The server only checks and relays the traffic.

<div align="center">
<b>Screenshot</b>
<br/>
<br/>
<img src="docs/public/screenshot.png" alt="Girici Web Proxy Node.js Screenshot" width="820"/>
</div>

**[Documentation](https://halitsever.github.io/girici-web-proxy/)** ·
[Getting started](https://halitsever.github.io/girici-web-proxy/guide/getting-started) ·
[Supported sites](https://halitsever.github.io/girici-web-proxy/guide/supported-sites) ·
[Threat model](https://halitsever.github.io/girici-web-proxy/guide/threat-model)

## Features

- **Modern sites.** Classic pages, single-page apps, video, and realtime sites over WebSockets.
- **Private by default.** First-run setup with a one-time code from the server log, then an admin login. Turn on
  public access in Settings when you want anyone to use it.
- **Safe defaults.** An SSRF guard keeps visitors off your server's private network. CSRF and origin checks, rate
  limits, and logs that leave out target URLs, cookies and tokens are all on out of the box.
- **Per-site data.** Each site gets its own cookie jar and storage, with third-party cookies blocked by default.
  Clear one site's data, or all of it, from Settings or the in-page toolbar.
- **Operator tools.** A blocked sites list, an upstream proxy (HTTP or SOCKS5) for all outgoing traffic, and
  server-side YouTube poTokens.
- **Small to run.** One Docker image for amd64 and arm64, with a SQLite file as its only state. Release images are
  signed with cosign and carry provenance and an SBOM.

## Quick start

```bash
docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest
docker logs girici 2>&1 | grep "setup code"
```

Open <http://localhost:3000>, enter the setup code, and create the admin account. The volume keeps the account and
settings across restarts and updates.

Service workers need HTTPS on any address other than `localhost`. To serve Girici on a domain with automatic
certificates, clone the repository, point the domain at your server and run the bundled Caddy profile:

```bash
GIRICI_DOMAIN=proxy.example.com GIRICI_TRUST_PROXY=1 docker compose --profile https up -d
```

Keep Girici's own port 3000 closed to the internet, so nobody can skip Caddy and forge their address.

For nginx, Traefik or Cloudflare Tunnel, see [Reverse proxies](https://halitsever.github.io/girici-web-proxy/guide/reverse-proxy).

Image tags: `latest` and `v2` follow the newest v2 release, and version tags such as `2.1` and `2.1.2` pin one. The
same tags are on `ghcr.io/halitsever/girici-web-proxy`. The last v1 image stays at `halitsever/girici-web-proxy:v1`;
see [Migrating from v1](https://halitsever.github.io/girici-web-proxy/guide/migrating-from-v1).

## One-click deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/halitsever/girici-web-proxy)

- **Render:** the button uses [`render.yaml`](render.yaml).
- **Fly.io:** `fly launch --copy-config` with [`fly.toml`](fly.toml).
- **Railway:** deploy the image with a volume; the settings are in
  [Cloud platforms](https://halitsever.github.io/girici-web-proxy/guide/cloud-platforms#railway).

> [!IMPORTANT]
> Every platform needs a **persistent disk mounted at `/data`**. Without it, each deploy or restart deletes the
> admin account and settings and puts the instance back into first-run setup. The configs above include one; Render's
> free plan has no disks, so the Blueprint uses the Starter plan.

## Configuration

Girici reads environment variables and stops at startup with the variable's name if one is wrong. The most used:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `GIRICI_DATA_DIR` | `/data` in Docker | Where the SQLite database lives. Mount a volume here. |
| `GIRICI_TRUST_PROXY` | unset | The number of reverse proxies in front of Girici, for example `1`. Never `true`. |
| `GIRICI_RATE_LIMIT` | `3000` | Relay requests per visitor per minute. `0` turns it off. |
| `GIRICI_BLOCKED_HOSTS` | unset | Sites to refuse, with their subdomains. |
| `GIRICI_UPSTREAM_PROXY` | unset | Send all outgoing traffic through an `http://`, `https://`, `socks5://` or `socks5h://` proxy. |
| `GIRICI_SITE_DOMAIN` | unset | Run each proxied site on its own host under this domain ([subdomain mode](https://halitsever.github.io/girici-web-proxy/guide/subdomain-mode)). |
| `SOURCE_URL` | this repository | The source code link in the UI. Point it at your fork if you change the code. |

The full list is in [Configuration](https://halitsever.github.io/girici-web-proxy/guide/configuration).

## Know before you run it

- **The operator sees everything.** TLS to the real site ends at the Girici server, which can read all proxied
  traffic, passwords included. Only use instances you trust.
- **By default, all sites share one origin.** Girici keeps sites apart in JavaScript, which has known gaps; a hostile
  site may reach data other sites left in the same browser.
  [Subdomain mode](https://halitsever.github.io/girici-web-proxy/guide/subdomain-mode) gives each site its own host,
  so the browser keeps them apart. It needs wildcard DNS and a wildcard certificate.
- **Sites can still refuse you.** Many sites block or challenge datacenter IPs, whatever the proxy does. YouTube
  playback is partial. Voice and video calls do not work, because WebRTC is turned off.

The [threat model](https://halitsever.github.io/girici-web-proxy/guide/threat-model) and
[supported sites](https://halitsever.github.io/girici-web-proxy/guide/supported-sites) pages have the details.

## Run from source

Requires Node.js 22.19 or newer (24 LTS recommended).

```bash
npm ci
npm run build
npm start
```

Girici listens on <http://localhost:3000>. `npm run dev` rebuilds on change, and `npm run docs:dev` serves the
documentation. See [CONTRIBUTING](.github/CONTRIBUTING.md) before opening a pull request.

## Security

Report vulnerabilities privately through GitHub's private vulnerability reporting, as described in the
[security policy](.github/SECURITY.md).

<div align="center">
<a href="https://github.com/halitsever/girici-web-proxy/issues"><img src="https://halitsever-api.vercel.app/api/issue"/></a>
</div>

<div align="center">
<img src="https://halitsever-api.vercel.app/api/sponsor"/>
</div>

## License

Copyright (C) 2021-2026 Halit Sever

Girici is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public
License, version 3, as published by the Free Software Foundation. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

If you run a modified version of Girici as a network service, the AGPL requires you to offer its users the source
code of your version. Set `SOURCE_URL` to point to it; the UI links there.
