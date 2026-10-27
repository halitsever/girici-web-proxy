import type { IncomingMessage, ServerResponse } from "node:http";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function page(title: string, body: string, head = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const SITE_A_HOME = page(
  "Site A",
  `<h1 id="title">Site A</h1>
<img id="relative" src="img/a.png" alt="">
<img id="root" src="/img/a.png" alt="">
<img id="absolute" src="https://cdn.site-a.test/b.png" alt="">
<img id="protocol-relative" src="//cdn.site-a.test/b.png" alt="">
<a id="page2" href="/page2">Page 2</a>
<a id="site-b" href="https://site-b.test/">Site B</a>
<a id="to-runtime" href="/runtime?x=1#h">Runtime</a>`,
  '<link rel="stylesheet" href="/style.css">',
);

const NAV = page(
  "Nav",
  `<a id="abs" href="https://site-b.test/">Site B</a>
<a id="proto" href="//www.site-a.test/landing">Landing</a>
<button id="assign" onclick="location.assign('https://site-b.test/')">assign</button>
<button id="href" onclick="location.href='https://site-b.test/'">href</button>
<button id="replace" onclick="location.replace('https://site-b.test/')">replace</button>
<button id="open" onclick="window.open('https://site-b.test/')">open</button>
<button id="submit" onclick="document.getElementById('post').submit()">submit</button>
<button id="push" onclick="history.pushState({}, '', '/pushed?x=1')">push</button>
<form id="get" action="https://site-b.test/search"><input name="q" value="hello"><button id="get-go">Go</button></form>
<form id="post" method="post" action="https://site-a.test/echo"><input name="q" value="posted"><button id="post-go">Go</button></form>
<form method="post" action="/redirect-307"><input name="q" value="kept"><button id="post-307-go">Go</button></form>
<form method="post" action="/redirect-303"><input name="q" value="dropped"><button id="post-303-go">Go</button></form>
<iframe id="frame" src="https://site-b.test/frame"></iframe>`,
);

const RUNTIME = page(
  "Runtime",
  `<a id="link" href="https://site-b.test/x?y=1">b</a><pre id="results"></pre>
<script>
  const link = document.getElementById("link");
  const results = {
    href: location.href,
    origin: location.origin,
    host: location.host,
    pathname: location.pathname,
    windowOrigin: window.origin,
    url: document.URL,
    documentURI: document.documentURI,
    baseURI: document.baseURI,
    domain: document.domain,
    referrer: document.referrer,
    linkHref: link.href,
    linkAttr: link.getAttribute("href"),
    linkHost: link.hostname,
    isLocation: location instanceof Location,
    sameObject: window.location === document.location,
    serviceWorker: typeof navigator.serviceWorker.register === "function" ? "masked" : "missing",
    controller: navigator.serviceWorker.controller,
  };
  history.pushState({}, "", "/runtime/pushed?z=2");
  results.pushed = location.href;
  link.href = "https://site-c.test/";
  results.linkAfterSet = link.getAttribute("href");
  document.getElementById("results").textContent = JSON.stringify(results);
</script>`,
);

const FRAME = page(
  "Frame",
  `<h1>Frame</h1><pre id="frame-results"></pre>
<script>
  document.getElementById("frame-results").textContent = JSON.stringify({ href: location.href, parent: parent.location.href });
</script>`,
);

const STORAGE = page(
  "Storage",
  `<p id="value"></p><p id="session"></p>
<script>
  const set = new URLSearchParams(location.search).get("set");
  if (set) {
    localStorage.setItem("k", set);
    sessionStorage.setItem("k", set);
  }
  document.getElementById("value").textContent = localStorage.getItem("k") ?? "";
  document.getElementById("session").textContent = sessionStorage.getItem("k") ?? "";
</script>`,
);

const NETWORK = page(
  "Network",
  `<pre id="results"></pre>
<script>
  (async () => {
    const r = {};
    const cross = await fetch("https://site-b.test/api");
    r.fetchUrl = cross.url;
    r.fetchBody = await cross.json();
    const root = await fetch("/api");
    r.rootUrl = root.url;
    r.rootRedirected = root.redirected;
    r.requestUrl = new Request("/api").url;
    r.xhrUrl = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://site-b.test/api");
      xhr.onload = () => resolve(xhr.responseURL);
      xhr.send();
    });
    r.events = await new Promise((resolve) => {
      const got = [];
      const source = new EventSource("/sse");
      r.eventSourceUrl = source.url;
      source.onmessage = (event) => {
        got.push(event.data);
        if (got.length === 2) {
          source.close();
          resolve(got);
        }
      };
    });
    document.getElementById("results").textContent = JSON.stringify(r);
  })();
</script>`,
);

type Route = (req: IncomingMessage, res: ServerResponse, body: string) => void;

const cookieEcho: Route = (req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(req.headers.cookie ?? "");
};
const cookieApi: Route = (_req, res) => {
  res.writeHead(200, { "content-type": "text/plain", "set-cookie": "api=1; Path=/" });
  res.end("ok");
};
const COOKIE_SCRIPT = page(
  "Cookie script",
  `<pre id="echo"></pre>
<script>
  document.cookie = "js=1; path=/";
  fetch("/cookie/echo")
    .then((r) => r.text())
    .then((t) => {
      document.getElementById("echo").textContent = t;
    });
</script>`,
);
const COOKIE_API_PAGE = page(
  "Cookie API",
  `<pre id="after"></pre>
<script>
  fetch("/cookie/set-api").then(() => {
    document.getElementById("after").textContent = document.cookie;
  });
</script>`,
);

const api: Route = (req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ method: req.method, origin: req.headers.origin ?? null }));
};
const sse: Route = (_req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.end("data: one\n\ndata: two\n\n");
};

