# Cloud platforms

Girici runs on any platform that runs a Docker image, gives it HTTPS and keeps a disk. The repository has ready
configs for Render and Fly.io, and the settings for a Railway template are below.

::: warning Give it a persistent disk
Girici keeps the admin account, settings and blocked sites in `/data/girici.db`. Without a persistent disk mounted
at `/data`, every deploy or restart wipes them, and the next visitor can run first-time setup again if they have the
setup code. All three setups below attach a disk; do not remove it.
:::

After the first deploy, open the platform's log, copy the line `Girici setup code: XXXX-XXXX-XXXX`, open the app's
URL and create the admin account. The code changes on every restart until setup is done.

All three platforms put one proxy in front of the app, so the configs set `GIRICI_TRUST_PROXY=1`. See
[Reverse proxies](/guide/reverse-proxy) for what that means.

## Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/halitsever/girici-web-proxy)

The button reads [`render.yaml`](https://github.com/halitsever/girici-web-proxy/blob/main/render.yaml). It runs the
published image `halitsever/girici-web-proxy:v2` on the Starter plan with a 1 GB disk at `/data`. Render's free
plan has no disks, so it is not offered.

Render does not pull new images on its own. To update, choose **Manual Deploy → Deploy latest reference** in the
service. A service with a disk cannot scale to more than one instance, which is what Girici needs anyway.

## Fly.io

Fly has no deploy button; use `flyctl` with the repository's
[`fly.toml`](https://github.com/halitsever/girici-web-proxy/blob/main/fly.toml):

```bash
curl -O https://raw.githubusercontent.com/halitsever/girici-web-proxy/main/fly.toml
fly launch --copy-config --no-deploy   # pick an app name and region
fly volumes create girici_data --size 1
fly deploy
fly logs | grep "setup code"
```

Create the volume before the first deploy. A Fly volume belongs to one machine, so keep a single machine
(`fly scale count 1`). The config keeps that machine running: a stopped machine drops open WebSockets and prints a
new setup code when it wakes up. To update, run `fly deploy` again; it pulls the current `v2` image.

## Railway

Railway builds a template from a Docker image plus a volume. Until a published template link is in the README, set
it up by hand:

1. **New project → Deploy a Docker image**, image `halitsever/girici-web-proxy:v2`.
2. Add a **volume** to the service, mounted at `/data`.
3. Add the variables:
   - `GIRICI_DATA_DIR=/data`
   - `GIRICI_TRUST_PROXY=1`
   - `RAILWAY_RUN_UID=0`, because Railway mounts volumes as root and the image runs as the `node` user, which could
     not write to it otherwise.
4. Under **Networking**, generate a domain. Railway routes it to the port in `PORT`, which Girici reads.
5. Set the health check path to `/healthz`.

To share this as a one-click template, generate a template from the project in Railway; the volume and variables
carry over.

## Other platforms

Anything works that can:

- run `halitsever/girici-web-proxy` (or build the `Dockerfile`);
- mount a persistent disk at `/data`, writable by the `node` user (UID 1000);
- serve it over HTTPS with WebSocket support.

Serverless platforms that start a fresh instance per request, or have no disk, cannot run Girici.
