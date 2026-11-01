# Subdomain mode

Subdomain mode runs every proxied site on its own host under your domain, so the browser itself keeps sites apart. It
is optional and off by default, and it needs wildcard DNS and a wildcard certificate.

## What it does

With `GIRICI_SITE_DOMAIN=proxy.example`, the Girici UI, sign-in and admin stay on `https://proxy.example`. Each proxied
site opens on a host of its own, such as `https://k6wjalxihe6pja6woodbryo47k.proxy.example`. The first part is a
26-character label that Girici computes from the site with a secret key. One site always gets the same label on one
instance; another instance, with its own secret, gives it a different one.

Each host gets its own service worker, cookie jar, storage and copy of Girici's page script. The browser's same-origin
rule then keeps one site's pages away from another site's windows and data, where single-origin mode has to rebuild
those walls in JavaScript. The [threat model](/guide/threat-model#in-subdomain-mode) lists what that closes.

A site here is a scheme plus a registrable domain:

- `example.com`, `www.example.com` and `accounts.example.com` share one host, because sign-ins often set a cookie on
  one of them and read it on another. Inside that host, Girici keeps them apart as it does in single-origin mode.
- `http://example.com` and `https://example.com` are two sites with two hosts.
- Names in the private part of the public suffix list count as sites of their own: `alice.github.io` and
  `bob.github.io` get two hosts, and SameSite cookies and `Sec-Fetch-Site` treat them as two sites.
- An IP address or a single-label host name is its own site.

Addresses inside pages still look like `/~/https/example.com/…`. When a page links or posts to another site, the
service worker sends the browser on to that site's host. A `/~/` address opened on the root, typed or from a bookmark,
redirects to the site's host.

## When to use it, and what it costs

Subdomain mode fits an instance where people sign in to accounts they care about, or open sites they do not trust next
to ones they do. Single-origin mode stays the default because this mode has costs:

- **Site labels show up in DNS and TLS.** The browser looks up `<label>.proxy.example` and names it in the TLS
  handshake, so anyone who watches the network, such as the visitor's ISP or DNS resolver, sees one stable label per
  site. The key behind the labels is not hidden from the pages people browse: on a public instance any visitor and any
  proxied page can learn it, and on a private instance every page a signed-in user opens gets it. Either way labels can
  be matched to sites by trying likely ones. A signed-out visitor of a private instance learns neither the key nor any
  site's host. In single-origin mode the site appears only in the path, inside TLS.
- **The first visit to each site downloads the engine again.** Every host has its own service worker and cache, so the
  first visit to a site costs an extra round trip and about 700 KB of engine before compression.
- **It needs a domain of its own.** Girici sets cookies for the whole domain, among them the session that lets site
  hosts use the relay on a private instance. Any other service at that name or under it would receive them. A
  subdomain that serves only Girici, such as `girici.example.com`, works. A proxied page can also set cookies for the
  registrable domain above it, `example.com` in that case, so when other services live under that domain, give Girici
  a registrable domain of its own.

## Requirements

- A domain or subdomain that serves nothing but Girici, `proxy.example` on this page.
- DNS records (A, AAAA or both) for `proxy.example` and `*.proxy.example`, pointing at the server or at the proxy in
  front of it.
- One TLS certificate for `proxy.example` and `*.proxy.example`. Let's Encrypt and other ACME authorities issue
  wildcard certificates only through the DNS-01 challenge, so the tool that fetches the certificate needs API access to
  your DNS provider. Service workers need HTTPS, so plain http works only on `localhost` names.
- A reverse proxy that passes the `Host` header on unchanged. Girici decides from `Host` alone whether a request is for
  the UI or for a site.

## Setup with the `sites` profile

The compose file has a `sites` profile that runs Caddy with a DNS provider module, built from `deploy/caddy-dns`. Its
config, `deploy/Caddyfile.sites`, serves the domain and every host under it with one wildcard certificate, and uses
Cloudflare DNS unless you change it.

1. Point `proxy.example` and `*.proxy.example` at the server.
2. In Cloudflare, create an API token with the `Zone.Zone:Read` and `Zone.DNS:Edit` permissions for the zone.
3. Copy `.env.example` to `.env` next to `docker-compose.yml` and fill in:

   ```bash
   GIRICI_SITE_DOMAIN=proxy.example
   GIRICI_TRUST_PROXY=1
   CLOUDFLARE_API_TOKEN=<your token>
   ```

4. Build the Caddy image and start everything:

   ```bash
   docker compose --profile sites up -d --build
   ```

Caddy fetches the certificate on its first start, and `docker compose logs caddy-sites` shows how that went. Then open
`https://proxy.example`.

Run the `sites` profile instead of the `https` profile, not next to it: both bind ports 80 and 443. `GIRICI_DOMAIN` is
only for the `https` profile.

### Another DNS provider

Caddy has DNS modules for many providers, listed at [github.com/caddy-dns](https://github.com/caddy-dns). To use one:

1. Set `CADDY_DNS_MODULE` in `.env` to the module path from its README, for example
   `github.com/caddy-dns/digitalocean@master`.
2. Replace the `dns` line in `deploy/Caddyfile.sites` with the one from the same README, for example
   `dns digitalocean {env.DO_AUTH_TOKEN}`.
3. Add the variables that line reads to the `caddy-sites` service's `environment:` in `docker-compose.yml`, such as
   `DO_AUTH_TOKEN: ${DO_AUTH_TOKEN:-}`, and set them in `.env`.
4. Rebuild and restart with `docker compose --profile sites up -d --build`.

For nginx, Traefik or Cloudflare instead of Caddy, see [Reverse proxies](/guide/reverse-proxy#subdomain-mode).

### Trying it on your own machine

Chrome and Firefox resolve every `*.localhost` name to your own machine and treat it as a secure context, so you can try
the mode without DNS or certificates. From a source checkout:

```bash
npm run build
GIRICI_SITE_DOMAIN=girici.localhost:3000 npm start
```

Then open `http://girici.localhost:3000`. With Docker, pass `-e GIRICI_SITE_DOMAIN=girici.localhost:3000` to
`docker run`.

## Settings

| Variable | Default | What it does |
|----------|---------|--------------|
| `GIRICI_SITE_DOMAIN` | unset | Turns subdomain mode on. The UI runs on this host and each site on `<label>.<this host>`. |
| `GIRICI_SITE_SECRET` | generated, kept in the database | The secret behind the labels, 32 or more characters. |

`GIRICI_SITE_DOMAIN` takes a host name, with a port only if visitors type one:

- ASCII letters, digits and hyphens. Write an internationalized name in its `xn--` form. Case does not matter.
- At least two labels, each 1 to 63 characters long, none starting or ending with a hyphen. The last label cannot be all
  digits.
- At most 226 characters, so that a 26-character label and a dot still fit in the 253 characters a host name allows.
- No scheme, path, trailing dot or IP address: `proxy.example`, not `https://proxy.example/`.
- Not a public suffix. Browsers refuse a cookie set for a whole public suffix, and the site hosts depend on such
  cookies, so `github.io` is refused. Your own domain, or a name under it, is fine.
- A port only when the address visitors open has one, as in `girici.localhost:3000` or `proxy.example:8443`. Leave
  off `:443` and `:80`. Browsers leave the default port out of the `Host` header and Girici compares `Host` with this
  value exactly, so `proxy.example:443` would match no request at all; startup refuses it.

An empty value counts as unset. A value that breaks a rule stops startup with a message that names the variable.

`GIRICI_SITE_SECRET` is optional. Without it, Girici generates a random secret once and keeps it in its database. Set it
when several replicas serve one domain, so that they all compute the same labels, or when the labels must survive a
new database. `openssl rand -hex 32` makes one. Never change it: every site would move to a new host, and the data it
kept in visitors' browsers would stay behind on the old one. Keep it private too, because it also signs the cookies
that carry settings to the site hosts and the steps that clear site data.

To add replicas to an instance that already runs subdomain mode without the variable, copy the secret its database
keeps and set that value on every replica. Girici logs a warning at startup when `GIRICI_SITE_SECRET` differs from the
stored one. With the compose file:

```bash
docker compose exec girici node -e 'const { DatabaseSync } = require("node:sqlite");
console.log(new DatabaseSync("/data/girici.db", { readOnly: true })
  .prepare("SELECT value FROM settings WHERE key = ?").get("site_secret").value)'
```

Every other setting works as in single-origin mode. `GIRICI_TRUST_PROXY` and the rate limits are unchanged, and one
visitor's requests to all hosts count against one limit. With public access off, signing in on `proxy.example` covers
every site host as well. A signed-out visitor who opens a site's address goes to the sign-in page on the root and comes
back to the site afterwards.

## What changes for visitors

- **Each site has its own address.** The address bar shows `https://<label>.proxy.example/~/https/example.com/…`,
  while the UI stays on `https://proxy.example`. Sites opened from the UI, from history or from a bookmark go through
  the root, which redirects to the site's host. With **Encrypt page addresses** on, a site's first page can show its
  plain address until Girici's engine runs on that host.
- **Every site starts signed out.** Each host starts with an empty cookie jar, so visitors sign in to each site again
  the first time they open it in this mode.
- **Third-party cookies are partitioned when allowed.** **Block third-party cookies** stays on by default and works as
  before. With it off, an embedded site's requests carry the cookies that site set while embedded in the same top site,
  not the ones from its own tabs. Safari and Firefox's Total Cookie Protection work the same way. An embed that expects
  the site's own sign-in, such as a comment widget you signed in to in another tab, does not see it.
- **Safari keeps a copy per embedder.** In Safari, a site embedded in another site gets its own service worker, cookie
  jar and caches for each site that embeds it, and each copy pays the first-visit download.
- **Settings reach open sites on their next load.** The UI sends its settings to the server, which keeps them in a
  signed cookie that every site host reads. A site that is already open picks up a change on its next page load.
- **The shared-link warning shows once per site.** Each site host remembers it on its own, so with
  [the warning](./admin-and-auth.md#shared-link-warning) on, a visitor sees it the first time they open each site,
  from a link or from the UI.
- **The browser check runs on the root.** A site host sends a visitor who needs
  [the check](./admin-and-auth.md#browser-check) to `proxy.example`, whose pass works on every site host.
- **Clearing data walks through each site.** **Settings → Site data** lists the sites opened in this browser. Clearing
  one or all of them takes the tab through each site's host in turn, where a `Clear-Site-Data` response empties it,
  and then back to Settings. The list keeps the most recent sites that fit in about 3 KB; a site that falls off it
  keeps its data until the browser evicts it or you clear `proxy.example` in the browser. The toolbar's **Clear site
  data** clears the whole host of the site you are on. In Safari, the copies a site left while embedded elsewhere are
  out of reach; Safari's own website data removal clears them.

## Known limits

- **Labels travel in DNS and TLS.** Someone who watches the network sees one stable label per site, and anyone allowed
  to browse an instance can match its labels to sites (see [costs](#when-to-use-it-and-what-it-costs)).
- **A page can still send its own tab out of the proxy.** A page that writes its own `location` through a key built at
  run time navigates the tab to the real site, outside Girici. No browser setting stops a document from navigating
  itself.
- **Navigations between sites lose their initiator.** A navigation from another site's host is cross-site: the
  receiving site gets no `Referer`, SameSite cookies follow the cross-site rules, and a POST carries `Origin: null`, as
  browsers send under `no-referrer`. Embeds that insist on a referrer, such as maps with referrer-restricted API keys
  or some video players, may refuse to load.
- **A form post without a referrer counts as cross-site.** To keep a site's own forms working, Girici turns a page's
  `no-referrer` policy (from the `Referrer-Policy` header, `<meta name="referrer">`, a `referrerpolicy` attribute or
  `rel="noreferrer"` in the page's markup) into `same-origin`. The referrer then reaches only the page's own host, and
  the real site may see a `Referer` for its own pages where the page asked for none. A policy a script sets later stays
  as written. A plain load without a referrer, such as a typed address or a link from a page that hides its referrer,
  counts as a direct visit, since the service worker cannot tell those apart.
- **Some cross-site form posts lose their body or stop.** In Safari, a form that uploads files to another site arrives
  without its fields and files. In every browser, a `multipart/form-data` POST to a site never opened before in that
  browser stops at a page that asks to open the site once first.
- **Form posts to another site are sent again as UTF-8.** Girici rebuilds such a form on the other host, reading and
  writing its fields as UTF-8, so a page that posts in another encoding, such as Shift_JIS or windows-1252, sends its
  non-ASCII values garbled.
- **Some messages between sites arrive as copies.** A message whose sender names a host under its site, such as
  `www.example.com` on `example.com`'s host, waits until the service worker confirms that host, and the page then
  receives a copy whose `isTrusted` is false. Messages that arrive while one waits come the same way, to keep their
  order.
- **Safari installs an embedded site again per embedder.** Each site that embeds another gets its own worker install
  and cookie jar for it.
- **Browser protections keyed to the site treat all Girici hosts as one.** Every host sits under one registrable
  domain, so features that browsers key to the site rather than the origin do not separate Girici sites: HTTP cache
  partitioning, the `window.name` reset on cross-site navigation, process-per-site and SameSite cookies. Girici sends
  `Origin-Agent-Cluster: ?1`, which asks Chromium to give each host its own agent cluster.
- **Cookies for the whole domain.** A page can set cookies for `proxy.example`, which every host receives. It cannot
  read Girici's own cookies. It can add cookies under their names, so Girici checks every value it receives, keeps only
  values it signed, and merges settings to the more private choice: such a cookie can turn third-party blocking or
  address sealing on, never off. What is left is flooding: a page can set enough cookies that requests fail with `431`
  on every host, the UI's included, or that the browser drops Girici's own cookies to stay under its per-domain limit,
  which signs the site hosts out and resets the settings and the list of visited sites until the UI writes them again.
  The same flood works in single-origin mode. Clearing the cookies for `proxy.example` in the browser fixes it.
- **The first visit to each site costs more.** An extra round trip and about 700 KB of engine before compression, and
  in Safari once more for each site that embeds it.
- **Third-party cookies, when allowed, are partitioned per embedding site.** See
  [What changes for visitors](#what-changes-for-visitors).
- **`localStorage` of an embedded site.** In Chromium, Firefox and WebKit, what a site writes to `localStorage` while
  embedded lands in the same browser storage as its top-level copy. Girici's storage prefix keeps the two apart.

## Moving an existing instance

1. Add the wildcard DNS record and get the wildcard certificate: switch from the `https` profile to `sites`, or update
   your proxy.
2. Set `GIRICI_SITE_DOMAIN`, and `GIRICI_SITE_SECRET` if you run replicas, then restart Girici.

What visitors notice:

- **Data does not move.** Cookies and storage from single-origin mode stay on `proxy.example`, where no site can reach
  them, and each site starts empty and signed out on its own host. **Settings → Site data** offers to remove the old
  data.
- **Plain links keep working.** `/~/` links and bookmarks on the root redirect to the site's host.
- **Admins stay signed in.** On a private instance, the first visit to the Girici UI or to a `/~/` link extends the
  admin's session to the site hosts. A site's own address opened before that lands on the Girici home page once.
- **Encrypted links stop working.** An encrypted address (`/~/x/…`) from single-origin mode opens a page that says to
  open the site again from Girici.
- **The old service worker retires.** The UI removes the service worker left on the root and reloads once. A tab left
  open across the switch shows errors until it is reloaded.

## Turning it off

Unset `GIRICI_SITE_DOMAIN`, restart Girici, and go back to the `https` profile or your old proxy config. Then delete
the `*.proxy.example` DNS record. Single-origin mode does not route by host, so while the record exists every site
host answers as a separate single-origin Girici. Data that sites stored on their hosts stays in visitors' browsers, out
of reach, until they clear it there.

## Troubleshooting

**Every page answers 404.** Girici answers 404 on any host that is neither `GIRICI_SITE_DOMAIN` nor a site host, a
26-character label in front of it; only `/healthz`, `/robots.txt` and `/metrics` work there, so health checks and
scrapes by IP address or internal name keep passing. Check that the
address in the browser matches the variable exactly: the same name, a port only if the address shows one, and no
`:443`. `www.proxy.example`, other subdomains and the server's IP address all get 404. Redirect them in the proxy if
visitors use them.

**404 only through the reverse proxy.** The proxy rewrites `Host`, so Girici sees `127.0.0.1:3000` or an internal name
instead of the address the visitor opened. Pass `Host` on as the browser sent it; see
[Reverse proxies](/guide/reverse-proxy#subdomain-mode). With nginx on a port other than 443, use `$http_host`, which
keeps the port.

**Startup stops with "not a public suffix".** The message reads `GIRICI_SITE_DOMAIN must be a domain you control, not a
public suffix such as github.io`. Use a domain you registered, or a name under it.

**Startup stops with "must be a host name".** The value has a scheme, a path, a trailing dot, a bad port or a character
outside letters, digits and hyphens. Write only the host, such as `proxy.example`.

**Certificate errors on site hosts only.** The certificate covers `proxy.example` but not `*.proxy.example`. The
`https` profile fetches a certificate for the root only; use the `sites` profile. Behind Cloudflare, see the edge
certificate note in [Reverse proxies](/guide/reverse-proxy#cloudflare-in-subdomain-mode).

**Requests fail with 431 on every host.** The browser holds too many cookies for the domain. Clear the cookies for
`proxy.example` in the browser's settings.