const whoami: Route = (req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    page(
      "Who am I",
      `<p id="server">${escapeHtml(req.headers.cookie ?? "")}</p><p id="client"></p>
<script>document.getElementById("client").textContent = document.cookie;</script>`,
    ),
  );
};
const login: Route = (_req, res) => {
  res.writeHead(302, {
    location: "/cookie/whoami",
    "set-cookie": ["sid=abc; HttpOnly; Path=/", "theme=dark; Domain=site-a.test; Path=/"],
  });
  res.end();
};

const html =
  (body: string): Route =>
  (_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  };
const png: Route = (_req, res) => {
  res.writeHead(200, { "content-type": "image/png" });
  res.end(PNG);
};
const css =
  (body: string): Route =>
  (_req, res) => {
    res.writeHead(200, { "content-type": "text/css" });
    res.end(body);
  };
const redirect =
  (status: number, location: string): Route =>
  (_req, res) => {
    res.writeHead(status, { location });
    res.end();
  };
const echo: Route = (req, res, body) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page("Echo", `<pre id="echo">${escapeHtml(`${req.method ?? ""}${body ? ` ${body}` : ""}`)}</pre>`));
};
const search: Route = (req, res) => {
  const query = new URL(req.url ?? "/", "http://fixture").searchParams.get("q") ?? "";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page("Search", `<h1 id="query">${escapeHtml(query)}</h1>`));
};

const ROUTES: Record<string, Record<string, Route>> = {
  "site-a.test": {
    "/": html(SITE_A_HOME),
    "/style.css": css("#title { color: rgb(1, 2, 3); }"),
    "/img/a.png": png,
    "/page2": html(page("Page 2", "<h1>Page 2</h1>")),
    "/redirect-301": redirect(301, "/target"),
    "/redirect-303": redirect(303, "/echo"),
    "/redirect-307": redirect(307, "/echo"),
    "/target": html(page("Target", "<h1>Target</h1>")),
    "/redirect-cross": redirect(302, "https://www.site-a.test/landing"),
    "/nav": html(NAV),
    "/echo": echo,
    "/meta-refresh": html(page("Meta", "", '<meta http-equiv="refresh" content="0; url=https://site-b.test/">')),
    "/refresh-header": (_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", refresh: "0; url=https://site-b.test/" });
      res.end(page("Refresh", "<p>wait</p>"));
    },
    "/base": html(page("Base", '<img id="based" src="b.png" alt="">', '<base href="https://cdn.site-a.test/">')),
    "/media": html(
      page(
        "Media",
        `<img id="srcset" srcset="https://cdn.site-a.test/b.png 1x" alt="">
<div id="inline" style="background-image:url(https://cdn.site-a.test/b.png)">x</div>
<div id="external">x</div>`,
        '<link rel="stylesheet" href="https://cdn.site-a.test/style.css">',
      ),
    ),
    "/runtime": html(RUNTIME),
    "/cookie/login": login,
    "/cookie/whoami": whoami,
    "/storage": html(STORAGE),
    "/api": api,
    "/sse": sse,
    "/cookie/echo": cookieEcho,
    "/cookie/script": html(COOKIE_SCRIPT),
    "/cookie/set-api": cookieApi,
    "/cookie/api-page": html(COOKIE_API_PAGE),
    "/network": html(NETWORK),
  },
  "www.site-a.test": { "/landing": html(page("Landing", "<h1>Landing</h1>")), "/cookie/whoami": whoami },
  "cdn.site-a.test": { "/b.png": png, "/style.css": css("#external { background-image: url(/b.png); }") },
  "site-b.test": {
    "/": html(page("Site B", "<h1>Site B</h1>")),
    "/search": search,
    "/frame": html(FRAME),
    "/cookie/whoami": whoami,
    "/storage": html(STORAGE),
    "/api": api,
  },
  "site-c.test": { "/": html(page("Site C", "<h1>Site C</h1>")) },
};

export function handleFixture(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const host = (req.headers.host ?? "").split(":")[0] ?? "";
    const path = new URL(req.url ?? "/", "http://fixture").pathname;
    const route = ROUTES[host]?.[path];
    if (route) {
      route(req, res, Buffer.concat(chunks).toString());
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
}
