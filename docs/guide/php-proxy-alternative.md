---
title: "php-proxy Alternative for Node.js"
description: "How Girici compares with php-proxy: where each web proxy rewrites pages, what it takes to host them, and where php-proxy is the better fit."
---

# A Node.js alternative to php-proxy

[php-proxy](https://github.com/Athlon1600/php-proxy-app) is an open source web proxy script written in PHP,
built on the php-proxy library, which was itself written as an alternative to the older Glype proxy script. Girici does the same job, browsing other sites through a server you host yourself, but it runs on Node.js and
rewrites pages in the browser instead of on the server. This page sets the two side by side so you can pick the one
that suits your server and the sites you need.

## Where the page gets rewritten

php-proxy fetches each page with cURL on the server and rewrites it there with regular expressions: `src` and `href`
attributes, `srcset`, form actions, meta refresh tags and CSS `url()` and `@import`. JavaScript files pass through
unchanged and `<iframe>` tags are stripped. Its README warns that script-heavy pages with many dynamic parts may not
work.

Girici registers a service worker that catches every request a proxied page makes and rewrites HTML, CSS and
JavaScript in your browser. The Node.js server only checks and relays the bytes, including WebSocket traffic. That is
what lets single-page apps, video and realtime sites run through it. See [How it works](/guide/how-it-works) for the
details and [Supported sites](/guide/supported-sites) for what has been tested.

## What it takes to host each one

php-proxy needs PHP 7.4 or 8 with the cURL extension. You install it into your web server's public directory:

```bash
composer create-project athlon1600/php-proxy-app:"^4.0" /var/www/
```

Its README also points to a community Docker image, `dwaaan/php-proxy`.

Girici needs Docker, or Node.js 22.19 or newer if you build it from source:

```bash
docker run -d --name girici -p 3000:3000 -v girici_data:/data halitsever/girici-web-proxy:latest
```

Service workers only run in a secure context, so anything other than `http://localhost` needs HTTPS in front of
Girici. [Reverse proxies](/guide/reverse-proxy) shows how to set that up.

## Side by side

| | php-proxy | Girici |
| --- | --- | --- |
| Language | PHP | TypeScript on Node.js, Vue UI |
| Rewriting | HTML and CSS, on the server | HTML, CSS and JavaScript, in a service worker |
| WebSockets | Not relayed | Relayed |
| Hosting | Any PHP host with cURL | Docker or a long-running Node.js process |
| HTTPS | Optional | Required beyond localhost |
| Access control | No sign-in, IP allow and block lists through a plugin | Admin sign-in by default, public access as an option |
| Configuration | `config.php` and PHP plugins | Environment variables and the admin settings page |
| License | MIT | AGPL-3.0 |

## When php-proxy is the better fit

php-proxy runs on ordinary shared PHP hosting, where you cannot start a Node.js process or a container. It works
without HTTPS and in browsers that do not support service workers. Its plugin folder makes it easy to change how
particular sites are handled, and its MIT license puts fewer conditions on a modified copy than Girici's AGPL-3.0,
which requires you to offer the source of your changes to the people who use your instance.

Girici is the better pick when the sites you need lean on JavaScript, WebSockets or video, and when you want the
proxy private by default. It also blocks requests to private and loopback addresses, keeps a separate cookie jar per
site and leaves visited addresses out of its logs. The [threat model](/guide/threat-model) explains what it protects
and what the operator can still see.

## Moving from php-proxy

There is nothing to migrate. Start Girici next to php-proxy, finish the [first-run setup](/guide/getting-started), and
switch your users over. Links made by php-proxy (`?q=...`) do not carry over, because Girici opens sites at
`/~/https/<host>/<path>`.
