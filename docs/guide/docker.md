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
Until v2.0.0 is released, the published `latest` tag is still v1. Use `build: .` to run v2 from this
repository, as the compose file does.
:::

## Plain docker run

Give the container a volume for `/data` so its database persists:

```bash
docker run -d -p 3000:3000 -v girici_data:/data girici-web-proxy
```

## HTTPS with Caddy

The compose file includes an optional Caddy service behind an `https` profile. It terminates TLS and
speaks HTTP/2 to Girici.

```bash
GIRICI_DOMAIN=proxy.example docker compose --profile https up -d
```

Edit `deploy/Caddyfile` for your domain and certificate setup.

## Resetting the admin password in a container

Run the reset tool inside the running container so it uses the mounted database:

```bash
docker compose exec girici node reset-admin-password.js
```

It prints a fresh random password and signs out other sessions. See
[Admin and auth](/guide/admin-and-auth).
