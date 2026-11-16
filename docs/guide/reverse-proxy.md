# Reverse proxies

Service workers need HTTPS on any host other than `localhost`, so a real deployment puts a TLS terminator in front
of Girici. The compose file ships one with Caddy (see [Running with Docker](/guide/docker)). This page covers nginx,
Traefik and Cloudflare Tunnel, and what every setup needs.

## What every setup needs

- **Keep the `Host` header.** Girici compares the browser's `Origin` with `Host` before it accepts a POST. If the
  proxy rewrites `Host` to `127.0.0.1:3000`, sign-in and form posts fail with 403.
- **Pass WebSocket upgrades.** Proxied sites open their WebSockets through `/_g/ws`.
- **Speak HTTP/2 (or HTTP/3) to browsers.** Every proxied site loads from one origin, and over HTTP/1.1 a browser
  opens only about six connections to it, so pages load slowly. Girici itself speaks HTTP/1.1; the proxy talks
  HTTP/2 to the browser and HTTP/1.1 to Girici.
- **Allow large headers and bodies.** Relay requests carry the page's whole cookie and header lists, up to 64 KB of
  headers. Uploads go up to 50 MB.
- **Do not buffer or rewrite.** Streaming responses should pass through as they arrive. A proxy or CDN that
  minifies or rewrites JavaScript under `/_g/` breaks Girici, because it checks its page script against a digest.
- **Set `GIRICI_TRUST_PROXY` to the number of proxies** in front of Girici, and make sure nobody can reach Girici
  without going through them.

## `GIRICI_TRUST_PROXY`

Girici takes the visitor's address from `X-Forwarded-For` for its rate limits and the WebSocket cap. It counts
proxies from the right: with `1` it trusts the one proxy that connects to it and takes the address that proxy
added.

| Setup | Value |
|-------|-------|
| Girici reached directly, no proxy | unset |
| One proxy: Caddy, nginx, Traefik, or Cloudflare Tunnel straight to Girici | `1` |
| Cloudflare (proxied DNS) in front of Caddy or nginx | `2` |
| Cloudflare Tunnel to Caddy or nginx, then Girici | `2` |
| Fly.io, Render, Railway | `1` |

Do not use `true`: it trusts every entry, and a client can write its own `X-Forwarded-For` to dodge the sign-in
limit. A number that is too high has the same problem. A number that is too low is safe but makes many visitors
share one limit. If Girici logs `Requests arrive with X-Forwarded-For but GIRICI_TRUST_PROXY is off`, it is behind
a proxy and the variable is unset.

If Girici's port is also published directly, anyone can skip the proxy and forge the header. Bind it to
`127.0.0.1` or a private network.

## nginx

nginx 1.25.1 or newer, Girici on `127.0.0.1:3000`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ""      close;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name proxy.example;

    ssl_certificate     /etc/letsencrypt/live/proxy.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/proxy.example/privkey.pem;

    client_max_body_size 50m;
    large_client_header_buffers 4 64k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        # Replace, not append, so a client cannot slip in its own entries.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;

        proxy_buffering off;
        proxy_request_buffering off;
    }
}
```

Run Girici with `GIRICI_TRUST_PROXY=1`. If your site listens on a port other than 443, use
`proxy_set_header Host $http_host;` so the port stays in `Host`.

With Cloudflare in front of this nginx, `$remote_addr` is a Cloudflare address. Either keep this config and set
`GIRICI_TRUST_PROXY=2` with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, or restore the visitor
address with nginx's `real_ip` module and keep `1`.

## Traefik

Docker labels for Traefik v3, with an entrypoint `websecure` on port 443 and a certificate resolver `le`:

```yaml
services:
  girici:
    image: halitsever/girici-web-proxy:latest
    restart: unless-stopped
    environment:
      GIRICI_TRUST_PROXY: "1"
    volumes:
      - girici_data:/data
    labels:
      - traefik.enable=true
      - traefik.http.routers.girici.rule=Host(`proxy.example`)
      - traefik.http.routers.girici.entrypoints=websecure
      - traefik.http.routers.girici.tls.certresolver=le
      - traefik.http.services.girici.loadbalancer.server.port=3000

volumes:
  girici_data:
```

Do not publish `ports` for the `girici` service. Traefik keeps `Host`, handles WebSocket upgrades and serves HTTP/2
over TLS on its own. It drops `X-Forwarded-For` sent by clients it does not trust and writes the real address, so
`1` is right unless another proxy, such as Cloudflare, sits in front of Traefik. In that case list Cloudflare's
ranges under `forwardedHeaders.trustedIPs` on the entrypoint and use `2`.

Traefik v3 limits reading a request to 60 seconds by default (`respondingTimeouts.readTimeout`), which can cut slow
uploads. Raise it on the entrypoint if visitors upload large files.

## Cloudflare Tunnel

`cloudflared` connects out to Cloudflare, so the server needs no open ports. In the tunnel's public hostname
settings, point the hostname at `http://girici:3000` (or `http://localhost:3000`), and run Girici with
`GIRICI_TRUST_PROXY=1`.

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

