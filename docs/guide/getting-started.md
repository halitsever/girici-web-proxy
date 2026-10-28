# Getting started

Girici is a self-hosted web proxy. You run it on a machine you control, open its web UI, and browse
other sites through it. This page gets a local instance running and walks through first-run setup.

## Prerequisites

- Node.js 22.19 or newer (24 LTS recommended), or Docker.
- A modern browser. Service workers need a secure context, which `http://localhost` already counts as,
  so no HTTPS is required for local use.

## Run from source

```bash
git clone https://github.com/halitsever/girici-web-proxy.git
cd girici-web-proxy
npm ci
npm run build
npm start
```

Girici listens on `http://localhost:3000`.

For development with watch-rebuild instead:

```bash
npm run dev
```

## First run: create the admin

The first time you open Girici, it sends you to a setup screen. Create the single admin account
(username, name, email, password). After setup you are signed in and land on the browse screen.

Once an admin exists, Girici requires a login. If you want the proxy to be open to anyone, turn on
**Public access** in Settings; see [Admin and auth](/guide/admin-and-auth) for what that changes and
how to reset a forgotten password.

## Use it

Type a URL or a search term into the box and press Enter. URLs open through the proxy; anything that is
not a URL is searched with your chosen engine. Everything after that, including links, forms, and
media, stays inside Girici.

## Next steps

- [How it works](/guide/how-it-works) for the architecture.
- [Configuration](/guide/configuration) for environment variables.
- [Running with Docker](/guide/docker) for deployment.
