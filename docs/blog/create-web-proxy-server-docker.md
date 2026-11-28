---
title: "How to Create a Web Proxy Server With Docker"
titleTemplate: false
description: "Create a self-hosted web proxy server in a few commands: run Girici with Docker, claim it with the setup code, add HTTPS with Caddy, then update and back up."
headline: "How to create your own web proxy server with Docker"
date: "2026-11-28"
keyword: "how to create a proxy server"
faq: [{"q": "How do I create my own web proxy server?", "a": "Run a web proxy such as Girici with Docker (docker run -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest), create the admin account with the setup code from the log, then put it behind HTTPS on your domain."}, {"q": "Why does my self-hosted web proxy need HTTPS?", "a": "Girici runs on a service worker, and browsers only allow service workers over HTTPS, except on localhost."}]
---

# How to create your own web proxy server with Docker

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">This tutorial creates a web proxy server you own: a site you open in any browser to browse other sites through your server. It uses Girici, an open source web proxy that ships as one Docker image for amd64 and arm64, and ends with HTTPS on your own domain.</p>

## What you need

- A machine with Docker: a home server, a Raspberry Pi class device (arm64) or a VPS.
- For use from other devices: a domain name pointing at the machine, and ports 80 and 443 open for HTTPS.

## Step 1: run the container

```bash
docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest
```

- `-v girici_data:/data` keeps the SQLite database, which holds the admin account and settings, across restarts and updates.
- `latest` follows the newest v2 release. `v2` does the same, and tags like `2.1` or `2.1.2` pin a version. The same tags are on `ghcr.io/halitsever/girici-web-proxy`.

Check that it is up:

```bash
curl -fsS http://localhost:3000/healthz   # prints: ok
```

## Step 2: claim it with the setup code

Girici prints a one-time code to its log at startup:

```bash
docker logs girici 2>&1 | grep "setup code"
```

Open `http://localhost:3000`, enter the code and create the admin account (password of at least 8 characters). Only someone who can read the server log can do this, so an instance that is already reachable cannot be claimed by a stranger. A restart prints a new code until setup is done; set `GIRICI_SETUP_TOKEN` to choose the code yourself in automated deployments.

You can now browse through it on `localhost`. Type an address in the bar and the site opens through your server.

## Step 3: HTTPS on a domain

Girici runs on a service worker, and browsers allow service workers only over HTTPS, except on `localhost`. To use it from your phone or another computer, put it behind HTTPS. The repository includes a Caddy profile that gets certificates automatically:

```bash
git clone https://github.com/halitsever/girici-web-proxy.git
cd girici-web-proxy
GIRICI_DOMAIN=proxy.example.com GIRICI_TRUST_PROXY=1 docker compose --profile https up -d
```

Point `proxy.example.com` at the server first. `GIRICI_TRUST_PROXY=1` tells Girici that one proxy, Caddy, sits in front of it, so rate limits count each visitor. Keep port 3000 closed to the internet so nobody can skip Caddy.

No open ports, or behind a home router? Use Cloudflare Tunnel instead; the [reverse proxy guide](/guide/reverse-proxy#cloudflare-tunnel) has the Compose file and [error 1033](/blog/cloudflare-tunnel-error-1033) covers the most common tunnel failure.

## Step 4: decide who can use it

Public access is off by default: only the admin can browse. Turn it on in **Settings** only if you mean to share the proxy, and read the [threat model](/guide/threat-model) first. Whoever runs a web proxy can see the traffic that goes through it, so the people you share it with have to trust you.

## Step 5: updates and backups

A new version may update the database when it starts, and older versions then refuse to open it. Back up the volume before you update:

```bash
docker run --rm -v girici_data:/data -v "$PWD":/backup alpine tar czf /backup/girici-data.tgz -C /data .
docker pull halitsever/girici-web-proxy:latest
docker rm -f girici
docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest
```

Release images are signed with cosign and carry provenance and an SBOM.

## If a site does not work

Many sites judge the server's IP before the proxy gets a say. Datacenter addresses get more CAPTCHAs and refusals than a home connection. The [supported sites](/guide/supported-sites) table records what worked in testing, and `GIRICI_UPSTREAM_PROXY` can route outgoing traffic through another HTTP or SOCKS5 proxy. [Troubleshooting](/guide/troubleshooting) covers the rest.

For Render, Fly.io and Railway instead of your own server, see the [deploy page](/deploy/).

## FAQ

### How do I create my own web proxy server?

Run a web proxy such as Girici with Docker (docker run -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest), create the admin account with the setup code from the log, then put it behind HTTPS on your domain.

### Why does my self-hosted web proxy need HTTPS?

Girici runs on a service worker, and browsers only allow service workers over HTTPS, except on localhost.

## Related posts

- [Proxy server vs a proxy in the browser: how web proxies work](/blog/proxy-server-browser)
- [Cloudflare Tunnel error 1033: causes and fixes](/blog/cloudflare-tunnel-error-1033)
- [Free online web proxies vs hosting your own](/blog/free-online-web-proxy-vs-self-hosted)
- [All posts](/blog/)
