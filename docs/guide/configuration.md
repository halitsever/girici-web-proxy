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
| `GIRICI_RATE_LIMIT` | `3000` | Proxy requests per client per minute, with bursts up to the same number. The signed-in admin is never limited. `0` turns it off. |
| `GIRICI_BLOCKED_HOSTS` | unset | Sites to refuse, comma or space separated. Each entry also blocks its subdomains. The admin can add more in Settings. |
| `GIRICI_UPSTREAM_PROXY` | unset | Send all upstream traffic through this proxy: `http://`, `https://`, `socks5://` or `socks5h://`, with optional `user:password@`. |
| `GIRICI_SESSION_SECRET` | unset | Overrides the database-stored session secret; 32 or more characters (`openssl rand -hex 32`). Set the same value on every replica so sessions validate across them. |
| `GIRICI_SETUP_TOKEN` | unset | A fixed setup code (8 or more characters, not counting spaces and dashes) instead of the random one printed at startup. |
| `GIRICI_YT_POTOKEN` | `true` | Whether the server mints YouTube poTokens. Set to `false` to disable. |
| `GIRICI_BANDWIDTH_LIMIT` | `0` (off) | Bytes each visitor may start moving per minute, such as `50MB`. A response that starts under the limit finishes, so a visitor can go over it (see [Bandwidth limits](#bandwidth-limits)). The signed-in admin is never limited. |
| `GIRICI_DAILY_QUOTA` | `0` (off) | Bytes each visitor may start moving per day, such as `2GB`, checked the same way. Counts reset at midnight UTC and when Girici restarts. |
| `GIRICI_METRICS_TOKEN` | unset | Turns on `/metrics` for Prometheus, answered only with `Authorization: Bearer <token>`. 16 or more characters. |
| `GIRICI_POW_DIFFICULTY` | `16` | How hard the browser check is, 1 to 24; each step doubles the work. The check itself is switched on in Settings. |

Booleans accept `true`/`1`/`yes`/`on` and their negatives; any other value stops startup.

Sizes take `B`, `KB`, `MB`, `GB` or `TB` (powers of 1024, any case); a bare number is bytes.

## Trust proxy

The client address is the key the login and proxy rate limits use. Behind a reverse proxy, it comes from
`X-Forwarded-For` only when `GIRICI_TRUST_PROXY` is set.

Set it to the **number of proxies** in front of Girici (for example `1` behind a single reverse proxy),
not `true`. It also takes a comma-separated list of proxy addresses and subnets, or the names `loopback`,
`linklocal` and `uniquelocal`; a value Girici cannot read stops startup. The value `true` trusts a header the client can spoof, which lets an attacker rotate it to
defeat the login rate limit. Leaving it unset behind a real proxy has the opposite problem: every client
collapses to one bucket.

## Upstream proxy

`GIRICI_UPSTREAM_PROXY` sends every upstream connection through one proxy: the HTTP relay, the WebSocket
relay and YouTube poToken minting. Use it when sites block your server's own IP, for example with a
residential proxy. The value is a URL such as `socks5://user:password@proxy.example:1080`; `http://`,
`https://`, `socks5://` and `socks5h://` work.

Girici still checks every target before it opens a tunnel and refuses private and local addresses. With
`socks5://` it resolves the name itself and hands the proxy the checked address. With `http://`,
`https://` and `socks5h://` the proxy resolves the name, so a site could point it at a private address
between the check and the connection. That only matters when the proxy can reach a private network; if
it can, use `socks5://`.

YouTube ties its playback tokens to the IP that minted them, which is why minting goes through the same
proxy as the video traffic.

## Bandwidth limits

`GIRICI_BANDWIDTH_LIMIT` and `GIRICI_DAILY_QUOTA` limit how much traffic each visitor moves through a public
instance. A visitor is a client address, the same key the rate limit uses, so behind a reverse proxy set
[`GIRICI_TRUST_PROXY`](#trust-proxy) first. IPv6 clients share a budget per /64.

Both count the bodies Girici relays, downloads and uploads alike, plus WebSocket messages both ways. Headers and
Girici's own pages and scripts are not counted.

The per-minute limit is a bucket that holds one minute's worth and refills continuously. A request starts while
any budget is left, and a response that has started always finishes, even when it takes the bucket below zero.
The visitor then waits until the bucket climbs back above zero. A video that started under the limit keeps
playing; the limit bites on the next request.

Both budgets are checked only when a request or WebSocket starts, so a visitor can go over them by whatever they
start at once or by one long response. An open WebSocket is the exception: it is checked on every message and closed
once the budget runs out.

The daily quota counts from midnight UTC and starts over at the next one.

Once either budget is spent, relay requests get `429` with a `Retry-After` header, and pages show a notice
saying when to try again. New WebSockets are refused the same way, and an open one closes with code 1008 when it
goes over. The signed-in admin is never refused or cut, even when they share an address with visitors who spent
theirs.

The counts live in memory: a restart resets them, and each replica counts on its own. Responses the browser
serves from its own cache cost nothing and count nothing.

## Data directory

The admin account and settings live in `${GIRICI_DATA_DIR}/girici.db`. SQLite runs in WAL mode, so
recent changes can sit in `girici.db-wal` next to it while Girici runs. Back up the whole directory with
Girici stopped, or use `sqlite3 girici.db ".backup backup.db"` while it runs. In Docker, mount a volume at the data directory so it survives restarts; see
[Running with Docker](/guide/docker).

## Source link and AGPL

Girici is AGPL-3.0. If you run a modified version for others, you must offer them its source. Set
`SOURCE_URL` to the repository of the exact code you are running.
