---
title: "Proxy Server vs Proxy in the Browser: How It Works"
titleTemplate: false
description: "A proxy server set in your browser and a web proxy you open as a website both route your traffic, but in different ways. How each works and what each sees."
headline: "Proxy server vs a proxy in the browser: how web proxies work"
date: "2026-11-28"
keyword: "proxy server browser"
faq: [{"q": "What is the difference between a proxy server and a web proxy?", "a": "A proxy server is set in the browser or system settings and carries all browser traffic. A web proxy is a website you browse through in a tab; it rewrites the pages it fetches and needs no settings."}, {"q": "Can a web proxy see my passwords?", "a": "Yes. A web proxy fetches the real site itself, so TLS ends on its server and it can read everything you send through it. Use one whose operator you trust, or run your own."}]
---

# Proxy server vs a proxy in the browser: how web proxies work

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">"Proxy" covers two different things for a browser. One is a proxy server you enter in the browser's or system's network settings, which then carries all of the browser's traffic. The other is a web proxy: a website you open, type an address into, and browse through inside a tab. They differ in setup, in what they can see and in what they can break.</p>

## A proxy server in the browser settings

A forward proxy is a server that makes connections on your behalf. You point the browser at it once and every request goes through it.

- **Chrome and Edge** use the operating system's proxy settings (Windows Settings, macOS Network settings, or the desktop environment on Linux). Chrome also accepts `--proxy-server=host:port` on the command line.
- **Firefox** has its own: Settings, General, Network Settings, where you choose no proxy, the system settings, a manual proxy, or a PAC file (a small script that picks a proxy per URL).

For plain `http://` sites the proxy sees and can change everything. For `https://` sites the browser sends a `CONNECT host:443` request and then runs TLS through the tunnel, so the proxy sees which host you visit and how much data moves, but not the pages, unless it intercepts TLS with its own certificate that you installed. [proxy.py](/blog/proxypy-alternative) is an example of this kind of server.

It works for every site and every protocol the browser speaks, but someone has to configure each browser or device, and the proxy port has to be reachable from it.

## A web proxy: a proxy you open as a website

A web proxy needs no settings. You open its page, type an address, and the site appears inside the proxy's own origin, for example `https://proxy.example/~/https/en.wikipedia.org/`. To make that work, the proxy has to:

1. fetch the page from the real site on its server,
2. rewrite every link, script, stylesheet and API call so that the next request also goes through the proxy,
3. handle cookies, storage, WebSockets and redirects for many sites that now share one origin.

Because the proxy itself fetches the real site, TLS to that site ends on the proxy server. It can read everything, passwords included. That is true of every web proxy, free or self-hosted.

## Two ways to rewrite: server or service worker

Older web proxies such as php-proxy rewrite each page's HTML on the server. That breaks on modern sites that build their pages with JavaScript and fetch data after load, because those requests are created in the browser where the server never sees them.

Girici moves most of the work into the browser. As [how it works](/guide/how-it-works) describes, it registers a **service worker** at the root of its origin. The worker catches every request a proxied page makes, builds it with that site's cookie jar, sends it through the server's HTTP relay (`/_g/r/`) and rewrites HTML, CSS and JavaScript on the way back. WebSockets go through a shim to `/_g/ws`. The Node.js server stays a thin relay with an SSRF guard. Service workers need HTTPS, so a Girici instance on anything other than `localhost` needs a certificate.

## Side by side

| | Proxy server in settings | Web proxy |
| --- | --- | --- |
| Setup on the device | Proxy address in browser or system settings | None, open a URL |
| Covers | All browser traffic | Only pages opened through it |
| Sees HTTPS content | No, only host names (unless it intercepts TLS) | Yes, all of it |
| Breaks sites | Rarely | Sometimes; it rewrites them |
| Voice and video calls | Work if the protocol is supported | Girici turns WebRTC off so calls cannot bypass it |

## Which one to use

If you can change the settings on the device and want everything to go through one exit, use a proxy server (or a VPN). If you want to reach sites through a server from any browser without configuring it, a web proxy fits, and running your own means the only operator who can see the traffic is you. [A free public web proxy, or one you run yourself?](/blog/free-online-web-proxy-vs-self-hosted) covers that trade-off, and the [deploy page](/deploy/) has the ways to run Girici.

## FAQ

### What is the difference between a proxy server and a web proxy?

A proxy server is set in the browser or system settings and carries all browser traffic. A web proxy is a website you browse through in a tab; it rewrites the pages it fetches and needs no settings.

### Can a web proxy see my passwords?

Yes. A web proxy fetches the real site itself, so TLS ends on its server and it can read everything you send through it. Use one whose operator you trust, or run your own.

## Related posts

- [A free public web proxy, or one you run yourself?](/blog/free-online-web-proxy-vs-self-hosted)
- [How to create your own web proxy server with Docker](/blog/create-web-proxy-server-docker)
- [Choosing between proxy.py and a web proxy you open in the browser](/blog/proxypy-alternative)
- [Which side is the proxy on? Forward and reverse proxies explained](/blog/forward-proxy-vs-reverse-proxy)
- [All posts](/blog/)
