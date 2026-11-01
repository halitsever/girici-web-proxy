# Running with Docker

## Compose

The repository ships a `docker-compose.yml` that runs Girici with a persistent volume for its database.

```bash
docker compose up -d
```

Girici is then on `http://localhost:3000`. The compose file sets `GIRICI_DATA_DIR=/data` and mounts a
named volume `girici_data` there, so the admin account and settings survive restarts and image updates.

```yaml
services:
  girici:
    image: halitsever/girici-web-proxy:latest
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    environment:
      LOG_LEVEL: info
      GIRICI_DATA_DIR: /data
      GIRICI_TRUST_PROXY: ${GIRICI_TRUST_PROXY:-}
      GIRICI_SETUP_TOKEN: ${GIRICI_SETUP_TOKEN:-}
      GIRICI_SITE_DOMAIN: ${GIRICI_SITE_DOMAIN:-}
      GIRICI_SITE_SECRET: ${GIRICI_SITE_SECRET:-}
    volumes:
      - girici_data:/data

volumes:
  girici_data:
```

The container's file system is read-only apart from the `/data` volume and a `/tmp` in memory, it has no Linux
capabilities, and it cannot gain privileges. The port is published on `127.0.0.1` only, so nothing outside the
machine reaches Girici except through a reverse proxy such as the Caddy profile below. To serve it directly on
your network instead, change the mapping to `"3000:3000"`.

Compose reads `GIRICI_DOMAIN`, `GIRICI_TRUST_PROXY`, `GIRICI_SETUP_TOKEN` and the subdomain mode settings below from a
`.env` file next to it. Copy `.env.example` to `.env` to start.

::: tip
`latest` is v2 (v2.0.0 and newer); the last v1 image stays available as `halitsever/girici-web-proxy:v1`.
Keep `build: .` to run v2 from this repository instead of the published image.
:::

## Plain docker run

Give the container a volume for `/data` so its database persists:

```bash
docker run -d -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest
```

The setup screen asks for a code that Girici prints to the container log at startup:

```bash
docker logs <container> | grep "setup code"
```

## HTTPS with Caddy

The compose file includes an optional Caddy service behind an `https` profile. It terminates TLS and
speaks HTTP/2 to Girici.

```bash
GIRICI_DOMAIN=proxy.example GIRICI_TRUST_PROXY=1 docker compose --profile https up -d
```

Edit `deploy/Caddyfile` for your domain and certificate setup.

`GIRICI_TRUST_PROXY=1` tells Girici that one proxy (Caddy) sits in front of it, so the rate limits and the WebSocket
cap count each visitor instead of lumping everyone under Caddy's address. Keep the `girici` port on `127.0.0.1`
(or remove the mapping) when you do this, so nobody can reach Girici directly with a forged `X-Forwarded-For`.

## Subdomain mode with Caddy

The `sites` profile runs Girici in [subdomain mode](/guide/subdomain-mode), where every proxied site gets its own host
under your domain. A wildcard certificate needs the DNS-01 challenge, so the profile builds Caddy with a DNS provider
module from `deploy/caddy-dns` and serves `deploy/Caddyfile.sites`, which covers the domain and every host under it.
Cloudflare DNS is the default. Point `proxy.example` and `*.proxy.example` at the server, then put the settings in
`.env`:

```bash
GIRICI_SITE_DOMAIN=proxy.example
GIRICI_TRUST_PROXY=1
CLOUDFLARE_API_TOKEN=<token with Zone.Zone:Read and Zone.DNS:Edit>
```

```bash
docker compose --profile sites up -d --build
```

Run it instead of the `https` profile, not next to it: both bind ports 80 and 443. For another DNS provider, set
`CADDY_DNS_MODULE` and change the `dns` line in `deploy/Caddyfile.sites`, as
[Another DNS provider](/guide/subdomain-mode#another-dns-provider) explains. Run the command with `--build` again
whenever the module changes.

## Resetting the admin password in a container

Run the reset tool inside the running container so it uses the mounted database:

```bash
docker compose exec girici node reset-admin-password.js
```

It prints a fresh random password and signs out other sessions. See
[Admin and auth](/guide/admin-and-auth).
