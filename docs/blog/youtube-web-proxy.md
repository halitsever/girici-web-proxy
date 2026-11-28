---
title: "Watching YouTube Through a Self-Hosted Web Proxy"
titleTemplate: false
description: "Why YouTube videos stop after about a minute behind most web proxies, and how Girici mints poTokens on the server so videos and ads play to the end."
headline: "Watching YouTube through a self-hosted web proxy"
date: "2026-11-28"
keyword: "youtube on proxy server"
faq: [{"q": "Why does YouTube stop playing after a minute behind a proxy?", "a": "The web player streams video with requests that carry a poToken from BotGuard attestation. Through a proxy that attestation fails and googlevideo stops serving after about a minute."}, {"q": "Does YouTube work through Girici?", "a": "In testing, search, watch pages, comments, Shorts and embeds work, and videos and ads play to the end with server-minted poTokens. Datacenter IPs can still be refused by YouTube."}]
---

# Watching YouTube through a self-hosted web proxy

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">YouTube is one of the hardest sites to run through a web proxy. The page loads, the video starts, and then playback stops. The reason is a token the player has to send with its video requests. Girici's server creates those tokens itself, and in testing, videos and ads play to the end.</p>

## Why YouTube breaks behind web proxies

YouTube's web player does not download a video file. It streams it with a protocol YouTube calls SABR: a series of POST requests to `googlevideo.com` with a binary (protobuf) body. Each request carries a **poToken**, a proof-of-origin token bound to the video, which the page normally gets from Google's BotGuard attestation running in the browser.

Girici's source describes what happens through a proxy (`packages/engine/src/sw/yt-sabr.ts`): the page's own BotGuard attestation fails, and googlevideo stops serving after about a minute. The video starts from what was already granted, then stalls.

## What Girici does

1. **The server mints tokens.** `packages/server/src/youtube/` runs a BotGuard session with the `bgutils-js` and `jsdom` libraries and hands out GVS poTokens for a video through `POST /_g/pot`. One session is reused until it expires.
2. **The service worker adds them.** When the player sends a SABR request, Girici's service worker recognises it and puts a server-minted token in the request before it goes out.
3. **Failures fall back quietly.** If minting fails, the request goes out without the server's token, the same as a proxy without this feature.

The [supported sites](/guide/supported-sites) table records the result: search, watch pages, recommendations, comments, Shorts and embeds work, and videos and ads play to the end with server-minted poTokens.

## The IP address still matters

YouTube judges the server's IP address before any of this. The supported sites page says it plainly: **datacenter IPs can still be refused**. A Girici instance at home gets further than one on a cloud server.

If YouTube refuses your server's IP, Girici can send all outgoing traffic through another proxy with `GIRICI_UPSTREAM_PROXY`, for example a residential one:

```bash
GIRICI_UPSTREAM_PROXY=socks5://user:password@proxy.example:1080
```

The [configuration guide](/guide/configuration#upstream-proxy) explains why poToken minting goes through the same upstream proxy as the video traffic: YouTube ties its playback tokens to the IP that minted them, so a token minted from one address and used from another would fail.

## Turning it off

Minting is on by default. To disable it:

```bash
GIRICI_YT_POTOKEN=false
```

## What does not work

- **Signing in safely on someone else's instance.** The operator of any web proxy can read what you type. Sign in to your Google account only on an instance you run yourself; the [threat model](/guide/threat-model) lists what an operator sees.
- **Live features that need WebRTC.** Girici turns WebRTC off everywhere so it cannot connect around the proxy.
- **Guaranteed playback.** YouTube changes its player often. The supported sites table records what worked in testing, not a promise.

## Try it on your own server

```bash
docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest
```

Then follow [getting started](/guide/getting-started). For a domain with HTTPS, which a service worker needs off `localhost`, see the [deploy page](/deploy/).

## FAQ

### Why does YouTube stop playing after a minute behind a proxy?

The web player streams video with requests that carry a poToken from BotGuard attestation. Through a proxy that attestation fails and googlevideo stops serving after about a minute.

### Does YouTube work through Girici?

In testing, search, watch pages, comments, Shorts and embeds work, and videos and ads play to the end with server-minted poTokens. Datacenter IPs can still be refused by YouTube.

## Related posts

- [Proxy server vs a proxy in the browser: how web proxies work](/blog/proxy-server-browser)
- [Free online web proxies vs hosting your own](/blog/free-online-web-proxy-vs-self-hosted)
- [How to create your own web proxy server with Docker](/blog/create-web-proxy-server-docker)
- [All posts](/blog/)
