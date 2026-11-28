---
title: "Forward Proxy vs Reverse Proxy: The Difference"
titleTemplate: false
description: "Forward proxy vs reverse proxy: who each one works for, what it sees, common software for both, and why a self-hosted web proxy runs behind a reverse proxy."
headline: "Which side is the proxy on? Forward and reverse proxies explained"
date: "2026-11-28"
keyword: "forward proxy vs reverse proxy"
faq: [{"q": "What is the difference between a forward proxy and a reverse proxy?", "a": "A forward proxy acts for clients and sends their requests out to any server. A reverse proxy acts for servers and receives requests from any client, passing them to the servers behind it."}, {"q": "Is nginx a forward or a reverse proxy?", "a": "nginx is mostly used as a reverse proxy. Its proxy_pass module forwards requests to backend servers. It is not a general forward proxy: it does not handle CONNECT requests for HTTPS out of the box."}, {"q": "Is a VPN a forward proxy?", "a": "It plays a similar role, since it carries your traffic to the internet on your behalf, but it works at the network layer for every app, while a forward proxy handles individual application requests such as HTTP."}]
---

# Which side is the proxy on? Forward and reverse proxies explained

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">Both kinds of proxy sit in the middle of an HTTP request and pass it on. The difference is whose side they are on. A forward proxy works for the people sending requests; a reverse proxy works for the servers receiving them. A self-hosted web proxy such as Girici is a useful example, because it is a bit of both and usually sits behind a reverse proxy of its own.</p>

## Forward proxy: on the client's side

A forward proxy takes requests from a known set of clients and sends them to any server on the internet. The servers see the proxy's IP address, not the client's.

- **Who configures it:** the client. A browser or system gets a proxy address, or an app gets `HTTP_PROXY` and `HTTPS_PROXY` environment variables.
- **What it sees:** for plain `http://`, everything. For `https://`, the client sends `CONNECT host:443` and runs TLS through the tunnel, so the proxy sees the host name and the amount of data but not the content, unless it intercepts TLS with a certificate the client trusts.
- **Typical uses:** a company's outbound filter or cache, a network that only lets one machine reach the internet, or routing one app's traffic through another country.
- **Typical software:** Squid, Tinyproxy, [proxy.py](/blog/proxypy-alternative), SOCKS5 servers, and `ssh -D` ([an SSH SOCKS5 proxy](/blog/ssh-socks5-proxy)).

## Reverse proxy: on the server's side

A reverse proxy receives requests from anyone and passes them to a known set of servers behind it. The clients only ever see the proxy.

- **Who configures it:** the site operator. Visitors do nothing.
- **What it sees:** everything, because it terminates TLS: the certificate for the site lives there.
- **Typical uses:** HTTPS termination, routing several apps on one IP by host name, load balancing, caching, compression, rate limits, and keeping the app's own port off the internet.
- **Typical software:** nginx, Caddy, Traefik, HAProxy, and hosted ones such as Cloudflare or a Cloudflare Tunnel.

Because the reverse proxy is the one that talks to the app, the app no longer sees the visitor's IP address directly. Reverse proxies pass it along in a header, usually `X-Forwarded-For`, and the app has to know how far to trust that header ([X-Forwarded-For explained](/blog/x-forwarded-for)).

## Side by side

| | Forward proxy | Reverse proxy |
| --- | --- | --- |
| Acts for | clients | servers |
| Set up by | the user or their network | the site operator |
| Destinations | any server | the servers behind it |
| Hides | the client's IP from servers | the servers from clients |
| HTTPS | tunnels it with `CONNECT`, usually without seeing inside | terminates it and sees everything |
| Visitor needs to configure anything | yes | no |

## Where a web proxy fits

A web proxy is a third arrangement. You open it as a website and type an address; it fetches the page on its server and rewrites it so the next request also comes back to it ([how web proxies work](/blog/proxy-server-browser)). To the sites you visit it behaves like a forward proxy: they see the proxy server's IP. To your browser it is a normal website. No browser setting is involved.

Girici is that kind of proxy, and it documents which forward-proxy-like protections it applies:

- Before connecting anywhere, its SSRF guard refuses private, loopback and link-local addresses and every port except 80, 443, 8080 and 8443, because a forward proxy that can reach its own network is an open door ([SSRF in a web proxy](/blog/ssrf-web-proxy)).
- It drops `X-Forwarded-*`, `Forwarded` and `Via` from the headers it sends upstream (`packages/server/src/upstream/request-headers.ts`), so sites are not told the visitor's address.
- It can chain to a real forward proxy for its own outbound traffic with `GIRICI_UPSTREAM_PROXY`, over HTTP, HTTPS, SOCKS5 or SOCKS5h ([configuration](/guide/configuration#upstream-proxy)).

## And behind it, a reverse proxy

In production Girici normally runs behind a reverse proxy, for reasons on the reverse-proxy list above: browsers require HTTPS for its service worker everywhere except `localhost`, and HTTP/2 between browser and proxy matters because every proxied site loads from one origin. The [reverse proxy guide](/guide/reverse-proxy) has working nginx, Traefik and Cloudflare Tunnel configurations, and the [deploy page](/deploy/) has the Caddy profile that ships in the compose file.

So a typical Girici install has both: a reverse proxy in front, working for the server, and Girici behind it, fetching sites for its users.

## FAQ

### What is the difference between a forward proxy and a reverse proxy?

A forward proxy acts for clients and sends their requests out to any server. A reverse proxy acts for servers and receives requests from any client, passing them to the servers behind it.

### Is nginx a forward or a reverse proxy?

nginx is mostly used as a reverse proxy. Its proxy_pass module forwards requests to backend servers. It is not a general forward proxy: it does not handle CONNECT requests for HTTPS out of the box.

### Is a VPN a forward proxy?

It plays a similar role, since it carries your traffic to the internet on your behalf, but it works at the network layer for every app, while a forward proxy handles individual application requests such as HTTP.

## Related posts

- [VPN vs proxy: what each one hides](/blog/vpn-vs-proxy)
- [X-Forwarded-For: the header that carries the client IP](/blog/x-forwarded-for)
- [Proxy server vs a proxy in the browser: how web proxies work](/blog/proxy-server-browser)
- [All posts](/blog/)
