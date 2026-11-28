---
title: "X-Forwarded-For: Format, Spoofing and Trusting It"
titleTemplate: false
description: "How the X-Forwarded-For header works, why a client can forge its left end, how nginx appends to it, and how to count trusted proxies from the right."
headline: "X-Forwarded-For: the header that carries the client IP, and how far to trust it"
date: "2026-11-28"
keyword: "x-forwarded-for"
faq: [{"q": "What is the X-Forwarded-For header?", "a": "A de facto standard request header that proxies use to pass on the IP address of the client they received a request from. Each proxy appends the address it saw, so the list reads client first, most recent proxy last."}, {"q": "Can X-Forwarded-For be spoofed?", "a": "Yes. A client can send any value. Only the entries added by proxies you control are trustworthy, which is why servers count trusted hops from the right end of the list instead of reading the first entry."}, {"q": "How do I get the real client IP behind nginx?", "a": "Have nginx set proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for, then tell the app how many proxies to trust, or use nginx's realip module with set_real_ip_from for the proxies in front of nginx."}]
---

# X-Forwarded-For: the header that carries the client IP, and how far to trust it

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">Behind a reverse proxy, every request reaches your app from the proxy's address. The visitor's real IP only arrives as text in a header, usually <code>X-Forwarded-For</code>, and anyone can write that text. Getting it right matters for rate limits, sign-in protection and logs. Here is how the header is built, how it gets forged, and the rule that makes it safe, with a run of the library Girici uses to apply it.</p>

## How the header is built

[MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For) calls it a de facto standard. Each proxy appends the address of whoever connected to it:

```text
X-Forwarded-For: <client>, <proxy1>, <proxy2>
```

So the rightmost entry is the most recent proxy and the leftmost is the original client, "assuming well-behaved client and proxies", as MDN puts it. The address of the last proxy is not in the header at all: the app sees it as the TCP connection's remote address.

The standardized version is the `Forwarded` header from [RFC 7239](https://www.rfc-editor.org/rfc/rfc7239) (`Forwarded: for=203.0.113.7;proto=https`), which MDN notes is used much less. Cloudflare adds its own, `CF-Connecting-IP`, with the client address it saw, on traffic from its edge to your origin ([Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)).

## In nginx

The common reverse-proxy line is:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

[nginx's proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#var_proxy_add_x_forwarded_for) defines `$proxy_add_x_forwarded_for` as the incoming `X-Forwarded-For` with `$remote_addr` appended. nginx keeps whatever the client sent and adds the address it actually saw. That is correct behaviour, and it is also why the left end cannot be trusted.

To make nginx itself use a trusted forwarded address, for its own logs and limits, the [realip module](https://nginx.org/en/docs/http/ngx_http_realip_module.html) takes `set_real_ip_from` for each trusted proxy range, `real_ip_header X-Forwarded-For` and, for chains, `real_ip_recursive on`.

## Forging it takes one flag

```bash
curl -H 'X-Forwarded-For: 1.2.3.4' https://your-site.example/
```

Behind nginx, the app now receives `X-Forwarded-For: 1.2.3.4, <real client IP>`. An app that reads the first entry believes the client is 1.2.3.4. If the rate limit on the sign-in form keys on that value, the attacker sends a new fake address with every attempt and is never limited.

MDN states the rule plainly: any security-related use, "such as for rate limiting or IP-based access control", must only use addresses added by a trusted proxy. And if the app's port can be reached directly from the internet, even while it also sits behind a proxy, no part of the list can be trusted.

## The fix: count trusted hops from the right

Read the list from the right and skip one entry per proxy you control. The first address after that is the client as far as you can know.

Girici does this with [proxy-addr](https://github.com/jshttp/proxy-addr), the library Express uses for its "trust proxy" setting, in `packages/server/src/http/client-ip.ts`. `GIRICI_TRUST_PROXY=1` means "trust one hop". This script feeds proxy-addr four requests and shows the address it picks for each trust setting (run with Node 22 on 28 November 2026; `true` means trust every entry):

```js
const proxyaddr = require("proxy-addr");
const req = (socket, xff) => ({ socket: { remoteAddress: socket }, connection: { remoteAddress: socket }, headers: xff ? { "x-forwarded-for": xff } : {} });
const trustHops = (n) => (_addr, hop) => hop < n;
```

| Request | 0 (unset) | 1 | 2 | true |
| --- | --- | --- | --- | --- |
| Direct, no proxy, from 203.0.113.7 | 203.0.113.7 | 203.0.113.7 | 203.0.113.7 | 203.0.113.7 |
| nginx in front: `203.0.113.7` | 127.0.0.1 | **203.0.113.7** | 203.0.113.7 | 203.0.113.7 |
| nginx in front, client forged one: `1.2.3.4, 203.0.113.7` | 127.0.0.1 | **203.0.113.7** | 1.2.3.4 | 1.2.3.4 |
| Cloudflare, then nginx: `203.0.113.7, 172.70.1.10` | 127.0.0.1 | 172.70.1.10 | **203.0.113.7** | 203.0.113.7 |

The bold cells are the correct settings. The table shows every failure mode at once:

- **Too low** (0 behind nginx): every visitor looks like `127.0.0.1` and shares one rate limit. Safe, but annoying.
- **Too high** (2 behind one nginx): the forged `1.2.3.4` wins.
- **`true`**: always trusts the leftmost entry, so always forgeable.

That is exactly the guidance in Girici's [reverse proxy guide](/guide/reverse-proxy#girici-trust-proxy): set the number of proxies in front, never `true`, and bind the app's own port to `127.0.0.1` or a private network so nobody can skip the proxy. Girici also logs a warning when requests arrive with `X-Forwarded-For` while the setting is off. One more detail from the same file: an IPv6 client is keyed by its `/64` for rate limits, because one subscriber usually holds the whole block.

## Not passing it on

A web proxy has the opposite job on its outbound side. When Girici fetches a site for a visitor, it removes `X-Forwarded-*`, `Forwarded` and `Via` from the headers it sends (`packages/server/src/upstream/request-headers.ts`), so the site sees the server's address and no trace of the visitor's. Forward proxies often add the header themselves (Squid does unless its `forwarded_for` setting is changed), so check yours if that matters ([VPN vs proxy](/blog/vpn-vs-proxy) covers what else sites can see).

## FAQ

### What is the X-Forwarded-For header?

A de facto standard request header that proxies use to pass on the IP address of the client they received a request from. Each proxy appends the address it saw, so the list reads client first, most recent proxy last.

### Can X-Forwarded-For be spoofed?

Yes. A client can send any value. Only the entries added by proxies you control are trustworthy, which is why servers count trusted hops from the right end of the list instead of reading the first entry.

### How do I get the real client IP behind nginx?

Have nginx set proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for, then tell the app how many proxies to trust, or use nginx's realip module with set_real_ip_from for the proxies in front of nginx.

## Related posts

- [Which side is the proxy on? Forward and reverse proxies explained](/blog/forward-proxy-vs-reverse-proxy)
- [Carrying WebSockets through Cloudflare Tunnel and nginx](/blog/cloudflare-tunnel-websocket)
- [SSRF in a web proxy: what Girici blocks and why](/blog/ssrf-web-proxy)
- [All posts](/blog/)
