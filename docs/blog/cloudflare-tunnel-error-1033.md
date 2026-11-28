---
title: "Cloudflare Tunnel Error 1033: Causes and Fixes"
titleTemplate: false
description: "Error 1033 means Cloudflare found no healthy cloudflared connector for your hostname. How to check the tunnel's status, fix each case, and tell it from a 502."
headline: "Cloudflare Tunnel error 1033: causes and fixes"
date: "2026-11-28"
keyword: "error 1033 cloudflare tunnel error"
faq: [{"q": "What does Cloudflare error 1033 mean?", "a": "Cloudflare cannot find a healthy cloudflared connector for the tunnel the hostname is routed to. The tunnel is down, has never run, or DNS points at a different tunnel."}, {"q": "How do I fix Cloudflare Tunnel error 1033?", "a": "Check the tunnel's status in Networking, Tunnels or with cloudflared tunnel list, start or repair the cloudflared connector, and make sure the hostname's CNAME points at the running tunnel's cfargotunnel.com address."}]
---

# Cloudflare Tunnel error 1033: causes and fixes

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">Error 1033 is Cloudflare saying it cannot reach your tunnel: the hostname is routed to a Cloudflare Tunnel, but no healthy cloudflared connector is connected to receive the traffic. The fix is almost always on the machine that should be running cloudflared.</p>

## What 1033 means

[Cloudflare's error 1033 page](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1033/) titles it "Cloudflare Tunnel error": the host is configured with Cloudflare Tunnel and Cloudflare is currently unable to resolve it. [Cloudflare Tunnel's common errors page](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/) adds that Cloudflare "cannot find a healthy `cloudflared` instance" to receive the traffic.

It is not your application failing. If the tunnel were connected and your app were down, you would see a 502 instead (below).

## Step 1: check the tunnel's status

In the Cloudflare dashboard, open **Networking**, then **Tunnels**, or run:

```bash
cloudflared tunnel list
```

(`tunnel list` needs a locally logged-in `cloudflared`; for a tunnel run with a token, use the dashboard.) Then act on the status Cloudflare shows:

| Status | Meaning | Fix |
| --- | --- | --- |
| Healthy | Connected through four connections | The tunnel is fine; go to step 2 |
| Inactive | The connector has never run | Install and run `cloudflared` on the origin |
| Down | The `cloudflared` process stopped | Start it again; check for a crash, a powered-off machine or network changes |
| Degraded | At least one connection failed | Read the `cloudflared` logs; check that firewalls allow Cloudflare Tunnel's IPs and ports |

## Step 2: check DNS

If the tunnel is healthy and 1033 continues, the hostname may point at the wrong tunnel. The DNS record should be a CNAME to `<tunnel ID>.cfargotunnel.com` for the tunnel that is running. On FedRAMP High accounts the target is `<tunnel ID>.fed-cfargotunnel.com` instead, and Cloudflare notes that the normal target returns 1033 there even when the tunnel is healthy.

## With Docker Compose

Girici's [reverse proxy guide](/guide/reverse-proxy#cloudflare-tunnel) runs `cloudflared` as a second service next to the app:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
```

When this setup shows 1033, check the connector first:

```bash
docker compose ps cloudflared          # is it running, or restarting in a loop?
docker compose logs --tail=50 cloudflared
```

Common causes: `TUNNEL_TOKEN` is empty because the `.env` file is missing, the token belongs to a different or deleted tunnel, or the container cannot reach Cloudflare through an outbound firewall.

## 1033 or 502?

| You see | Tunnel connected? | Where the problem is |
| --- | --- | --- |
| Error 1033 | No | `cloudflared` is not running or not connected, or DNS points at another tunnel |
| 502 Bad Gateway | Yes | `cloudflared` cannot reach the service in the hostname's settings |

For a 502, the tunnel logs say "Unable to reach the origin service". Cloudflare lists the causes: the service is not running (`connection refused`), the wrong protocol (`http` vs `https`), the wrong port, or certificate checks on an HTTPS origin.

In a Compose file, one 502 cause is easy to hit: inside the `cloudflared` container, `localhost` is the container itself. Point the public hostname at the app's service name, `http://girici:3000`, not `http://localhost:3000`, unless `cloudflared` runs directly on the host.

## After it works

Set `GIRICI_TRUST_PROXY=1` so Girici counts visitors by the address Cloudflare passes on, and keep its port 3000 closed to the internet. [Cloudflare Tunnel and WebSockets](/blog/cloudflare-tunnel-websocket) covers the settings that matter for realtime sites, and the [deploy page](/deploy/) has the other ways to run Girici with HTTPS.

## FAQ

### What does Cloudflare error 1033 mean?

Cloudflare cannot find a healthy cloudflared connector for the tunnel the hostname is routed to. The tunnel is down, has never run, or DNS points at a different tunnel.

### How do I fix Cloudflare Tunnel error 1033?

Check the tunnel's status in Networking, Tunnels or with cloudflared tunnel list, start or repair the cloudflared connector, and make sure the hostname's CNAME points at the running tunnel's cfargotunnel.com address.

## Related posts

- [Proxy server vs a proxy in the browser: how web proxies work](/blog/proxy-server-browser)
- [Cloudflare Tunnel and WebSockets: what to set](/blog/cloudflare-tunnel-websocket)
- [How to create your own web proxy server with Docker](/blog/create-web-proxy-server-docker)
- [All posts](/blog/)
