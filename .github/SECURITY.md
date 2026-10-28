# Security Policy

Girici is a web proxy, so its security posture matters to everyone who runs it. Thank you for helping
keep it safe.

## Supported versions

Girici v2 is under active development on the `main` branch; security fixes land there. Girici v1 is no
longer maintained and will not receive fixes. Run a current v2 build.

| Version | Supported |
|---------|-----------|
| v2 (`main`) | Yes |
| v1 | No |

## Reporting a vulnerability

Please report security issues privately, not in a public issue or pull request.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. Include the affected version or commit, steps to reproduce, and the impact
you observed. If you have a proposed fix, a draft PR against a private advisory is welcome.

We aim to acknowledge a report within a few days and to coordinate a fix and disclosure timeline with
you. Please give us a reasonable window to release a fix before any public disclosure.

## Scope and known limitations

Some properties are design trade-offs, documented so reports can focus on real issues:

- **Single origin.** Every proxied site shares one browser origin, so a malicious proxied page can
  reach another site's cookies and storage. `HttpOnly` is not a security boundary here. Site isolation
  is a known limitation, mitigated by in-app warnings and per-site data clearing.
- **The operator sees traffic.** The HTTP relay terminates TLS at the server, so the operator can see
  proxied traffic. End-to-end transport is future work.
- **Open public access is opt-in.** With public access enabled the proxy is reachable without signing
  in, which invites abuse. The default is private, behind an admin login.

Reports that demonstrate a bypass of the SSRF guard, the CSRF checks, the auth gate, or the service
worker's isolation are especially valuable.
