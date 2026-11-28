---
title: "Deploy a Self-Hosted Web Proxy: Docker, Render, Fly"
titleTemplate: false
description: "Every way to deploy Girici, a self-hosted web proxy: docker run, HTTPS with Caddy, Cloudflare Tunnel, Render, Fly.io and Railway, plus a security checklist."
aside: false
faq:
  - q: "What is the quickest way to self-host a web proxy?"
    a: "Run docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest, read the setup code with docker logs girici, and create the admin account at http://localhost:3000."
  - q: "Does a self-hosted web proxy need HTTPS?"
    a: "Yes, on any address other than localhost. Girici runs on a service worker, and browsers only allow service workers over HTTPS."
  - q: "Can I deploy Girici on a free plan?"
    a: "Girici needs a persistent disk at /data. Render's free plan has no disks, so its Blueprint uses the Starter plan. Fly.io and Railway need a volume too."
  - q: "Which CPU architectures does the image support?"
    a: "One image covers amd64 and arm64, on Docker Hub and on ghcr.io."
---

# Deploy Girici, a self-hosted web proxy

Girici runs from one Docker image for amd64 and arm64, with a SQLite file in `/data` as its only state. Pick where it runs, give it a persistent volume and HTTPS, and claim it with the setup code from its log.

```bash
docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest
docker logs girici 2>&1 | grep "setup code"
```

Open `http://localhost:3000`, enter the code and create the admin account. That is a working proxy on your own machine. The options below put it on a domain.

## Choose where it runs

| Option | You need | HTTPS from | Guide |
| --- | --- | --- | --- |
| Your server + Caddy | Docker, a domain, ports 80 and 443 | Caddy, automatic certificates | [Docker](/guide/docker#https-with-caddy) |
| Your server + Cloudflare Tunnel | Docker, a domain on Cloudflare; no open ports | Cloudflare | [Reverse proxies](/guide/reverse-proxy#cloudflare-tunnel) |
| Your server + nginx or Traefik | An existing reverse proxy | Your proxy | [Reverse proxies](/guide/reverse-proxy) |
| Render | A Render account, Starter plan for the disk | Render | [Cloud platforms](/guide/cloud-platforms#render) |
| Fly.io | `flyctl`, a 1 GB volume | Fly | [Cloud platforms](/guide/cloud-platforms#fly-io) |
| Railway | A Railway project with a volume | Railway | [Cloud platforms](/guide/cloud-platforms#railway) |

A home server gets further with many sites than a datacenter IP; see [supported sites](/guide/supported-sites).

## Your server with Caddy

The repository's Compose file has a Caddy service behind an `https` profile:

```bash
git clone https://github.com/halitsever/girici-web-proxy.git
cd girici-web-proxy
GIRICI_DOMAIN=proxy.example.com GIRICI_TRUST_PROXY=1 docker compose --profile https up -d
```

Point the domain at the server before you start, and keep Girici's own port 3000 closed to the internet so nobody can skip Caddy.

## Cloudflare Tunnel

`cloudflared` connects out to Cloudflare, so the server needs no open ports:

```yaml
services:
  girici:
    image: halitsever/girici-web-proxy:latest
    restart: unless-stopped
    environment:
      GIRICI_TRUST_PROXY: "1"
    volumes:
      - girici_data:/data

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}

volumes:
  girici_data:
```

Point the tunnel's public hostname at `http://girici:3000`. Turn off Rocket Loader and anything else that rewrites JavaScript for `/_g/*`. If you get error 1033, see [Cloudflare Tunnel error 1033](/blog/cloudflare-tunnel-error-1033); for realtime sites, [Cloudflare Tunnel and WebSockets](/blog/cloudflare-tunnel-websocket).

## One-click and cloud platforms

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/halitsever/girici-web-proxy)

- **Render:** the button reads `render.yaml` and runs the published `v2` image on the Starter plan with a 1 GB disk at `/data`. Render does not pull new images by itself; use **Manual Deploy, Deploy latest reference** to update.
- **Fly.io:** no button; use the repository's `fly.toml`:

```bash
curl -O https://raw.githubusercontent.com/halitsever/girici-web-proxy/main/fly.toml
fly launch --copy-config --no-deploy
fly volumes create girici_data --size 1
fly deploy
fly logs | grep "setup code"
```

- **Railway:** deploy the image `halitsever/girici-web-proxy:v2`, add a volume at `/data`, and set `GIRICI_DATA_DIR=/data`, `GIRICI_TRUST_PROXY=1` and `RAILWAY_RUN_UID=0`, then generate a domain under **Networking**.

Every platform needs a persistent disk at `/data`. Without one, each deploy or restart deletes the admin account and puts the instance back into first-run setup.

## Security checklist

On by default, nothing to do:

- **SSRF guard.** Every target is checked before Girici connects: no private, loopback or link-local addresses, and only ports 80, 443, 8080 and 8443.
- **Setup code.** Only someone who can read the server log can create the first admin.
- **Public access off.** Only the admin can browse until you turn it on in Settings.
- **CSRF and origin checks, and a sign-in rate limit.**
- **Quiet logs.** At the default log level, no target URLs, cookies or tokens.
- **Per-site cookie jars,** with third-party cookies blocked by default.

Up to you:

- **`GIRICI_TRUST_PROXY`** set to the number of proxies in front of Girici: `1` for Caddy, nginx, Traefik, a tunnel straight to Girici, Fly, Render or Railway. Never `true`.
- **Port 3000 not reachable** except through your proxy.
- **Backups** of the `/data` volume before updates, since a new version may migrate the database.
- **Run released images.** Release images are signed with cosign and carry provenance and an SBOM.

The [threat model](/guide/threat-model) explains what these protect and what they cannot: the operator of a web proxy can see all traffic through it, and by default all proxied sites share one origin unless you use [subdomain mode](/guide/subdomain-mode).

## After deploying

1. Open the instance and create the admin with the setup code.
2. Check `https://your-domain/healthz` answers `ok`; [monitoring](/guide/monitoring) has the rest.
3. Browse a test site, for example Wikipedia.
4. Read [configuration](/guide/configuration) for rate limits, blocked hosts and an upstream proxy.

New to this? [Create a web proxy server with Docker](/blog/create-web-proxy-server-docker) walks through the same steps with explanations, and the [blog](/blog/) covers how web proxies work.

## FAQ

### What is the quickest way to self-host a web proxy?

Run `docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest`, read the setup code with `docker logs girici`, and create the admin account at `http://localhost:3000`.

### Does a self-hosted web proxy need HTTPS?

Yes, on any address other than `localhost`. Girici runs on a service worker, and browsers only allow service workers over HTTPS.

### Can I deploy Girici on a free plan?

Girici needs a persistent disk at `/data`. Render's free plan has no disks, so its Blueprint uses the Starter plan. Fly.io and Railway need a volume too.

### Which CPU architectures does the image support?

One image covers amd64 and arm64, on Docker Hub and on ghcr.io.
