---
title: "SSRF Vulnerability: How a Web Proxy Blocks It"
titleTemplate: false
description: "A web proxy fetches any URL its users type, the textbook SSRF vulnerability. OWASP's advice for that case and how Girici's guard applies it, with a real run."
headline: "Server-side request forgery in a web proxy: what to block and where"
date: "2026-11-28"
keyword: "ssrf vulnerability"
faq: [{"q": "What is an SSRF vulnerability?", "a": "Server-side request forgery lets an attacker make a server send requests to a destination the attacker chooses, often internal services, cloud metadata endpoints or the server itself, which the attacker could not reach directly."}, {"q": "How do you prevent SSRF when users can request any URL?", "a": "OWASP's cheat sheet says to use a block-list in that case: allow only http and https, resolve the name, reject private, loopback and link-local addresses, connect only to the address you checked and do not follow redirects without checking again."}, {"q": "Is a self-hosted web proxy safe from SSRF?", "a": "Only if it checks every destination. Girici refuses non-public addresses and names, non-web ports and non-HTTP schemes before it connects, and checks the address it actually dials so DNS cannot change in between."}]
---

# Server-side request forgery in a web proxy: what to block and where

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">Server-side request forgery (SSRF) is when someone makes your server send a request they chose. Most apps get it through a side door: a webhook URL, an image import, a link preview. A web proxy has it as its main feature, because fetching whatever URL a user types is the whole job. That makes it a clear case for how SSRF protection should work, and Girici's guard is a short, readable example.</p>

## Why SSRF matters

A server can usually reach things the internet cannot: services bound to `127.0.0.1`, an admin panel on the private network, a database, a router's web UI, and on cloud machines the metadata service at `169.254.169.254`, which can hand out credentials. OWASP's [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) notes that in cloud environments SSRF is often used to steal credentials and access tokens from those metadata services.

An open web proxy without checks turns all of that into something anyone can browse. Girici's [threat model](/guide/threat-model) lists "the server's own network" first among the things it protects.

## OWASP's two cases

The cheat sheet splits SSRF defence into two situations:

1. **The app only talks to known destinations.** Use an allowlist of hosts or IPs. This is the safe option when it is possible.
2. **The app must reach any external address**, as with webhooks. An allowlist is impossible, so the cheat sheet accepts a block-list, while noting it is "not an impenetrable wall". The steps: allow only HTTP and HTTPS, resolve the name and check every A and AAAA answer is public, connect only to an address you checked, and do not follow redirects without checking again. Network-layer controls, such as a firewall on the server's egress, come on top.

A web proxy is case 2 by definition.

## Girici's guard

`packages/server/src/upstream/ssrf.ts` is about 110 lines. Before the relay connects anywhere, `validateTarget` checks:

- **Scheme:** only `http:` and `https:`.
- **Port:** only 80, 443, 8080 and 8443.
- **IP literals:** must be public unicast. IPv4-mapped IPv6, the deprecated IPv4-compatible range, and NAT64 and 6to4 addresses are unwrapped to the IPv4 address they really reach.
- **Names:** `localhost`, single-label names, and names ending in `.localhost`, `.local`, `.internal`, `.home.arpa`, `.test`, `.example` or `.invalid` are refused.
- **Itself:** the proxy refuses its own host, and in subdomain mode every host under its domain.

The DNS part runs inside the socket's lookup function, `createGuardedLookup`: every address a name resolves to must be public, or the connection fails, and only those checked addresses are handed to the socket. That is OWASP's "connect only to validated addresses", and it closes the [DNS rebinding](/blog/dns-rebinding) gap.

## A run against the real code

The functions above, bundled from the repository with esbuild and run on Node 22 on 28 November 2026:

```text
allowed  https://example.com/                         -> example.com
blocked  http://127.0.0.1/                            -> Address 127.0.0.1 is not public
blocked  http://0x7f000001/                           -> Address 127.0.0.1 is not public
blocked  http://[::ffff:127.0.0.1]/                   -> Address ::ffff:7f00:1 is not public
blocked  http://169.254.169.254/latest/meta-data/     -> Address 169.254.169.254 is not public
blocked  http://10.0.0.5/                             -> Address 10.0.0.5 is not public
blocked  http://localhost:3000/                       -> Port 3000 is not allowed
blocked  http://router/                               -> Host router is not public
blocked  http://printer.local/                        -> Host printer.local is not public
blocked  https://example.com:22/                      -> Port 22 is not allowed
blocked  file:///etc/passwd                           -> Scheme file: is not allowed
blocked  http://[64:ff9b::7f00:1]/                    -> Address 64:ff9b::7f00:1 is not public
lookup  rebind.example resolving to 10.1.2.3 -> rebind.example resolves to a non-public address
```

Two rows show why checks must run on parsed values, not strings. `http://0x7f000001/` is a hex spelling of 127.0.0.1, and the WHATWG URL parser turns it into `127.0.0.1` before the check sees it; a regex on the raw text would have missed it. `64:ff9b::7f00:1` is a NAT64 address whose last 32 bits are 127.0.0.1. The last line uses a fake resolver that answers with a private address: the lookup itself refuses it.

A blocked target becomes an `SsrfBlockedError`, which the relay answers with 403 instead of a generic 502.

## Redirects and other ways around

- **Redirects.** The relay does not follow them on the server. A `3xx` from the site goes back to the browser's service worker, which turns it into a new request through the relay, and that request is checked again. The WebSocket relay sets `followRedirects: false` for the same reason.
- **Upstream proxies.** With `GIRICI_UPSTREAM_PROXY` set, the check still runs first. With `socks5://`, Girici hands the proxy the address it checked; with `http://`, `https://` or `socks5h://` the proxy resolves the name itself, so a name could resolve differently there. The [configuration page](/guide/configuration#upstream-proxy) advises `socks5://` when the upstream proxy can reach a private network; [an SSH SOCKS5 proxy](/blog/ssh-socks5-proxy) shows the difference live.
- **Everything else on the box.** Application checks are one layer. OWASP recommends network rules too: running Girici in Docker without host networking, and blocking egress to private ranges with the host firewall, means a future bug in the guard does not expose the network.

## If you are writing your own

The same shape works for any feature that fetches user-supplied URLs: parse with a real URL parser, allow only web schemes and ports, check every resolved address in the connection's lookup hook rather than in a separate DNS call, do not follow redirects blindly, and keep the error specific so it shows up in logs. Girici's file is AGPL-licensed, so read it for ideas and mind the licence if you copy it.

## FAQ

### What is an SSRF vulnerability?

Server-side request forgery lets an attacker make a server send requests to a destination the attacker chooses, often internal services, cloud metadata endpoints or the server itself, which the attacker could not reach directly.

### How do you prevent SSRF when users can request any URL?

OWASP's cheat sheet says to use a block-list in that case: allow only http and https, resolve the name, reject private, loopback and link-local addresses, connect only to the address you checked and do not follow redirects without checking again.

### Is a self-hosted web proxy safe from SSRF?

Only if it checks every destination. Girici refuses non-public addresses and names, non-web ports and non-HTTP schemes before it connects, and checks the address it actually dials so DNS cannot change in between.

## Related posts

- [DNS rebinding: why checking a name once is not enough](/blog/dns-rebinding)
- [An SSH SOCKS5 proxy, and why socks5h matters](/blog/ssh-socks5-proxy)
- [Which side is the proxy on? Forward and reverse proxies explained](/blog/forward-proxy-vs-reverse-proxy)
- [All posts](/blog/)
