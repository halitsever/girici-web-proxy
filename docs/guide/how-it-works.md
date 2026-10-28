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
  WebSocket shim       -> wss://proxy.example/_g/ws

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

## Where rewriting happens

The service worker is the safety net. Every subresource a controlled page requests passes through it,
so it can route and fetch them no matter the address. Rewriting is only needed where the worker cannot
see a request: navigations, `embed`/`object`, WebSocket and WebRTC, `http:` targets, worker URLs, and
reads that must return a real URL. HTML, CSS, and JavaScript are rewritten in the worker; the server
only relays bytes.

## The relay

The worker sends each upstream request to `/_g/r/...`. The server validates the target against its SSRF
guard (no local or private addresses, an allowed-port list, DNS-rebinding protection), forwards it with
`undici`, and streams the response back. Range requests, redirects, and compressed bodies pass through
without being mangled. Target URLs, cookies, and tokens are never logged at the default log level.

## Authentication

Once an admin account exists, the proxy data path (`/_g/r` and `/_g/ws`) sits behind a login. A
stateless, HMAC-signed `__Host-girici` cookie carries the session. When a request is not authorized,
the service worker turns it into a redirect to the login page for navigations and a network error for
subresources. Turning on public access opens the data path to everyone and skips that gate. See
[Admin and auth](/guide/admin-and-auth).

## Known limitations

- **Single origin.** Every proxied site shares one browser origin, so isolation between sites is
  limited. `HttpOnly` is not a boundary here.
- **The operator sees traffic.** The relay terminates TLS at the server.
- **Bot protection still applies.** A correct proxy can still be blocked by a site's bot checks or by
  blocks on datacenter IP ranges.
