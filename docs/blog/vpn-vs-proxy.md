---
title: "VPN vs Proxy: What Each One Hides and Who Sees It"
titleTemplate: false
description: "VPN vs proxy compared on privacy: which traffic each covers, what the operator can see, what websites still see, and where a self-hosted web proxy fits."
headline: "VPN or proxy: which traffic each covers, and who can still see it"
date: "2026-11-28"
keyword: "vpn vs proxy"
faq: [{"q": "Is a VPN better than a proxy?", "a": "For privacy across a whole device, usually yes, because a VPN carries every app's traffic while a proxy only carries the apps configured to use it. Neither hides your activity from its own operator, and neither stops browser fingerprinting."}, {"q": "Does a proxy hide my IP address?", "a": "From the websites you reach through it, yes: they see the proxy's address. The proxy's operator sees your real address and the sites you visit."}, {"q": "Can the proxy or VPN operator see my passwords?", "a": "On HTTPS sites through a forward proxy or a VPN, no, unless it intercepts TLS with a certificate you installed. A web proxy that rewrites pages ends TLS on its server, so its operator can see everything, including passwords."}]
---

# VPN or proxy: which traffic each covers, and who can still see it

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">A VPN and a proxy both put another machine between you and the sites you visit, so the sites see that machine's IP address instead of yours. They differ in how much of your traffic they carry and how much the person running them can see. Those two questions decide which one fits, and the answer for a web proxy is different again.</p>

## Three things people call a proxy

- **A forward proxy** (HTTP or SOCKS5) that you set in the browser, the system or one app. It carries only what is configured to use it.
- **A web proxy**: a website you type addresses into, which fetches and rewrites pages on its server. It carries only what you open in that tab. [How web proxies work](/blog/proxy-server-browser) shows the difference from a forward proxy.
- **A reverse proxy** in front of a server. That one works for the site, not for you, so it is not part of this comparison ([forward vs reverse](/blog/forward-proxy-vs-reverse-proxy)).

## What each one covers

| | VPN | Forward proxy | Web proxy |
| --- | --- | --- | --- |
| Works at | network layer, the whole device or a chosen set of apps | one protocol, usually HTTP or SOCKS | one browser tab |
| Setup | an app or the OS's VPN settings | proxy settings per browser, system or app | none, open a URL |
| DNS lookups | through the tunnel, if the client is set to | through the proxy with SOCKS5h or HTTP; locally with plain SOCKS5 | on the proxy server |
| Traffic between you and it | encrypted by the VPN protocol | encrypted only if the proxy speaks HTTPS or the site is HTTPS | HTTPS to the proxy, if it has a certificate |

A VPN covers apps you did not think about: the mail client, the updater, the game. A proxy covers what you point at it, and everything else goes out directly. With a SOCKS proxy, also check where names are resolved: [socks5 vs socks5h](/blog/ssh-socks5-proxy) shows the same request with each.

## What the operator can see

This is where they really differ.

- **VPN operator:** every destination IP and the timing and size of your traffic. On HTTPS sites, not the pages or passwords, because TLS runs from your browser to the site through the tunnel. DNS queries too, if they go through the VPN.
- **Forward proxy operator:** for HTTPS, the host name in the `CONNECT` request and the amount of data, not the content. For plain HTTP, everything. Unless you installed its certificate, which lets it intercept TLS.
- **Web proxy operator:** everything. A web proxy has to read and rewrite each page, so TLS to the real site ends on its server.

Girici's [threat model](/guide/threat-model) spells out the last case for itself: "Girici is not end-to-end encrypted." The operator can see every address opened with request and response headers and bodies, cookies, passwords typed into proxied sites, tokens and WebSocket messages. A CDN in front that terminates TLS sees the same. Default logs leave out target URLs, cookies and tokens, but the operator can change the log level or run modified code.

That is why the guidance there is to use an instance whose operator you trust with that data, and not to sign in to important accounts through a public one. The most reliable way to trust the operator of a web proxy is to be the operator ([free online web proxies vs your own](/blog/free-online-web-proxy-vs-self-hosted)).

## What the websites still see

All three replace your IP address with theirs. None of them hide the browser. Girici's threat model puts it directly: sites still see the user agent, screen size, fonts and everything a fingerprinting script can read, and Girici "is not an anonymity tool". The same is true of a VPN or a forward proxy: cookies, logins and fingerprints follow you through any of them.

Girici does take care not to hand your address over in headers. It drops `X-Forwarded-For`, `Forwarded`, `Via` and other proxy headers from what it sends upstream, so a site gets the server's address and nothing else ([X-Forwarded-For explained](/blog/x-forwarded-for)).

## Which one fits

- **You want every app on a device to use another network:** a VPN.
- **You want one app or one browser profile routed elsewhere, or a server's outbound traffic sent through a different IP:** a forward proxy. Girici itself uses one for that when you set `GIRICI_UPSTREAM_PROXY` ([configuration](/guide/configuration#upstream-proxy)).
- **You want to open sites through a server you control from any browser, with no client setup:** a self-hosted web proxy, which the [deploy page](/deploy/) sets up with Docker.
- **You want anonymity:** none of the above on its own. That is a different set of tools and habits.

## FAQ

### Is a VPN better than a proxy?

For privacy across a whole device, usually yes, because a VPN carries every app's traffic while a proxy only carries the apps configured to use it. Neither hides your activity from its own operator, and neither stops browser fingerprinting.

### Does a proxy hide my IP address?

From the websites you reach through it, yes: they see the proxy's address. The proxy's operator sees your real address and the sites you visit.

### Can the proxy or VPN operator see my passwords?

On HTTPS sites through a forward proxy or a VPN, no, unless it intercepts TLS with a certificate you installed. A web proxy that rewrites pages ends TLS on its server, so its operator can see everything, including passwords.

## Related posts

- [Which side is the proxy on? Forward and reverse proxies explained](/blog/forward-proxy-vs-reverse-proxy)
- [A free public web proxy, or one you run yourself?](/blog/free-online-web-proxy-vs-self-hosted)
- [An SSH SOCKS5 proxy, and why socks5h matters](/blog/ssh-socks5-proxy)
- [All posts](/blog/)