Cloudflare serves HTTP/2 and HTTP/3 to browsers, keeps `Host` and passes WebSockets. Check these settings for the
zone:

- Turn off anything that rewrites JavaScript or HTML, such as Rocket Loader, at least for `/_g/*`.
- Do not cache `/_g/*` or `/~/*` with a "cache everything" rule.
- Cloudflare limits uploads to 100 MB on the free plan, which is above Girici's 50 MB.

Cloudflare terminates TLS, so Cloudflare can see all proxied traffic. See the [threat model](/guide/threat-model).

## Subdomain mode

In [subdomain mode](/guide/subdomain-mode) the proxy serves `proxy.example` and every host under it to the same
Girici. Everything above still applies, plus:

- **One certificate for `proxy.example` and `*.proxy.example`.** ACME issues wildcard certificates only through the
  DNS-01 challenge, so the certificate tool needs API access to your DNS provider.
- **`Host` exactly as the browser sent it.** Girici picks the UI or a site from `Host` alone, never from
  `X-Forwarded-Host`, and answers 404 on a host it does not know. Behind a proxy that rewrites `Host`, every page is a
  404.

Browsers reuse one HTTP/2 connection for hosts that share a certificate and an IP address, so many site hosts still
cost one connection.

### nginx with a wildcard certificate

Get the certificate with a certbot DNS plugin, for example the one for Cloudflare (`python3-certbot-dns-cloudflare`),
whose credentials file holds `dns_cloudflare_api_token = <token>`:

```bash
certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d proxy.example -d '*.proxy.example'
```

certbot names the certificate after the first `-d`, so the `ssl_certificate` paths in the [nginx config](#nginx) stay
the same. Add the wildcard to `server_name` there and leave the rest as it is:

```nginx
server_name proxy.example *.proxy.example;
```

### Traefik with a DNS challenge

Give Traefik a resolver that answers the DNS challenge in its static configuration, here for Cloudflare, and pass the
Traefik container a `CF_DNS_API_TOKEN` that can edit the zone's DNS:

```yaml
certificatesResolvers:
  le:
    acme:
      email: you@example.com
      storage: /letsencrypt/acme.json
      dnsChallenge:
        provider: cloudflare
```

Then route the root and every host under it to Girici, and ask for the wildcard. `$$` is how compose writes a literal
`$`:

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.girici.rule=Host(`proxy.example`) || HostRegexp(`^[a-z2-7]{26}\.proxy\.example$$`)
      - traefik.http.routers.girici.entrypoints=websecure
      - traefik.http.routers.girici.tls.certresolver=le
      - traefik.http.routers.girici.tls.domains[0].main=proxy.example
      - traefik.http.routers.girici.tls.domains[0].sans=*.proxy.example
      - traefik.http.services.girici.loadbalancer.server.port=3000
```

### Cloudflare in subdomain mode

- **Proxied DNS records.** Create proxied records for `proxy.example` and `*.proxy.example`. Cloudflare's free edge
  certificate covers the zone's own name and one level under it. That is enough when `proxy.example` is the zone. When
  the site domain sits under the zone, such as `girici.example.com`, its site hosts are two levels down and need an
  advanced certificate. Between Cloudflare and your server, use the "Full (strict)" mode with a certificate for both
  names there: a Cloudflare Origin CA certificate or one from DNS-01.
- **Tunnel.** Add two public hostnames to the tunnel, `proxy.example` and `*.proxy.example`, both pointing at
  `http://girici:3000`. If the dashboard does not create the wildcard's DNS record, add a proxied `CNAME` named `*`
  that points at `<tunnel ID>.cfargotunnel.com`. Leave the hostname's "HTTP Host Header" setting empty, so `Host`
  stays the visitor's. The edge certificate note above applies here too.

## HTTP Basic auth in front of Girici

Girici's own sign-in is the supported way to keep an instance private. If you add HTTP Basic auth on the reverse
proxy anyway, know that the browser may not ask for the password when it should. Girici's service worker sends some
requests itself: `/`, `/_g/login`, `/_g/setup`, `/settings`, and every proxied page. When one of those gets a
`401`, the browser shows an error instead of the password prompt. It usually works while the browser still has the
password cached, and breaks after a restart.

If you need a gate in front of Girici, a cookie-based one such as Cloudflare Access or an SSO proxy fits better:
after you sign in to it once, the worker's requests carry its cookie.
