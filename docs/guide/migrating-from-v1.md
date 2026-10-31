# Migrating from v1

Girici v2 is a rewrite. v1 rewrote pages on the server; v2 does it in the browser with a service worker, adds an
admin account and keeps a small database. Nothing from v1 needs to be carried over, but a few things change for
whoever runs it.

## What changes

| | v1 | v2 |
|---|---|---|
| Proxied address | `/proxy/<url>` | `/~/<scheme>/<host><path>`; old `/proxy/` links redirect |
| Access | open to anyone | admin login; **Public access** in Settings opens it |
| State on disk | none | SQLite database in `/data` |
| HTTPS | optional | required outside `localhost` (service workers) |
| Port variable | `LISTENER_PORT` | `PORT`; `LISTENER_PORT` still works |
| Upstream proxy | `HTTP_PROXY` and friends | `GIRICI_UPSTREAM_PROXY` |
| `DEBUG`, `SHOW_ERRORS` | logging switches | gone; use `LOG_LEVEL` |
| License | MIT | AGPL-3.0 |

## Docker image tags

`halitsever/girici-web-proxy:latest` has pointed to v2 since v2.0.0. The last v1 image stays available as
`halitsever/girici-web-proxy:v1`, and gets no updates. To follow v2 without jumping to a future major version, use
the `v2` tag; to pin an exact release, use a version tag such as `2.1.2`.

## Steps

1. **Add a volume** for `/data`. Without it, the admin account is lost on every restart.

   ```bash
   docker run -d -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:v2
   ```

2. **Put it behind HTTPS** if visitors reach it by anything other than `localhost`. v1 worked over plain HTTP; v2
   does not. The compose file has a Caddy profile, and [Reverse proxies](/guide/reverse-proxy) covers nginx, Traefik
   and Cloudflare Tunnel. Set `GIRICI_TRUST_PROXY` to the number of proxies in front of it.
3. **Create the admin.** Open Girici, enter the setup code from the log, and create the account.
4. **Decide on access.** v1 was open to anyone who found it. v2 is private until you turn on **Public access**.
   If you ran v1 as a public proxy, read the [threat model](/guide/threat-model) before opening v2.
5. **Rename variables.** Move an upstream proxy from `HTTP_PROXY`/`HTTPS_PROXY` to `GIRICI_UPSTREAM_PROXY`, and drop
   `DEBUG` and `SHOW_ERRORS`.
6. **Run one instance.** v1's compose file ran three Swarm replicas. v2 keeps its account in a local database, so run
   a single instance with its volume.

## Running a modified copy

v2 is AGPL-3.0. If you change the code and let others use your instance, you must offer them the source of your
version. Set `SOURCE_URL` to your fork; the UI links there.
