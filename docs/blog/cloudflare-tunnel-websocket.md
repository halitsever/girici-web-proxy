---
title: "Cloudflare Tunnel and WebSockets: What to Set"
titleTemplate: false
description: "WebSockets through Cloudflare Tunnel and an nginx reverse proxy: the zone setting, idle timeouts, reconnects, the nginx upgrade headers and Girici's /_g/ws."
headline: "Cloudflare Tunnel and WebSockets: what to set"
date: "2026-11-28"
keyword: "cloudflare tunnel websocket"
faq: [{"q": "Does Cloudflare Tunnel support WebSockets?", "a": "Yes. Cloudflare supports proxied WebSockets on all plans, and a tunnel hostname carries them. Make sure the zone's Network, WebSockets setting is on."}, {"q": "Why do WebSockets disconnect behind Cloudflare?", "a": "Cloudflare closes idle WebSockets after a period without data and may close them during server restarts. Clients should send heartbeats and reconnect."}]
---

# Cloudflare Tunnel and WebSockets: what to set

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">Chat apps, live dashboards and many modern sites keep a WebSocket open. A web proxy has to carry those connections too: Girici relays every proxied site's WebSockets through its own /_g/ws endpoint. Cloudflare Tunnel passes WebSockets, and nginx can, once a few headers are set.</p>

## Cloudflare: supported on all plans, with a toggle

[Cloudflare's WebSockets page](https://developers.cloudflare.com/network/websockets/) says it supports proxied WebSocket connections without additional configuration, on all plans. The zone has a switch for it: **Network**, then **WebSockets**, which should be on. A tunnel's public hostname carries WebSockets like any other request, and Girici's [reverse proxy guide](/guide/reverse-proxy#cloudflare-tunnel) notes that Cloudflare keeps the `Host` header and passes WebSockets.

Two behaviours to plan for, both from Cloudflare's docs:

- **Idle connections close.** Cloudflare closes a WebSocket when no data moves in either direction for a while. Send a ping/pong heartbeat from the client to keep it open.
- **Restarts close connections.** Cloudflare may restart servers during releases, which ends open WebSockets. Clients must reconnect.

Both are normal for long-lived connections; most realtime sites already reconnect on their own.

## Tunnel transport

The tunnel's own connection to Cloudflare can use QUIC or HTTP/2. [Cloudflare Tunnel's common errors page](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/) suggests, when idle WebSockets or other long-lived connections drop, trying `protocol: http2` and checking firewalls with short UDP idle timers. With the Docker image that is a flag on the run command:

```yaml
    command: tunnel --no-autoupdate --protocol http2 run
```

## A Compose setup for Girici

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

Point the tunnel's public hostname at `http://girici:3000`. `GIRICI_TRUST_PROXY=1` matters for WebSockets too: Girici caps WebSockets per visitor and reads the visitor's address from `X-Forwarded-For`, so without it every visitor would share one cap. If the tunnel shows error 1033 instead, see [Cloudflare Tunnel error 1033](/blog/cloudflare-tunnel-error-1033).

## Zone settings that break proxied sites

Girici's guide lists these for Cloudflare in front of it:

- Turn off anything that rewrites JavaScript or HTML, such as Rocket Loader, at least for `/_g/*`. Girici checks its page script against a digest.
- Do not cache `/_g/*` or `/~/*` with a "cache everything" rule.

## nginx: the upgrade headers

nginx does not pass WebSocket upgrades unless told to. The parts that matter, from Girici's nginx example:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ""      close;
}

server {
    # listen, server_name, certificates ...

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

- `proxy_http_version 1.1` is required; the upgrade does not exist in HTTP/1.0.
- `Upgrade` and `Connection` are hop-by-hop headers, so nginx drops them unless you set them.
- The `map` sends `Connection: close` for normal requests, so they do not all look like upgrades.

[nginx's WebSocket proxying docs](https://nginx.org/en/docs/http/websocket.html) add the timeout: by default the connection closes if the proxied server sends no data within 60 seconds. Raise `proxy_read_timeout` for quiet connections, or rely on the application's pings.

## Checking that it works

In the browser's DevTools, open the Network panel, filter by **WS**, and load a proxied site that uses WebSockets. The connection to `/_g/ws` should show status `101 Switching Protocols` and frames moving in the **Messages** tab. A `400`, `426` or a connection that closes at once usually means a hop in between is not passing the upgrade.

## FAQ

### Does Cloudflare Tunnel support WebSockets?

Yes. Cloudflare supports proxied WebSockets on all plans, and a tunnel hostname carries them. Make sure the zone's Network, WebSockets setting is on.

### Why do WebSockets disconnect behind Cloudflare?

Cloudflare closes idle WebSockets after a period without data and may close them during server restarts. Clients should send heartbeats and reconnect.

## Related posts

- [Proxy server vs a proxy in the browser: how web proxies work](/blog/proxy-server-browser)
- [Cloudflare Tunnel error 1033: causes and fixes](/blog/cloudflare-tunnel-error-1033)
- [How to create your own web proxy server with Docker](/blog/create-web-proxy-server-docker)
- [All posts](/blog/)
