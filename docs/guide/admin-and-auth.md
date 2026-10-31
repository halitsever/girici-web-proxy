# Admin and auth

Girici stores a single admin account and its settings in a small SQLite database
(`<data dir>/girici.db`). The database is created on first run.

## Setup

The first time you open Girici with no admin yet, every route sends you to the setup screen. You create
one admin (username, name, email, password, at least 8 characters). After setup you are signed in.

Setup asks for a one-time code that Girici prints to its log at startup, whatever `LOG_LEVEL` says:

```
Girici setup code: K7QM-2XPA-9FDR
Open Girici in a browser and enter this code to create the admin account.
```

Only someone who can read the server log can create the admin, so a fresh instance that is already reachable from
the internet cannot be claimed by a stranger. A restart prints a new code until setup is done. To choose the code
yourself, for example in automated deployments, set `GIRICI_SETUP_TOKEN` (8 or more characters).

## Login

Once an admin exists, the proxy requires a login. Visiting a proxied page while signed out redirects you
to the login screen, and signing in sends you back where you were headed.

The session is a stateless cookie, signed with a secret stored in the database. Over HTTPS it is
`__Host-girici`; on a plain-HTTP page such as `http://localhost` it is `girici-session`, because Safari drops the
Secure cookie that `__Host-` requires there. There
is no server-side session table; signing out clears the cookie.

**Sign out everywhere** on the Account page voids every session the admin has, on every device. Changing the
password and running the reset tool below do the same. This also works when `GIRICI_SESSION_SECRET` fixes the
signing secret, because Girici stores the time of the last sign-out and refuses sessions issued before it.

## Public access

In **Settings**, an admin can turn on **Public access**. While it is on, anyone can browse through the
proxy without signing in. The admin account and the admin section of Settings still require a login.

Public access is off by default. A public instance is open to abuse, so enable it only when you mean to.

Changing the account (name, email, password) or the admin settings asks for your current password every time.
The page keeps it in memory only while it is open. If you forgot it, use the reset tool below.

## Resetting the admin password

If you are locked out, reset the password from the command line. It generates a fresh random password,
sets it, and prints it:

```bash
node ./reset-admin-password.js
```

```
Password reset for admin "halit".

  New password:  iP4dhbzAMXNRnBJFStOtEFcWbtNERb3C

All other sessions have been signed out. Sign in with it on the login page.
```

In Docker, run it inside the container so it uses the same database:

```bash
docker compose exec girici node reset-admin-password.js
```

The tool reads the same data directory as the server (`GIRICI_DATA_DIR`), so point it at the right
database if you overrode that.

## Instance name and logo

In **Settings**, an admin can give the instance its own name and logo. Saving needs the current password, like
every admin change.

- The name has 1 to 40 characters. Control characters and text-direction overrides are refused. Leaving it empty
  goes back to "Girici".
- The logo is a PNG, JPEG, WebP or SVG file of at most 256 KB. Girici checks the type from the file's bytes, not
  from its name. Girici serves it with a sandbox policy, so a script inside an SVG never runs.
- Every visitor sees them, signed in or not: in the header, on the sign-in and setup screens, in the tab title and
  as the favicon. Error pages from the proxy engine keep the Girici name.
- The "Source code · AGPL-3.0" link stays, and the sign-in and setup screens show it too.

The name lives in the database and the logo in `<data dir>/brand/logo`.

## Blocked sites

Under **Settings → Admin → Blocked sites**, list one site per line. Girici refuses those sites and all of
their subdomains on every relay, including WebSockets, and shows visitors a page that says the site is
blocked on this server. You can paste a full URL; Girici keeps only its host name. Sites listed in the
`GIRICI_BLOCKED_HOSTS` environment variable apply too and show under the editor as read-only.

## Encrypted page addresses

Each visitor can turn on **Settings → Encrypt page addresses**. Pages then open at addresses such as
`/~/x/<token>` instead of `/~/https/example.com/...`, so the address bar shows a token instead of the site. It
does not keep sites out of the browser's history. A link to another site, `window.open` and the Navigation API
first load the plain `/~/https/...` address, which the service worker then redirects to the token, and browsers
may keep that first address in their history. Girici's own recent sites list (**Remember history**) also keeps
real addresses. The key lives in that browser only: a copied link does not open in another browser, and it stops
opening if the browser's data for Girici is wiped. Clearing site data in Settings keeps the key.

An admin can turn on **Settings → Admin → Encrypt page addresses for everyone**. It asks for the current password,
like the other admin settings. While it is on, every visitor's switch shows on and cannot be turned off. A browser
that already has Girici open picks the change up on a page load within a minute. Both switches are off by default.

What stays readable, and other limits, are listed under
[Known limitations](./how-it-works.md#known-limitations).

## Scaling later

The schema already carries a username per account, so the single-admin model can grow into multiple
users without a migration.
