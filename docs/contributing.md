# Contributing

Contributions are welcome. Girici v2 is written in TypeScript across three npm workspace packages, and
is licensed under AGPL-3.0-only; by contributing you agree your work is licensed the same way.

## Packages

- `packages/engine` — the service-worker proxy engine (codec, rewriters, SW runtime, client shims).
- `packages/server` — the Express relay, SSRF guard, auth, and static hosting.
- `packages/web` — the Vue 3 UI.

## Setup

```bash
npm ci            # install the workspace
npm run build     # build engine, server, and web
npm run dev       # watch-rebuild and serve on http://localhost:3000
```

## Before a pull request

Run the same checks CI runs; all must pass.

```bash
npm run lint         # eslint, zero warnings allowed
npm run typecheck    # tsc / vue-tsc across every package
npm test             # vitest unit and integration tests
npm run build        # production build
```

## Conventions

- **Tests first.** New behavior and bug fixes ship with a test that fails before the change and passes
  after it.
- **Commits** use Conventional Commits and are a subject line only (`feat: …`, `fix: …`, `docs: …`).
- **Comments** explain why, not what, and stay short and in English.
- **Security defaults stay on.** Do not weaken the SSRF guard or the CSRF checks, and do not log target
  URLs, cookies, or tokens at the default level.
- **Adapted code** keeps its source and license header and is listed in `THIRD_PARTY_NOTICES.md`.

## Reporting issues

Use the issue templates on GitHub. For anything security-sensitive, follow the
[security policy](https://github.com/halitsever/girici-web-proxy/security/policy) and report privately
instead of opening a public issue.

The full contributor guide lives in
[`.github/CONTRIBUTING.md`](https://github.com/halitsever/girici-web-proxy/blob/main/.github/CONTRIBUTING.md).
