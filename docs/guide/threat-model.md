# Threat model

This page says what Girici protects, what it cannot protect, and what the person running it can see. Read it before
you run a public instance or sign in to accounts through someone else's.

## Who is involved

- **The operator** runs the server and controls its code, logs, network and any reverse proxy in front of it.
- **Visitors** use the proxy in their browser. With public access off, only the admin can browse.
- **Proxied sites** are any page a visitor opens. Treat them as hostile: Girici runs their scripts.
- **The network** between the visitor and Girici, and between Girici and the sites.

## What Girici protects

- **The server's own network.** Every target passes an SSRF guard before Girici connects: no private, loopback or
  link-local addresses, only ports 80, 443, 8080 and 8443, and the checked address is the one it dials, so DNS
  rebinding cannot swap it.
- **Access.** Once the admin exists, the relay needs a signed-in session unless the admin turns on public access. A
  fresh instance can only be claimed with the setup code from the server log. Account changes ask for the current
  password.
- **Cross-site requests to Girici itself.** The relay and the admin API refuse requests from other origins.
- **Abuse limits.** Per-client rate limits on the relay and on sign-in, a cap on WebSockets per client, and a blocked
  sites list.
- **Logs.** At the default log level Girici does not log target URLs, cookies or tokens.
- **Separation between sites in the browser, as far as one origin allows.** Each site gets its own cookie jar, its
  storage is kept apart by name, and windows of other sites are wrapped. The next section lists where that stops.

## Single origin: the known limits

Every proxied site runs on Girici's own origin, for example `https://proxy.example`. The browser therefore treats
all of them as one site, and Girici has to rebuild the walls between them in JavaScript. That works for the ways
pages usually reach each other, but not for all of them. These gaps are known and remain open:

- **Computed window access.** A page that reaches another window as `frames[i]`, `window[i]` or by its name gets
  the browser's real object, not Girici's wrapper.
- **Computed `location` access.** Girici rewrites the usual ways scripts read and set `location`. A key built at
  run time, such as `self["loc" + "ation"]`, `Reflect.set(window, "location", url)` or
  `Object.assign(window, { location: url })`, reaches the real one. Such a page can navigate outside the proxy.
- **Rewriters run in the page realm.** The code that rewrites a page's scripts and HTML runs in the same JavaScript
  world as the page. A hostile page can interfere with it and with the built-ins it relies on.
- **The origin private file system is not partitioned.** `navigator.storage.getDirectory()` returns one folder that
  every site shares.
- **Blob URLs are shared.** A site that learns another site's `blob:` URL can read it.
- **`HttpOnly` is not a boundary.** Girici keeps cookies in its own store on the shared origin.

In practice, a hostile site you open through Girici may be able to read or change what other sites stored through
the same Girici in the same browser profile, including their sign-ins, or leave the proxy. Keep untrusted sites and
accounts you care about in different browser profiles, and clear site data when you are done.

The real fix is per-site origin isolation: each site on its own subdomain, so the browser enforces the walls itself.
That is planned as an optional mode (phase 7). It will need wildcard DNS and a wildcard certificate.

## What the operator sees

Girici is not end-to-end encrypted. TLS to the real site ends at the Girici server, so the operator can see
everything a visitor does through it:

- every address opened, with request and response headers and bodies;
- cookies, passwords typed into proxied sites, and tokens;
- WebSocket messages.

Default logs leave these out, but the operator can change the log level, run modified code or record traffic. A
reverse proxy or CDN in front of Girici that terminates TLS, such as Cloudflare, sees the same. An upstream proxy
set with `GIRICI_UPSTREAM_PROXY` sees which hosts you visit, and the full content of plain `http://` sites.

Only use a Girici instance whose operator you trust with that data, and do not sign in to important accounts
through a public instance.

## What the sites see

Sites see the Girici server's IP address, or the upstream proxy's, not the visitor's. They still see what the
browser sends: the user agent, screen size, fonts and everything a fingerprinting script can read. Girici is not an
anonymity tool.

## Public instances

With **Public access** on, anyone can send traffic from your server's IP. Expect abuse reports, blocklists and bot
checks on that address. Keep the rate limit on, use the blocked sites list, and put Girici behind a reverse proxy
with a correct `GIRICI_TRUST_PROXY` value (see [Reverse proxies](/guide/reverse-proxy)), or every visitor shares one
rate limit.

## Out of scope

- Hiding proxy use from a site's bot checks. A correct proxy can still be refused.
- Protecting visitors from the operator.
- Traffic analysis by someone watching the network.

Report anything that breaks the protections above privately, as described in the
[security policy](https://github.com/halitsever/girici-web-proxy/security/policy).
