---
title: "Web Proxy Guides: Self-Hosting, Tunnels, YouTube"
titleTemplate: false
description: "Guides to web proxies: how they differ from proxy servers, hosting your own with Docker, YouTube through a proxy, Cloudflare Tunnel errors and WebSockets."
---

# Girici blog

<p class="lead">Notes on running a web proxy you control: how web proxies work, what free public ones can see, and how to put your own behind Docker, Caddy or Cloudflare Tunnel. The Girici-specific parts come from its code and docs; everything else links to its source.</p>

## [Proxy server vs a proxy in the browser: how web proxies work](/blog/proxy-server-browser)

A proxy server set in your browser and a web proxy you open as a website both route your traffic, but in different ways. How each works and what each sees.

## [Watching YouTube through a self-hosted web proxy](/blog/youtube-web-proxy)

Why YouTube videos stop after about a minute behind most web proxies, and how Girici mints poTokens on the server so videos and ads play to the end.

## [Cloudflare Tunnel error 1033: causes and fixes](/blog/cloudflare-tunnel-error-1033)

Error 1033 means Cloudflare found no healthy cloudflared connector for your hostname. How to check the tunnel's status, fix each case, and tell it from a 502.

## [Proxyium alternative: run your own web proxy](/blog/proxyium-alternative)

What Proxyium says about itself, what any public web proxy can see by design, and how to run your own web proxy with Docker so that the operator is you.

## [Free online web proxies vs hosting your own](/blog/free-online-web-proxy-vs-self-hosted)

Free online web proxies cost nothing to open but someone else sees your traffic. What a self-hosted web proxy changes, what it costs, and how to choose.

## [Cloudflare Tunnel and WebSockets: what to set](/blog/cloudflare-tunnel-websocket)

WebSockets through Cloudflare Tunnel and an nginx reverse proxy: the zone setting, idle timeouts, reconnects, the nginx upgrade headers and Girici's /_g/ws.

## [How to create your own web proxy server with Docker](/blog/create-web-proxy-server-docker)

Create a self-hosted web proxy server in a few commands: run Girici with Docker, claim it with the setup code, add HTTPS with Caddy, then update and back up.

## [proxy.py vs a web proxy: which one do you need?](/blog/proxypy-alternative)

proxy.py is a Python proxy server framework you set in the browser; Girici is a web proxy you open as a site. What each does, how to run it and when to pick it.
