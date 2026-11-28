---
title: "Web Proxy Guides: Self-Hosting, Tunnels, YouTube"
titleTemplate: false
description: "Guides to web proxies and self-hosting them: proxy types, VPNs, Docker, Cloudflare Tunnel, X-Forwarded-For, SSRF, DNS rebinding and SOCKS5 over SSH."
---

# Girici blog

<p class="lead">Notes on running a web proxy you control: how web proxies work, what free public ones can see, and how to put your own behind Docker, Caddy or Cloudflare Tunnel. The Girici-specific parts come from its code and docs; everything else links to its source.</p>

## [Proxy server vs a proxy in the browser: how web proxies work](/blog/proxy-server-browser)

A proxy server set in your browser and a web proxy you open as a website both route your traffic, but in different ways. How each works and what each sees.

## [How YouTube plays through a self-hosted web proxy](/blog/youtube-web-proxy)

Why YouTube videos stop after about a minute behind most web proxies, and how Girici mints poTokens on the server so videos and ads play to the end.

## [Why Cloudflare shows error 1033 for a tunnel, and how to fix it](/blog/cloudflare-tunnel-error-1033)

Error 1033 means Cloudflare found no healthy cloudflared connector for your hostname. How to check the tunnel's status, fix each case, and tell it from a 502.

## [Running your own web proxy instead of Proxyium](/blog/proxyium-alternative)

What Proxyium says about itself, what any public web proxy can see by design, and how to run your own web proxy with Docker so that the operator is you.

## [A free public web proxy, or one you run yourself?](/blog/free-online-web-proxy-vs-self-hosted)

Free online web proxies cost nothing to open but someone else sees your traffic. What a self-hosted web proxy changes, what it costs, and how to choose.

## [Carrying WebSockets through Cloudflare Tunnel and nginx](/blog/cloudflare-tunnel-websocket)

WebSockets through Cloudflare Tunnel and an nginx reverse proxy: the zone setting, idle timeouts, reconnects, the nginx upgrade headers and Girici's /_g/ws.

## [How to create your own web proxy server with Docker](/blog/create-web-proxy-server-docker)

Create a self-hosted web proxy server in a few commands: run Girici with Docker, claim it with the setup code, add HTTPS with Caddy, then update and back up.

## [Choosing between proxy.py and a web proxy you open in the browser](/blog/proxypy-alternative)

proxy.py is a Python proxy server framework you set in the browser; Girici is a web proxy you open as a site. What each does, how to run it and when to pick it.

## [Which side is the proxy on? Forward and reverse proxies explained](/blog/forward-proxy-vs-reverse-proxy)

Forward proxy vs reverse proxy: who each one works for, what it sees, common software for both, and why a self-hosted web proxy runs behind a reverse proxy.

## [VPN or proxy: which traffic each covers, and who can still see it](/blog/vpn-vs-proxy)

VPN vs proxy compared on privacy: which traffic each covers, what the operator can see, what websites still see, and where a self-hosted web proxy fits.

## [X-Forwarded-For: the header that carries the client IP, and how far to trust it](/blog/x-forwarded-for)

How the X-Forwarded-For header works, why a client can forge its left end, how nginx appends to it, and how to count trusted proxies from the right.

## [Server-side request forgery in a web proxy: what to block and where](/blog/ssrf-web-proxy)

A web proxy fetches any URL its users type, the textbook SSRF vulnerability. OWASP's advice for that case and how Girici's guard applies it, with a real run.

## [DNS rebinding: why checking a name once is not enough](/blog/dns-rebinding)

How a DNS rebinding attack turns a public name into a local address, what a router's DNS rebind protection blocks, and how a server closes the gap.

## [An SSH SOCKS5 proxy, and why socks5h matters](/blog/ssh-socks5-proxy)

Turn any SSH server into a SOCKS5 proxy with ssh -D, test it with curl, see where socks5 and socks5h resolve names, and route a web proxy's traffic through it.
