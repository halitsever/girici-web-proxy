# AGENTS.md

Girici is a self-hosted web proxy (Node.js server, service worker engine, Vue UI) that operators run from the Docker image.

## Verify a change

- Use Node from `.nvmrc` (24). CI also runs `npm test` on Node 22, the minimum in `engines`.
- Run what the CI `check` job runs, in this order: `npm ci`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- `npm test` builds the engine library first, and `npm run test:e2e` builds the engine and web packages first. Install browsers once with `npx playwright install --with-deps chromium firefox webkit`.
- CI also builds the Docker image and smoke-tests `/healthz`, `/` and `/_g/sw.js` on port 3000.
- For docs, build with the Pages base path: `DOCS_BASE=/girici-web-proxy/ npm run docs:build`. Without it the base is `/`.

## Gotchas

- Every push to `main` runs semantic-release. A `feat:` or `fix:` commit cuts a release, pushes multi-arch images to Docker Hub and GHCR, and signs them with cosign. Pick the commit type with that in mind.
- Release versions come from git tags. `version` in the package.json files stays `2.0.0-dev`.
- Keep the Dockerfile's final `runtime` stage free of `RUN` steps. Releases build arm64 without QEMU emulation, and CI checks this with an arm64 build.
- Prettier skips `*.md`, `package-lock.json` and `LICENSE`. ESLint skips `docs/**` and `packages/web/src/components/ui/**`.
- Adapted third-party code keeps its source and license header and gets an entry in `THIRD_PARTY_NOTICES.md`.
- Keep the security defaults on: the SSRF guard, the CSRF and origin checks, and logs that leave out target URLs, cookies and tokens.

## Docs and site

- VitePress site in `docs/`, deployed to https://projects.halit.org/girici-web-proxy/ by `.github/workflows/docs.yml` on pushes to `main` that touch `docs/**`. Pull requests only build it.
- `llms.txt`, `llms-full.txt` and per-page `.md` copies are generated at build time from the sidebar in `docs/.vitepress/config.ts`. Add a new page to the sidebar and give it a `description` in its front matter.
- `docs/public/` holds static files served at the site root, including `og.png` and `robots.txt`.

## Conventions

- Commit subjects use Conventional Commits, in English, with no body and no trailer.
- Work on a branch and open a pull request. The owner merges.
- New text has no emoji. Code comments are short, one line where possible, and explain why.
- New behavior and bug fixes come with a test that fails before the change.
- README follows the owner's template. Images served from `halitsever-api.vercel.app` stay byte-for-byte; only the `title=` value of `api/repo-title` and the link around `api/issue` may be corrected.
- Leave version numbers alone: semantic-release sets them on `main`, and the owner decides when to merge.
- Licensed AGPL-3.0-only.
