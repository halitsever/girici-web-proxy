import type { IncomingMessage, ServerResponse } from "node:http";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function page(title: string, body: string, head = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
}

const SITE_A_HOME = page(
  "Site A",
  `<h1 id="title">Site A</h1>
<img id="relative" src="img/a.png" alt="">
<img id="root" src="/img/a.png" alt="">
<img id="absolute" src="https://cdn.site-a.test/b.png" alt="">
<img id="protocol-relative" src="//cdn.site-a.test/b.png" alt="">
<a id="page2" href="/page2">Page 2</a>
<a id="site-b" href="https://site-b.test/">Site B</a>`,
  '<link rel="stylesheet" href="/style.css">',
);

type Route = (res: ServerResponse) => void;

const html =
  (body: string): Route =>
  (res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  };
const png: Route = (res) => {
  res.writeHead(200, { "content-type": "image/png" });
  res.end(PNG);
};
const redirect =
  (status: number, location: string): Route =>
  (res) => {
    res.writeHead(status, { location });
    res.end();
  };

const ROUTES: Record<string, Record<string, Route>> = {
  "site-a.test": {
    "/": html(SITE_A_HOME),
    "/style.css": (res) => {
      res.writeHead(200, { "content-type": "text/css" });
      res.end("#title { color: rgb(1, 2, 3); }");
    },
    "/img/a.png": png,
    "/page2": html(page("Page 2", "<h1>Page 2</h1>")),
    "/redirect-301": redirect(301, "/target"),
    "/target": html(page("Target", "<h1>Target</h1>")),
    "/redirect-cross": redirect(302, "https://www.site-a.test/landing"),
  },
  "www.site-a.test": { "/landing": html(page("Landing", "<h1>Landing</h1>")) },
  "cdn.site-a.test": { "/b.png": png },
  "site-b.test": { "/": html(page("Site B", "<h1>Site B</h1>")) },
  "site-c.test": { "/": html(page("Site C", "<h1>Site C</h1>")) },
};

export function handleFixture(req: IncomingMessage, res: ServerResponse): void {
  const host = (req.headers.host ?? "").split(":")[0] ?? "";
  const path = new URL(req.url ?? "/", "http://fixture").pathname;
  const route = ROUTES[host]?.[path];
  if (route) {
    route(res);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}
