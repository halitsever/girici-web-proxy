# Monitoring

Girici has a health endpoint, a Status section for the admin, an optional Prometheus endpoint and plain-text logs.

## Health check

`GET /healthz` answers `200` with the body `ok` when the server can take requests. Anything else, or no answer,
means it is down. It needs no sign-in and logs nothing, so uptime checkers can poll it freely.

The Docker image runs this check every 30 seconds (`docker ps` shows `healthy` or `unhealthy`). Point your load
balancer, uptime service or orchestrator at the same path:

```bash
curl -fsS https://proxy.example/healthz
```

## Status in Settings

Signed in as the admin, open **Settings**. The **Status** section shows:

- when the server started and how many relayed WebSockets are open now;
- the last hour: a chart of data sent to browsers minute by minute, and the hour's totals of requests, data sent
  and refused requests;
- the last 30 days: requests, data sent and received, refused and failed requests per day;
- the bandwidth limit, the daily quota and whether the metrics endpoint is on.

**Refused** means Girici turned the request away: sign-in needed, rate limit, quota, browser check, a blocked site, a
body that was too large, a malformed request or a private address. **Failed** means the site could not be reached:
DNS, connection, TLS, timeout, oversized headers or the upstream proxy. Days and times are in UTC.

Counting is always on and keeps numbers only. No site, page or visitor address is stored. The last hour lives in
memory and starts empty after a restart. Daily totals go to `girici.db` once a minute when the minute had traffic,
and once more when Girici stops, so a normal stop or restart keeps them. Days older than 90 are deleted. With several
replicas, each one counts its own traffic.

## Metrics

Set `GIRICI_METRICS_TOKEN` to turn on `GET /metrics` in the Prometheus text format. The token needs 16 or more
characters, using only letters, digits, `-._~+/` and a trailing `=`, since it travels in a header;
`openssl rand -hex 32` makes one. Without the variable, `/metrics` does not exist.

Every request must carry the token as `Authorization: Bearer <token>`. A missing or wrong token gets `401`.

```bash
curl -fsS -H "Authorization: Bearer $GIRICI_METRICS_TOKEN" https://proxy.example/metrics
```

| Metric | Type | Labels | What it counts |
|--------|------|--------|----------------|
| `girici_relay_requests_total` | counter | `kind`, `code` | Relay requests (`kind="http"`) and WebSocket opens (`kind="ws"`) by how they ended. `code="ok"` reached the site; any other code names the refusal or failure. |
| `girici_relay_bytes_total` | counter | `direction` | Body and WebSocket bytes relayed: `down` to browsers, `up` to sites. |
| `girici_websockets_open` | gauge | | Relayed WebSockets open now. |
| `process_start_time_seconds` | gauge | | When the process started, in seconds since the Unix epoch. |

The codes are `auth`, `rate_limited`, `quota`, `challenge`, `blocked`, `too_large`, `bad_request` and `ssrf_blocked`
(refused), and `dns`, `connect`, `tls`, `timeout`, `header_overflow` and `proxy` (failed). Every code is listed from the
start at `0`. Labels never carry a site, a path or an address. The counters start from zero when Girici starts;
`rate()` and `increase()` handle that.

A Prometheus job for it:

```yaml
scrape_configs:
  - job_name: girici
    scheme: https
    metrics_path: /metrics
    authorization:
      credentials: "<your token>"
    static_configs:
      - targets: ["proxy.example"]
```

`credentials_file` reads the token from a file instead. With several replicas, scrape each one: they count apart.

In [subdomain mode](./subdomain-mode.md), `/metrics` and the Status section's data answer only on the root host, so
the scrape must reach Girici under that name (`proxy.example` above). An internal name such as `girici:3000` gets
`404`.

Proxied pages cannot reach `/metrics`. A page's own `/metrics` links, once Girici rewrites them, go to the site the
page came from, and one that escaped rewriting gets `403` from the service worker. The endpoint shares the proxy's
port, so you can also keep it off the internet with a rule in your reverse proxy.

## Logs

Girici writes one line per event to standard output:

```
2026-10-31T09:12:44.512Z INFO  Girici listening on http://0.0.0.0:3000
```

`LOG_LEVEL` picks how much: `error`, `warn`, `info` (default) or `debug`. Girici writes no access log; use your
reverse proxy's log for that. At `debug` it adds the host of relay requests that failed, which is private data on a
shared instance, so turn it back down when you are done.

In Docker, read them with `docker logs <container>` or `docker compose logs girici`.

### Lines worth an alert

| Line | What it means |
|------|---------------|
| `Cannot open the database in /data: ...` | The data directory is missing or not writable. Girici exits. |
| `Upstream proxy failed; check GIRICI_UPSTREAM_PROXY` | The upstream proxy is down or refusing. Logged at most once a minute. |
| `Requests arrive with X-Forwarded-For but GIRICI_TRUST_PROXY is off` | Girici is behind a proxy, and every visitor shares one rate limit. See [Reverse proxies](/guide/reverse-proxy). |
| `GIRICI_TRUST_PROXY=true trusts every X-Forwarded-For entry` | Clients can forge their address. Set a number instead. |
| `Girici setup code: ...` | No admin exists yet. On an instance you set up long ago, this means the database was lost. |
| Any `ERROR` line with a stack trace | An unexpected failure. Please report it. |

## What to watch on the host

- **Disk:** the database stays small, but the disk must stay writable.
- **Memory:** grows with the number of visitors. YouTube token minting loads a DOM emulator on first use, which adds
  to it; set `GIRICI_YT_POTOKEN=false` on small machines that do not need YouTube.
- **Bandwidth:** every byte a visitor loads passes through the server twice (in from the site, out to the browser).
  On metered hosting, a public instance can get expensive.
- **Open connections:** each visitor can hold up to 20 relayed WebSockets.

## Backups

Back up `girici.db` in the data directory. It holds the admin account, settings and blocked sites. Cookies and site
data live in each visitor's browser, not on the server. The safest copy is taken with SQLite itself, which works
while Girici runs:

```bash
docker compose exec girici node -e "
  require('node:fs').rmSync('/data/backup.db', { force: true });
  new (require('node:sqlite').DatabaseSync)('/data/girici.db').exec(\"VACUUM INTO '/data/backup.db'\");
"
docker compose cp girici:/data/backup.db ./girici-backup.db
```

Or stop the container and copy every `girici.db*` file from the volume.
