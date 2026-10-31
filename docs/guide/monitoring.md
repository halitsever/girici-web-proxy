# Monitoring

Girici has a health endpoint and plain-text logs. A metrics endpoint is planned for a later release.

## Health check

`GET /healthz` answers `200` with the body `ok` when the server can take requests. Anything else, or no answer,
means it is down. It needs no sign-in and logs nothing, so uptime checkers can poll it freely.

The Docker image runs this check every 30 seconds (`docker ps` shows `healthy` or `unhealthy`). Point your load
balancer, uptime service or orchestrator at the same path:

```bash
curl -fsS https://proxy.example/healthz
```

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
