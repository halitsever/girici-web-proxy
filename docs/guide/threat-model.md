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

[Subdomain mode](/guide/subdomain-mode) puts each site on a subdomain of its own, so the browser enforces these walls
itself. It is optional and needs wildcard DNS and a wildcard certificate.

## In subdomain mode

With `GIRICI_SITE_DOMAIN` set, each site (a scheme plus a registrable domain) runs on its own host, and the browser's
same-origin rule separates sites. Between sites, most of the gaps listed above close:

- **Window access.** Another site's window, reached as `frames[i]`, `window[i]`, by name or through a computed
  `location`, is a real cross-origin window, and the browser refuses access to it.
- **Rewriters in the page realm.** A page that breaks its own rewriter reaches only its own host's data.
- **The origin private file system and blob URLs.** Both belong to one host.
- **Girici's own storage.** A page reaches only the cookie jar and storage of its own host.
- **The UI.** History and settings live on the root, a different origin from every site.

What stays open, and what the mode adds:

- Origins of one site, such as `www.example.com` and `accounts.example.com`, share one host. Girici separates them in
  JavaScript as in single-origin mode, and `HttpOnly` is still not a boundary between them.
- A page can still navigate its own tab out of the proxy through a computed `location` write.
- Site labels appear in DNS lookups and the TLS handshake, so a network observer sees one stable label per site. Any
  page a visitor allowed to browse opens gets the label key and can match labels to sites; a signed-out visitor of a
  private instance learns no site's host.
- Navigations between sites arrive cross-site, without a `Referer`, and a POST carries `Origin: null`. A form post with
  no referrer at all counts as cross-site, so a page's `no-referrer` policy in its headers or markup becomes
  `same-origin`, which keeps the referrer on the page's own host. A plain load without a referrer counts as direct.
- In WebKit, a form that uploads files to another site loses its fields and files. In every browser, a multipart POST
  to a site never opened before stops at a page that explains why. WebKit gives an embedded site its own worker install
  and cookie jar for each site that embeds it.
- Browser protections keyed to the site, such as HTTP cache partitioning, the `window.name` reset, process-per-site
  and SameSite, see one site for all Girici hosts.
- A page can set cookies for the shared domain. It cannot read Girici's own cookies, and a same-name cookie it plants
  cannot replace them: Girici reads every value, keeps only signed ones and merges settings to the more private choice.
  A flood can still make every host answer `431`, as in single-origin mode, or push Girici's own cookies out of the
  browser's per-domain limit, which signs the site hosts out and resets settings.
- Form posts moved to another site's host are sent again as UTF-8. Messages from a host under the sender's site reach
  the page as copies with `isTrusted` false once the service worker confirms the host.
- The first visit to each site costs a round trip and about 700 KB of engine before compression.
- With third-party cookies allowed, subresource cookies are partitioned per embedding site.
- `localStorage` that a site writes while embedded shares browser storage with its top-level copy in all three
  engines; Girici's storage prefix keeps them apart.

[Subdomain mode](/guide/subdomain-mode#known-limits) explains each of these.

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
