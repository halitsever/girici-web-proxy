# Admin and auth

Girici stores a single admin account and its settings in a small SQLite database
(`<data dir>/girici.db`). The database is created on first run.

## Setup

The first time you open Girici with no admin yet, every route sends you to the setup screen. You create
one admin (username, name, email, password, at least 8 characters). After setup you are signed in.

## Login

Once an admin exists, the proxy requires a login. Visiting a proxied page while signed out redirects you
to the login screen, and signing in sends you back where you were headed.

The session is a stateless cookie (`__Host-girici`), signed with a secret stored in the database. There
is no server-side session table; signing out clears the cookie, and changing the password rotates the
secret so every other device is signed out.

## Public access

In **Settings**, an admin can turn on **Public access**. While it is on, anyone can browse through the
proxy without signing in. The admin account and the admin section of Settings still require a login.

Public access is off by default. A public instance is open to abuse, so enable it only when you mean to.

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

## Scaling later

The schema already carries a username per account, so the single-admin model can grow into multiple
users without a migration.
