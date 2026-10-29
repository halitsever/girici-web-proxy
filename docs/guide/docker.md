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
      - "3000:3000"
    environment:
      LOG_LEVEL: info
      GIRICI_DATA_DIR: /data
    volumes:
      - girici_data:/data

volumes:
  girici_data:
```

::: tip
`latest` is v2 (v2.0.0 and newer); the last v1 image stays available as `halitsever/girici-web-proxy:v1`.
Keep `build: .` to run v2 from this repository instead of the published image.
:::

## Plain docker run

Give the container a volume for `/data` so its database persists:

```bash
docker run -d -p 3000:3000 -v girici_data:/data girici-web-proxy
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
cap count each visitor instead of lumping everyone under Caddy's address. Remove the `ports` mapping of the `girici`
service when you do this, so nobody can reach Girici directly with a forged `X-Forwarded-For`.

## Resetting the admin password in a container

Run the reset tool inside the running container so it uses the mounted database:

```bash
docker compose exec girici node reset-admin-password.js
```

It prints a fresh random password and signs out other sessions. See
[Admin and auth](/guide/admin-and-auth).
