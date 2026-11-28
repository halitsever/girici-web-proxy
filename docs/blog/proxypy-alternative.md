---
title: "proxy.py vs a Web Proxy: Which One Do You Need?"
titleTemplate: false
description: "proxy.py is a Python proxy server framework you set in the browser; Girici is a web proxy you open as a site. What each does, how to run it and when to pick it."
headline: "proxy.py vs a web proxy: which one do you need?"
date: "2026-11-28"
keyword: "proxypy web proxy"
faq: [{"q": "Is proxy.py a web proxy?", "a": "No. proxy.py is a forward proxy server and framework in Python that you configure as a proxy in a browser or tool. A web proxy is a website you browse through without changing any settings."}, {"q": "What port does proxy.py use?", "a": "8899 by default, listening on 127.0.0.1. Use --hostname 0.0.0.0 to accept connections from other machines."}]
---

# proxy.py vs a web proxy: which one do you need?

<p class="post-meta">By <a href="https://halit.org">Halit Sever</a> · <time datetime="2026-11-28">28 November 2026</time></p>

<p class="lead">People searching for a "proxypy web proxy" mostly land on proxy.py, a Python project by Abhinav Singh. It is a proxy server, not a web proxy: you point a browser or tool at it. If what you want is a page you open in any browser and browse through, that is a different tool.</p>

## What proxy.py is

From its [README on GitHub](https://github.com/abhinavsingh/proxy.py) (BSD-3-Clause, latest release v2.4.10 in February 2025):

- A lightweight forward HTTP(S) proxy server written in Python, with no dependencies outside the standard library.
- Also a framework: plugins add a web server, a reverse proxy, TLS interception, a proxy pool and more.
- Installed with `pip install --upgrade proxy.py`, which puts a `proxy` command on your path, or run as a container:

```bash
docker run -it -p 8899:8899 --rm abhinavsingh/proxy.py:latest
```

By default it listens on `127.0.0.1:8899` (`--hostname 0.0.0.0` to accept other machines, `--port` to change it, `--basic-auth` to require a password). Its README tests it with:

```bash
curl -v -x localhost:8899 http://google.com
```

You then set `localhost:8899` as the HTTP and HTTPS proxy in your browser or system, and everything that client sends goes through it. For HTTPS, proxy.py sees the host name of each connection; it sees the content only if you enable its TLS interception and trust its certificate.

## What a web proxy is

A web proxy such as Girici is a website. You open it, type an address, and the site loads inside the proxy's page. No browser settings, nothing installed on the device. To make that work it fetches every site on the server and rewrites it for the browser, which also means the server sees all content. [Proxy server vs web proxy](/blog/proxy-server-browser) explains the difference in more depth.

## Side by side

| | proxy.py | Girici |
| --- | --- | --- |
| Kind | Forward proxy server (and framework) | Web proxy, opened as a website |
| Client setup | Proxy address in browser, system or tool | None; any browser |
| Covers | Everything the client sends | Pages opened through it |
| HTTPS content visible to the server | Only with TLS interception | Yes |
| Language | Python | TypeScript (Node.js server, service worker engine, Vue UI) |
| Default port | 8899 | 3000 |
| Accounts | Optional basic auth | Admin account, public access off by default |
| Typical use | Development, scraping, testing, custom proxy logic | Browsing through your server from any browser |
| License | BSD-3-Clause | AGPL-3.0 |

## Which one to run

- **You control the client** (a script, a test runner, your own browser) and want to inspect or change traffic in Python: proxy.py.
- **You want to browse from any device without configuring it,** or give others a link they can open: a web proxy.

You can also combine them. Girici's `GIRICI_UPSTREAM_PROXY` accepts an `http://` proxy URL, so a proxy server like proxy.py could sit between Girici and the internet, for logging or routing outgoing traffic.

## Running Girici

```bash
docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest
docker logs girici 2>&1 | grep "setup code"
```

Then open `http://localhost:3000` and create the admin account. [Create a web proxy server with Docker](/blog/create-web-proxy-server-docker) continues with HTTPS, updates and backups, and the [deploy page](/deploy/) lists every way to run it.

## FAQ

### Is proxy.py a web proxy?

No. proxy.py is a forward proxy server and framework in Python that you configure as a proxy in a browser or tool. A web proxy is a website you browse through without changing any settings.

### What port does proxy.py use?

8899 by default, listening on 127.0.0.1. Use --hostname 0.0.0.0 to accept connections from other machines.

## Related posts

- [Proxy server vs a proxy in the browser: how web proxies work](/blog/proxy-server-browser)
- [Free online web proxies vs hosting your own](/blog/free-online-web-proxy-vs-self-hosted)
- [How to create your own web proxy server with Docker](/blog/create-web-proxy-server-docker)
- [All posts](/blog/)
