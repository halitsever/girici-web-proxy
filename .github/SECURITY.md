# Security Policy

Girici is a web proxy that many people run in public, so its security matters to everyone who uses it. Thank you
for helping keep it safe.

## Supported versions

Security fixes go into the latest v2 release, published as a new version on GitHub and as the `latest`, `v2` and
version tags on Docker Hub and GHCR. Older releases do not get backports; update to the latest one. Girici v1 is no
longer maintained.

| Version | Supported |
|---------|-----------|
| Latest 2.x release | Yes |
| Older 2.x releases | No, update |
| v1 | No |

## Reporting a vulnerability

Report security issues privately, never in a public issue, discussion or pull request.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**, or go straight to
<https://github.com/halitsever/girici-web-proxy/security/advisories/new>. Include the version or commit, the steps to
reproduce, and the impact you saw. A proposed fix is welcome as a draft in the private advisory.

You should hear back within a few days. We will agree on a fix and a disclosure date with you, and credit you in the
advisory unless you prefer otherwise. Please give us a reasonable window to ship a fix before you disclose.

## Scope

The [threat model](https://halitsever.github.io/girici-web-proxy/guide/threat-model) lists what Girici protects and
the limits it already documents, so reports can focus on real issues. In short:

- **Single origin.** Every proxied site shares Girici's origin, and the separation between sites is rebuilt in
  JavaScript. The documented gaps (computed window and `location` access, rewriters in the page realm, the shared
  origin private file system and blob URLs) are known. A new way around the separation is still worth a report.
- **The operator sees traffic.** TLS to the real site ends at the server. This is by design.
- **Public access is opt-in.** An instance with public access on is open to anyone by choice.

Bypasses of the SSRF guard, the sign-in and setup gate, the CSRF and origin checks, or the separation between sites
are the most valuable reports.

## Verifying release images

Release images are signed with Sigstore cosign, without a long-lived key. Images released before signing was added
are not. To check one:

```bash
cosign verify halitsever/girici-web-proxy:latest \
  --certificate-identity https://github.com/halitsever/girici-web-proxy/.github/workflows/ci.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The same works for `ghcr.io/halitsever/girici-web-proxy`. Each image also carries a build provenance attestation
and an SBOM.
