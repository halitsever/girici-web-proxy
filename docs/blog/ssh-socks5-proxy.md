---
title: "SSH SOCKS5 Proxy With ssh -D: socks5 vs socks5h"
titleTemplate: false
description: "Turn any SSH server into a SOCKS5 proxy with ssh -D, test it with curl, see where socks5 and socks5h resolve names, and route a web proxy's traffic through it."
headline: "An SSH SOCKS5 proxy, and why socks5h matters"
date: "2026-11-28"
keyword: "ssh socks5 proxy"
faq: [{"q": "How do I create a SOCKS5 proxy with SSH?", "a": "Run ssh -N -D 127.0.0.1:1080 user@server. OpenSSH then listens on local port 1080 as a SOCKS server and opens each connection from the remote server. The server must allow TCP forwarding."}, {"q": "What is the difference between socks5 and socks5h?", "a": "With socks5 the client resolves the host name itself and sends the proxy an IP address. With socks5h it sends the name and the proxy resolves it. The h decides whose DNS is used and which names can be reached."}, {"q": "Why does ssh -D connect but every request fail?", "a": "Usually the server has AllowTcpForwarding set to no. In a test on Alpine Linux's OpenSSH package, the stock config had it off, and curl failed through the tunnel until it was set to yes."}]
---

# An SSH SOCKS5 proxy, and why socks5h matters

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">Any machine you can SSH into can act as a SOCKS5 proxy with one flag: <code>ssh -D</code>. It is a quick way to send one app's traffic out from another host you control, such as a home server or a second VPS. This post sets one up, tests it with curl, shows the difference between <code>socks5://</code> and <code>socks5h://</code> with a real run, and connects it to a self-hosted web proxy.</p>

## One command

```bash
ssh -N -D 127.0.0.1:1080 user@server.example
```

From the [ssh manual](https://man.openbsd.org/ssh#D): `-D` sets up dynamic application-level port forwarding. ssh listens on the local port, speaks SOCKS4 and SOCKS5 to whatever connects, and opens each requested connection from the remote server. `-N` runs no remote command. Add `-f` to send ssh to the background once it has authenticated.

Bind to `127.0.0.1` as above. Without an address, ssh's default depends on its `GatewayPorts` setting, and a SOCKS port open to your network lets anyone there use your server as an exit.

The server must allow forwarding. In the test for this post, an Alpine Linux 3.20 container with the stock `openssh` package had `AllowTcpForwarding no` in `/etc/ssh/sshd_config`: the SSH login worked, but every request through the SOCKS port failed until the line was changed to `yes`.

## Test it with curl

```bash
curl --proxy socks5h://127.0.0.1:1080 https://example.com/
```

Through the tunnel to that container on 28 November 2026, both `socks5h://` and `socks5://` returned HTTP 200 for `https://example.com/`. TLS still runs end to end between curl and the site; the SSH server only relays bytes ([what a proxy can see](/blog/vpn-vs-proxy)).

## socks5 vs socks5h

The `h` decides who resolves the host name, as curl's docs describe for its [`--proxy` schemes](https://curl.se/docs/manpage.html#-x):

- **`socks5://`**: the client resolves the name with its own DNS and sends the proxy an IP address.
- **`socks5h://`**: the client sends the name, and the proxy resolves it.

To see the difference, the test container's `/etc/hosts` mapped `intranet.home.arpa` to `10.99.0.5`, a name only the SSH server knows. Then:

```text
$ curl -sS -m6 --proxy socks5h://127.0.0.1:1080 http://intranet.home.arpa/
curl: (28) Connection timed out after 6002 milliseconds

$ curl -sS -m6 --proxy socks5://127.0.0.1:1080 http://intranet.home.arpa/
curl: (97) Could not resolve proxy: 127.0.0.1
```

With `socks5h`, the SSH server resolved the private name and tried to connect to `10.99.0.5` (nothing listened there, so it timed out). With `socks5`, curl tried to resolve the name locally, failed, and stopped before the tunnel was used; curl 8.18's message names the proxy, but the name it could not resolve was the target.

So `socks5h` reaches names that only the far side knows, which is what you want when browsing a remote network you own, and it keeps your local resolver out of the picture. It also means a name can resolve differently on the far side than wherever you checked it.

## Using it as Girici's upstream proxy

Girici can send all of its outbound traffic, the page relay, WebSockets and YouTube poToken minting, through one upstream proxy with `GIRICI_UPSTREAM_PROXY`. It accepts `http://`, `https://`, `socks5://` and `socks5h://` URLs, with optional `user:password@` ([configuration](/guide/configuration#upstream-proxy)). The documented use is when sites block your server's own IP. An SSH tunnel to another machine you run is one way to get a second exit.

For a container to use the tunnel, ssh must listen where the container can reach it. With Girici in Docker on the same host, one option is to bind the forward to the Docker bridge address instead of loopback, for example `-D 172.17.0.1:1080`, and set:

```bash
GIRICI_UPSTREAM_PROXY=socks5://172.17.0.1:1080
```

Check that a firewall keeps that port closed to other machines, for the reason given above. The curl runs in this post went through a real tunnel; this Girici setup follows its configuration docs and was not run for the post.

Use `socks5://` here, not `socks5h://`. Girici checks every target with its SSRF guard before opening a tunnel. With `socks5://` it resolves the name itself, verifies the address is public and hands the proxy that address, so nothing can change between check and connect. With `socks5h://` (and with HTTP proxies) the proxy resolves the name, and the configuration page warns that a site could then point it at a private address between the check and the connection. The `intranet.home.arpa` run above is that situation in miniature: the far side happily resolved a private name. It matters whenever the SSH server can reach a private network, which a home server usually can. [DNS rebinding](/blog/dns-rebinding) covers the attack this prevents.

If the tunnel drops, Girici logs `Upstream proxy failed; check GIRICI_UPSTREAM_PROXY`, at most once a minute ([monitoring](/guide/monitoring#lines-worth-an-alert)). Keep ssh alive with `-o ServerAliveInterval=30`, and run it under systemd or a supervisor so it restarts.

## When to use something else

- **A permanent egress for a server:** a real SOCKS or HTTP proxy service, or a VPN on the host, is easier to monitor than an interactive ssh process.
- **Many users or devices:** see [VPN vs proxy](/blog/vpn-vs-proxy) for what each covers.
- **Web access from any browser with no client setup:** that is what a web proxy is for; the [deploy page](/deploy/) runs Girici with Docker.

## FAQ

### How do I create a SOCKS5 proxy with SSH?

Run ssh -N -D 127.0.0.1:1080 user@server. OpenSSH then listens on local port 1080 as a SOCKS server and opens each connection from the remote server. The server must allow TCP forwarding.

### What is the difference between socks5 and socks5h?

With socks5 the client resolves the host name itself and sends the proxy an IP address. With socks5h it sends the name and the proxy resolves it. The h decides whose DNS is used and which names can be reached.

### Why does ssh -D connect but every request fail?

Usually the server has AllowTcpForwarding set to no. In a test on Alpine Linux's OpenSSH package, the stock config had it off, and curl failed through the tunnel until it was set to yes.

## Related posts

- [DNS rebinding: why checking a name once is not enough](/blog/dns-rebinding)
- [VPN or proxy: which traffic each covers, and who can still see it](/blog/vpn-vs-proxy)
- [Server-side request forgery in a web proxy: what to block and where](/blog/ssrf-web-proxy)
- [All posts](/blog/)
