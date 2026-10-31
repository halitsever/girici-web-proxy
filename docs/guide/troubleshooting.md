# Troubleshooting and FAQ

Common problems when running or using Girici and how to fix them, followed by questions operators often ask.

## Setup and sign-in

### Where is the setup code?

In the server log, printed at startup until the admin exists:

```bash
docker logs <container> 2>&1 | grep "setup code"
```

On Render, Fly.io or Railway, open the service's log view. A restart prints a new code, so use the latest one. If
`GIRICI_SETUP_TOKEN` is set, the log does not print it; enter that value instead.

### I forgot the admin password

Run the reset tool where the server's database is. It prints a new password and signs out every session:

```bash
docker compose exec girici node reset-admin-password.js
```

### Sign-in or forms fail with 403 behind my reverse proxy

The proxy changes the `Host` header. Girici compares it with the page's `Origin`. Pass the original host, for
example `proxy_set_header Host $host;` in nginx. See [Reverse proxies](/guide/reverse-proxy).

### Visitors hit the rate limit or get `429` together

Girici sees every visitor as the same address, so they share one limit. Behind a proxy, set `GIRICI_TRUST_PROXY` to
the number of proxies in front of it. The log says so if it notices.

### The setup screen came back on an instance I already set up

The database is gone, usually because `/data` is not on a persistent volume and the container was recreated. Mount a
volume at `/data`, then set up again.

### Girici exits with `Cannot open the database in /data`

The data directory is not writable by the user inside the container (`node`, UID 1000). With a bind mount, run
`sudo chown 1000:1000 <host dir>`. With a platform disk, see [Cloud platforms](/guide/cloud-platforms).

## Pages do not load

### Nothing loads on a plain `http://` address

Service workers need a secure context. `http://localhost` and `http://127.0.0.1` count; `http://192.168.1.10` or
`http://proxy.example` do not. Put Girici behind HTTPS (the compose file has a Caddy profile), or reach it through an
SSH tunnel to `localhost`.

### Pages stopped loading after I put a CDN in front

The CDN rewrites or minifies JavaScript under `/_g/`, and Girici refuses its page script when the bytes change. Turn
off minification, Rocket Loader and similar features for `/_g/*`, and purge the CDN cache.

### A page is blank or half-broken

Try in this order:

1. **Clear site data** from the Girici button in the page's corner, then reload.
2. Turn off **Settings → Show toolbar on sites** if the site reacts to the toolbar.
3. Turn off **Settings → Block third-party cookies** if the page embeds sign-ins from another site.
4. Open the same page directly, without Girici, from the server's network. If it fails there too, the site blocks
   the server's IP; see the next question.

If it still fails, open an issue with the address, the browser and what the console shows.

### A site shows a CAPTCHA, "access denied" or keeps asking me to verify

Many sites block datacenter IP ranges or flag them for bot checks, whatever the proxy does. Google, for example,
sends some server IPs to its "unusual traffic" page even without a proxy. Girici cannot hide that. Running it on a
home connection, or setting `GIRICI_UPSTREAM_PROXY` to a residential proxy, usually helps.

### YouTube videos stop after about a minute, or do not play

YouTube ties playback to tokens bound to the IP address. Girici mints one on the server (`GIRICI_YT_POTOKEN`, on by
default), which plays many videos, but YouTube still blocks sustained playback of some, more often from datacenter
IPs. A residential `GIRICI_UPSTREAM_PROXY` helps; Girici sends the relay, WebSockets and token minting through it so
they share one IP.

### Voice and video calls do not work

WebRTC is turned off in proxied pages, because it would connect your browser to the site directly and skip the
proxy. Calls, screen sharing and peer-to-peer features do not work through Girici.

### A site opened outside the proxy

Some scripts reach `location` or other windows in ways Girici cannot rewrite. See the
[threat model](/guide/threat-model) for the list. Please report the site.

## FAQ

### Does Girici hide me from the operator?

No. The server sees all traffic in the clear. See [What the operator sees](/guide/threat-model#what-the-operator-sees).

### Can several people use one instance?

Yes, with **Public access** on in Settings: anyone who knows the address can browse. There is still one admin
account. Each visitor's cookies and site data stay in their own browser.

### Can I run more than one replica?

Not yet in a useful way. Each replica has its own SQLite database. Run one instance and give it a persistent disk.

### Does it work in every browser?

Girici needs a browser with service workers. The automated tests run in Chromium, Firefox and WebKit (Safari's
engine) on every change.

### Why is the address bar full of `/~/https/...`?

That is how Girici keeps every site on its own origin while the browser resolves relative links normally. See
[How it works](/guide/how-it-works).
