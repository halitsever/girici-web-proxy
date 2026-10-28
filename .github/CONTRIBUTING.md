# Contributing to Girici

Thanks for helping build Girici. This guide covers how to set up the project, the conventions the
codebase follows, and how to get a change merged.

Girici v2 is written in TypeScript (Node 24 / Express 5 server, a service-worker engine, and a Vue 3
UI) and is licensed under AGPL-3.0-only. By contributing you agree your work is licensed the same way.

## Getting set up

Requires Node.js 22.19 or newer (24 LTS recommended).

```bash
npm ci            # install the workspace
npm run build     # build engine, server, and web
npm run dev       # watch-rebuild and serve on http://localhost:3000
```

The repository is an npm workspace with three packages:

- `packages/engine` — the service-worker proxy engine (codec, rewriters, SW runtime, client shims).
- `packages/server` — the Express relay, SSRF guard, auth, and static hosting.
- `packages/web` — the Vue 3 UI.

## Before you open a pull request

Run the full check suite; CI runs the same commands and must pass.

```bash
npm run lint         # eslint, zero warnings allowed
npm run typecheck    # tsc / vue-tsc across every package
npm test             # vitest unit and integration tests
npm run build        # production build of all packages
```

End-to-end tests live under `e2e/` and run with `npm run test:e2e` (Playwright).

## Conventions

- **Tests first.** New behavior and bug fixes come with a test that fails before the change and passes
  after it. Server routes are tested against a real HTTP server; the engine is tested with Vitest.
- **Commits** use Conventional Commits and are a subject line only: `feat: …`, `fix: …`, `test: …`,
  `docs: …`. No body, no trailing metadata.
- **Comments** explain why, not what. Keep them short and in English.
- **Security defaults stay on.** Do not log target URLs, cookies, or tokens at the default log level,
  and do not weaken the SSRF guard or the CSRF checks without discussing it first.
- **Adapted code** keeps its source project, file, and license header, and is listed in
  `THIRD_PARTY_NOTICES.md`.

## Reporting bugs and proposing features

Open an issue with the matching template. For anything security-sensitive, follow
[SECURITY.md](SECURITY.md) instead of filing a public issue.
