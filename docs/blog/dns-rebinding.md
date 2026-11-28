---
title: "DNS Rebinding: The Attack and DNS Rebind Protection"
titleTemplate: false
description: "How a DNS rebinding attack turns a public name into a local address, what a router's DNS rebind protection blocks, and how a server closes the gap."
headline: "DNS rebinding: why checking a name once is not enough"
date: "2026-11-28"
keyword: "dns rebinding"
faq: [{"q": "What is a DNS rebinding attack?", "a": "An attacker controls a domain's DNS and changes its answer from a public address to a private one, such as 127.0.0.1 or a router's IP. Code that trusted the name, a browser's same-origin rule or a server's SSRF check, then talks to the private address."}, {"q": "Should I enable DNS rebind protection on my router?", "a": "For most home networks, yes. It drops DNS answers that point public names at private addresses, which blocks browser-based rebinding against devices on your LAN. Allow exceptions for domains that legitimately resolve to local addresses."}, {"q": "What does Invalid Host header, possible DNS rebinding attack detected mean?", "a": "A local server, often a development server, received a request whose Host header is not on its allowed list. Checking Host is a standard defence, since a rebinding page sends its own domain as Host. Add your real host name to the allowed hosts setting."}]
---

# DNS rebinding: why checking a name once is not enough

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">DNS rebinding is a trick with time. A name resolves to one address when someone checks it and to another when someone connects. Browsers trust names for their same-origin rule, and servers check names before fetching them, so both can be fooled. This post covers the two forms, what the "DNS rebind protection" setting on a router does, and the server-side fix, with a run that shows the gap.</p>

## The attack in a browser

1. You open a page on `attacker.example`. Its DNS answer points to the attacker's server, with a very short lifetime.
2. The page's script waits, then makes requests to `attacker.example` again.
3. The attacker's DNS now answers with a private address: `127.0.0.1`, `192.168.1.1`, a smart TV.
4. The browser sees the same origin, `attacker.example`, so it lets the script read the responses. The script is now talking to a device on your network, with your network position.

The target is anything that trusts "only the local network can reach me": router admin pages, printers, development servers, local AI tools, databases with HTTP interfaces.

## DNS rebind protection on routers

The router setting blocks step 3 at the resolver. dnsmasq, which many home routers and OpenWrt use, calls it `--stop-dns-rebind`. Its [man page](https://thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html) describes it as rejecting, and logging, addresses from upstream nameservers in private ranges, which "blocks an attack where a browser behind a firewall is used to probe machines on the local network". For IPv6 the range covers IPv4-mapped private addresses, link-local and unique local addresses.

Two related options show the trade-off:

- `--rebind-localhost-ok` exempts `127.0.0.0/8` and `::1`, because some blocklist services answer with loopback.
- `--rebind-domain-ok=/domain/` exempts domains that are meant to resolve to local addresses.

That second one is the usual answer to "possible DNS rebind attack detected" in a router's log: a name you rely on, such as a public name you pointed at a home server, answered with a private address and the router dropped it. The fix is an exception for that domain, not turning protection off.

## The defence on the device: check the Host header

The browser sends `Host: attacker.example` in step 4, because that is the name it thinks it is visiting. A local server that only answers its own names defeats the attack. That is why development tools reject unknown hosts: Vite's [`server.allowedHosts`](https://vite.dev/config/server-options#server-allowedhosts) docs warn that setting it to `true` "allows any website to send requests to your dev server through DNS rebinding attacks", and errors such as "Invalid Host header - possible DNS rebinding attack detected" from other tools are the same check firing.

## The attack on a server: check, then connect

Servers that fetch user-supplied URLs, such as webhook senders, link previews and web proxies, often check the destination first to prevent [SSRF](/blog/ssrf-web-proxy). A naive check resolves the name, sees a public address and then hands the URL to an HTTP client, which resolves the name again. An attacker's DNS can answer differently the second time.

The run below, on Node 22 on 28 November 2026, uses a fake resolver that answers like such a server: public on the first query, loopback after that. A small HTTP server on `127.0.0.1` plays the internal service.

```text
naive check sees 93.184.215.14 public: true
naive request got: internal admin page
guarded lookup 1: [{"address":"93.184.215.14","family":4}]
guarded lookup 2: rebind.example resolves to a non-public address
```

The naive code checked once and then fetched the internal page. The guarded version is Girici's `createGuardedLookup` from `packages/server/src/upstream/ssrf.ts`, passed as the socket's `lookup` function: the check runs on the answers the socket will actually use, every time, so the loopback answer never reaches a connection. Its comment states the goal: "so DNS cannot change between check and connect". OWASP's [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) says the same: validating names alone does not prevent DNS rebinding; validate the resolved addresses and connect only to those.

Two details in Girici's version are worth copying:

- **Every answer is checked.** If a name returns several addresses and any of them is private, the lookup fails. Picking "the first public one" would leave the others for the client to try.
- **Upstream proxies get the checked address.** With `GIRICI_UPSTREAM_PROXY=socks5://...`, Girici sends the proxy the IP it validated instead of the name, so the proxy cannot resolve it differently. With `socks5h://` or HTTP proxies the proxy resolves the name, which [an SSH SOCKS5 proxy](/blog/ssh-socks5-proxy) demonstrates.

## Checklist

- **At home:** keep DNS rebind protection on, add per-domain exceptions when something legitimate breaks.
- **For local services you run:** bind to `127.0.0.1` when nothing else needs them, require authentication anyway, and reject unknown `Host` headers.
- **For servers that fetch URLs:** validate resolved addresses inside the connection's lookup, not in a separate DNS call, and recheck after redirects.

Girici's [threat model](/guide/threat-model) lists the check-then-connect guarantee under the protections for the server's own network.

## FAQ

### What is a DNS rebinding attack?

An attacker controls a domain's DNS and changes its answer from a public address to a private one, such as 127.0.0.1 or a router's IP. Code that trusted the name, a browser's same-origin rule or a server's SSRF check, then talks to the private address.

### Should I enable DNS rebind protection on my router?

For most home networks, yes. It drops DNS answers that point public names at private addresses, which blocks browser-based rebinding against devices on your LAN. Allow exceptions for domains that legitimately resolve to local addresses.

### What does Invalid Host header, possible DNS rebinding attack detected mean?

A local server, often a development server, received a request whose Host header is not on its allowed list. Checking Host is a standard defence, since a rebinding page sends its own domain as Host. Add your real host name to the allowed hosts setting.

## Related posts

- [Server-side request forgery in a web proxy: what to block and where](/blog/ssrf-web-proxy)
- [An SSH SOCKS5 proxy, and why socks5h matters](/blog/ssh-socks5-proxy)
- [X-Forwarded-For: the header that carries the client IP](/blog/x-forwarded-for)
- [All posts](/blog/)
