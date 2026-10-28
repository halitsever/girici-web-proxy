# Configuration

Girici is configured with environment variables. Every value is validated at startup, so a bad setting
stops the server with a message naming the variable.

## Environment variables

| Variable | Default | What it does |
|----------|---------|--------------|
| `PORT` | `3000` | Port to listen on. `LISTENER_PORT` is accepted as an alias. |
| `HOST` | `0.0.0.0` | Address to bind. |
| `LOG_LEVEL` | `info` | One of `error`, `warn`, `info`, `debug`. |
| `SOURCE_URL` | the project repo | The "source code" link shown in the UI (AGPL requires offering the running source). Point it at your fork. |
| `GIRICI_DATA_DIR` | `/data` in Docker, `.data` locally | Directory for the SQLite database (`girici.db`). |
| `GIRICI_TRUST_PROXY` | `false` | Whether to trust `X-Forwarded-For`. See the warning below. |
| `GIRICI_SESSION_SECRET` | unset | Overrides the database-stored session secret. Set the same value on every replica so sessions validate across them. |
| `GIRICI_YT_POTOKEN` | `true` | Whether the server mints YouTube poTokens. Set to `false` to disable. |

Booleans accept `true`/`1`/`yes`/`on` and their negatives.

## Trust proxy

`req.ip` is the key the login rate limit uses. Behind a reverse proxy, `req.ip` comes from
`X-Forwarded-For` only when `GIRICI_TRUST_PROXY` is set.

Set it to the **number of proxies** in front of Girici (for example `1` behind a single reverse proxy),
not `true`. The value `true` trusts a header the client can spoof, which lets an attacker rotate it to
defeat the login rate limit. Leaving it unset behind a real proxy has the opposite problem: every client
collapses to one bucket.

## Data directory

The admin account and settings live in `${GIRICI_DATA_DIR}/girici.db`. Back up that file to keep the
account and settings. In Docker, mount a volume at the data directory so it survives restarts; see
[Running with Docker](/guide/docker).

## Source link and AGPL

Girici is AGPL-3.0. If you run a modified version for others, you must offer them its source. Set
`SOURCE_URL` to the repository of the exact code you are running.
