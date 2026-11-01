# How it works

Girici is built around a service worker. Instead of rewriting every page on the server, it registers a
service worker at the root of its own origin and lets that worker catch the requests a proxied page
makes. The server stays a thin relay, which keeps it simple and makes a future move to other transports
easier.

## The pieces

```
Browser (one origin, e.g. https://proxy.example)
  /                    the Vue UI; registers /_g/sw.js at scope "/"
  /~/https/site/...    a proxied page; the client runtime is injected at the top of <head>
  service worker       router -> request builder (cookie jar, Origin/Referer)
                       -> transport (HTTP relay) -> HTML/CSS/JS rewriters + cache
  WebSocket shim       -> wss://proxy.example/_g/ws (in pages and in workers)

Server (Node 24, Express 5)
  /_g/r/*   HTTP relay (undici + SSRF guard, streaming)
  /_g/ws    WebSocket relay (ws + SSRF guard)
  /_g/*     engine bundles, UI files, auth
  /~/*      bootstrap page for direct hits
```

## The URL scheme

A proxied address looks like `/~/<scheme>/<host><path>?<query>`. Keeping the structure intact means
the browser's own relative resolution keeps working: `../x`, CSS `url()`, and module imports all land
back on a `/~/...` path without extra rewriting.

With encrypted page addresses on, a top-level page opens at `/~/x/<label>.<body>` instead. The label seals the
site's origin and the body seals the path and query, both under a key this browser's service worker keeps. A page
gets only its own origin's key, so it can update its own address (`pushState`, links to itself) but cannot make or
read another site's. In such a page the browser cannot resolve relative URLs, so the rewriter writes them as plain
absolute `/~/https/...` URLs, and the worker resolves any relative request it still sees against the page's real
address.

## Where rewriting happens

The service worker is the safety net. Every subresource a controlled page requests passes through it,
so it can route and fetch them no matter the address. Rewriting is only needed where the worker cannot
see a request: navigations, `embed`/`object`, WebSocket and WebRTC, `http:` targets, worker URLs, and
reads that must return a real URL. HTML, CSS, and JavaScript are rewritten in the worker; the server
only relays bytes.

Workers a page starts run the same client runtime as the page, so a socket opened in a worker goes through the same
WebSocket shim and carries the site's cookies. A shared worker loads from one address per script, storage partition
and type under `/_g/rpc/shared-worker`. The service worker answers that address with the bootstrap the starting page
announced, so two tabs of one site join the same running shared worker.

Script text a page writes at run time, through `text`, `textContent`, `innerText` or `innerHTML`, or inside a script
element it builds and inserts, is rewritten just before the browser can run it. Reading that text back returns what
the page wrote. Data blocks such as JSON-LD and templates keep their text.

## The relay

The worker sends each upstream request to `/_g/r/...`. The server validates the target against its SSRF
guard (no local or private addresses, an allowed-port list, DNS-rebinding protection), forwards it with
`undici`, and streams the response back. Range requests, redirects, and compressed bodies pass through
without being mangled. Target URLs, cookies, and tokens are never logged at the default log level.

## Authentication

Once an admin account exists, the proxy data path (`/_g/r` and `/_g/ws`) sits behind a login. A
stateless, HMAC-signed cookie carries the session (`__Host-girici` over HTTPS, `girici-session` on a plain-HTTP
page such as `http://localhost`). When a request is not authorized,
the service worker turns it into a redirect to the login page for navigations and a network error for
subresources. Turning on public access opens the data path to everyone and skips that gate. See
[Admin and auth](/guide/admin-and-auth).

## Known limitations

The [threat model](/guide/threat-model) covers these in more depth, along with what the operator can see.

- **Single origin.** Every proxied site shares one browser origin, so isolation between sites is
  limited. `HttpOnly` is not a boundary here.
- **Computed access goes around the rewriter.** Girici rewrites the ways scripts usually reach `location` and other
  windows. A key built at run time, such as `self["loc" + "ation"]`, `Reflect.set(window, "location", url)`,
  `Object.assign(window, { location: url })`, or a window reached as `frames[i]`, `window[i]` or by name, gets the
  browser's own object. Such a page can navigate outside the proxy or open a document without Girici's script.
- **Blob URLs and the origin private file system are shared.** Every site runs on Girici's origin, so a site that
  learns another site's `blob:` URL can read it, and `navigator.storage.getDirectory()` gives all sites one folder.
- **The operator sees traffic.** The relay terminates TLS at the server.
- **Bot protection still applies.** A correct proxy can still be blocked by a site's bot checks or by
  blocks on datacenter IP ranges.
- **Documents Girici does not rewrite run no script.** XHTML, SVG, XML, plain text and untyped bodies that do not
  start like HTML open as they are, without their scripts.
- **CDNs and proxies in front of `/_g/`.** Girici checks its page script against a digest before using it. A CDN
  or proxy that rewrites or minifies JavaScript changes those bytes, so pages stop loading until that is turned off
  for `/_g/`.
- **Encrypted addresses hide less than everything.** With encrypted page addresses on:
  - The `#fragment` after the token stays readable.
  - Tokens are deterministic: the same page always gets the same token, and pages of one site share its first
    part, so someone who sees two addresses can tell they are the same page or the same site.
  - Only top-level page loads are encrypted. Frames, and pages reached by a form `POST`, keep a plain address.
  - `document.referrer` is empty when an encrypted page of another site linked to the page.
  - Some loads go to the plain address first, which the service worker redirects to the encrypted one: a link to
    another site, `window.open`, the Navigation API, and a site opened from Girici's own search field when the
    worker is slow to answer. Browsers may keep that first address in their history, so encrypted addresses do not
    keep sites out of it.
  - Girici's own recent sites list keeps real addresses. Turn off **Remember history** to stop that.
  - A `../../x` URL that the rewriter missed resolves from the site's root.

## Toolbar and site data

Every proxied page gets a small Girici button in its bottom-left corner. It opens a bar with Girici home,
back, forward, reload, an address field that takes a URL or a search, and **Clear site data**. Turn it off
under **Settings → Show toolbar on sites** if a site reacts badly to it.

All proxied sites share Girici's origin in your browser, so Girici keeps each site's cookies in its own
jar and prefixes each site's storage. **Settings → Site data** lists the sites that stored something and
clears one of them, or all of them, without touching the others. Clearing a site removes its cookies,
including HttpOnly ones, and its local storage, session storage, IndexedDB databases and caches, for the
site and its subdomains. A site embedded in another keeps separate storage for each site that embeds it.

## Third-party cookies

**Settings → Block third-party cookies** is on by default. While it is on, Girici sends and stores no cookies for a
request whose site differs from the site of the page you opened: a tracker's pixel, script or iframe on one site cannot
read the cookie it set on another. Cookies of the site you are on, and its subdomains, work as usual. Embedded sign-ins,
such as comment widgets or a signed-in video player on another site, stop working while the switch is on; turn it off if
you need them.

