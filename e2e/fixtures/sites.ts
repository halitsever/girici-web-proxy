import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { abortableRoutes, rangeRoute, slowStreamRoute } from "./media.ts";

const abortable = abortableRoutes();

const sampleWebm = readFileSync(new URL("./sample.webm", import.meta.url));
const sampleMp4 = readFileSync(new URL("./sample.mp4", import.meta.url));

const VIDEO_PAGE = page(
  "Video",
  `<video id="v" preload="auto">
  <source src="/sample.webm" type="video/webm">
  <source src="/sample.mp4" type="video/mp4">
</video>`,
);

const MSE = page(
  "MSE",
  `<p id="result"></p>
<script>
  const ms = new MediaSource();
  const v = document.createElement("video");
  document.body.appendChild(v);
  v.src = URL.createObjectURL(ms);
  document.getElementById("result").textContent = v.src;
  fetch("/sample.webm").catch(function () {});
</script>`,
);

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
<button id="blank-frame" onclick="const f = document.createElement('iframe'); f.id = 'blank'; document.body.append(f); f.contentWindow.location.href = 'https://site-b.test/';">blank frame</button>
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

const WORKER = page(
  "Worker",
  `<pre id="answer"></pre>
<script>
  const worker = new Worker("worker.js");
  worker.onmessage = (event) => {
    document.getElementById("answer").textContent = String(event.data);
  };
  worker.onerror = () => {
    document.getElementById("answer").textContent = "error";
  };
</script>`,
);

const REALTIME = page(
  "Realtime",
  `<pre id="results"></pre>
<script>
  const results = { rtc: typeof RTCPeerConnection, transport: typeof WebTransport };
  const socket = new WebSocket("wss://site-b.test/socket");
  socket.onerror = () => {
    results.error = true;
  };
  socket.onclose = (event) => {
    results.closed = event.code;
    results.state = socket.readyState;
    document.getElementById("results").textContent = JSON.stringify(results);
  };
</script>`,
);

type Route = (req: IncomingMessage, res: ServerResponse, body: string) => void;

const script =
  (body: string): Route =>
  (_req, res) => {
    res.writeHead(200, { "content-type": "application/javascript" });
    res.end(body);
  };

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

const OLD_CHANNEL = page(
  "Old channel",
  `<p id="heard">waiting</p><button id="judge">judge</button>
<script>
  const Channel = Object.getPrototypeOf(new BroadcastChannel("x")).constructor;
  const old = new Channel("__girici");
  const heard = document.getElementById("heard");
  old.onmessage = () => { heard.textContent = "yes"; };
  document.getElementById("judge").onclick = () => {
    setTimeout(() => { if (heard.textContent !== "yes") heard.textContent = "no"; }, 2000);
  };
</script>`,
);

/** Source of `girProbe(scope)`, which reports whether a realm reaches Girici's own storage or another site's channel. */
export const PROBE = `async function girProbe(scope) {
  const jar = await new Promise((resolve) => {
    const request = scope.indexedDB.open("__girici");
    // Aborting the upgrade stops the probe from creating a database it did not find.
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => {
      const found = request.result.objectStoreNames.contains("cookies");
      request.result.close();
      resolve(found);
    };
    request.onerror = (event) => {
      event.preventDefault();
      resolve(false);
    };
  });
  const engineCaches = (await scope.caches.keys()).some((name) => name.startsWith("girici:"));
  const heard = await new Promise((resolve) => {
    const channel = new scope.BroadcastChannel("__g|https://site-b.test|probe");
    const timer = setTimeout(() => {
      channel.close();
      resolve(false);
    }, 1500);
    channel.onmessage = () => {
      clearTimeout(timer);
      channel.close();
      resolve(true);
    };
  });
  return { jar, engineCaches, heard };
}`;

const PROBE_WORKER = `${PROBE}\ngirProbe(self).then((result) => postMessage(result));`;

const DOORS_WORKERS = page(
  "Doors workers",
  `<button id="start">start</button><pre id="results"></pre>
<script>
  const probeUrl = () => URL.createObjectURL(new Blob([${JSON.stringify(PROBE_WORKER)}], { type: "text/javascript" }));
  const answer = (worker) =>
    new Promise((resolve) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = () => resolve("error");
    });
  const listen = (channel) =>
    new Promise((resolve) => {
      channel.onmessage = () => resolve(true);
      setTimeout(() => resolve(false), 1500);
    });
  document.getElementById("start").onclick = async () => {
    const worker = new Worker(probeUrl());
    const LeakedWorker = Object.getPrototypeOf(worker).constructor;
    const LeakedChannel = Object.getPrototypeOf(new BroadcastChannel("x")).constructor;
    const [own, nested, leakedWorker, leakedChannel] = await Promise.all([
      answer(worker),
      answer(new Worker("/nest.js")),
      answer(new LeakedWorker(probeUrl())),
      listen(new LeakedChannel("__g|https://site-b.test|probe")),
    ]);
    document.getElementById("results").textContent = JSON.stringify({ worker: own, nested, leakedWorker, leakedChannel });
  };
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

const SINKS = page(
  "Sinks",
  `<div id="host"></div><pre id="results"></pre>
<script>
  const host = document.getElementById("host");
  host.innerHTML = '<a id="inner" href="https://site-b.test/x">b</a>';
  host.insertAdjacentHTML("beforeend", '<img id="iadj" src="https://cdn.site-a.test/b.png">');
  const frag = document.createRange().createContextualFragment('<a id="frag" href="https://site-b.test/y">y</a>');
  host.append(frag);
  const parsed = new DOMParser().parseFromString('<a id="dom" href="https://site-b.test/z">z</a>', "text/html");
  const results = {
    innerAttr: host.querySelector("#inner").getAttribute("href"),
    innerProp: host.querySelector("#inner").href,
    innerReadBack: host.innerHTML.includes("https://site-b.test/x"),
    iadjAttr: host.querySelector("#iadj").getAttribute("src"),
    fragAttr: host.querySelector("#frag").getAttribute("href"),
    domAttr: parsed.getElementById("dom").getAttribute("href"),
  };
  document.getElementById("results").textContent = JSON.stringify(results);
</script>`,
);

const SINKS_WRITE = page(
  "Sinks write",
  `<script>
  document.write('<p id="written"></p><scr' + 'ipt>document.getElementById("written").textContent=location.href<\\/scr' + 'ipt>');
</script>`,
);

const EXEC = page(
  "Exec",
  `<pre id="results"></pre>
<script>
  const out = {};
  out.fn = (new Function("return location.href"))();
  out.ctor = (function () {}).constructor("return location.href")();
  out.timer = "pending";
  setTimeout("window.__t = location.href", 0);
  const dyn = new Function("return (new Function('return location.host'))()")();
  out.nested = dyn;
  out.toString = /\\[native code\\]/.test(Function.prototype.toString.call(setTimeout));
  out.evalDirect = eval("location.href");
  setTimeout(() => {
    out.timer = window.__t;
    document.getElementById("results").textContent = JSON.stringify(out);
  }, 50);
</script>`,
);

const WORKER2 = page(
  "Worker2",
  `<pre id="results"></pre>
<script>
  const out = {};
  let pending = 3;
  const done = (key, value) => {
    out[key] = value;
    if (--pending === 0) document.getElementById("results").textContent = JSON.stringify(out);
  };
  const classic = new Worker("/worker-classic.js");
  classic.onmessage = (event) => done("classicHref", event.data);
  const mod = new Worker("/worker-module.js", { type: "module" });
  mod.onmessage = (event) => done("moduleHref", event.data);
  const blobCode = 'fetch("/api").then((r) => r.json()).then((d) => postMessage(d.method));';
  const blobWorker = new Worker(URL.createObjectURL(new Blob([blobCode], { type: "text/javascript" })));
  blobWorker.onmessage = (event) => done("blobApi", event.data);
</script>`,
);

const WORKER_ESCAPE = page(
  "Worker escape",
  `<pre id="results"></pre>
<script>
  const code =
    'if (typeof EventSource === "function") new EventSource("https://site-b.test/sse");' +
    'if (self.navigator && self.navigator.sendBeacon) self.navigator.sendBeacon("https://site-b.test/beacon", "x");' +
    'if (typeof Worker === "function") new Worker("https://site-b.test/w.js");' +
    'postMessage("done");';
  const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
  worker.onmessage = (event) => {
    document.getElementById("results").textContent = event.data;
  };
</script>`,
);

const FRAMES = page(
  "Frames",
  `<pre id="results"></pre>
<script>
  const out = {};
  let pending = 2;
  const done = (key, value) => {
    out[key] = value;
    if (--pending === 0) document.getElementById("results").textContent = JSON.stringify(out);
  };
  window.addEventListener("message", (event) => done("blankLocation", event.data));
  const blank = document.createElement("iframe");
  document.body.appendChild(blank);
  blank.contentDocument.open();
  blank.contentDocument.write('<script>parent.postMessage(location.href, "*")<\\/script>');
  blank.contentDocument.close();
  const srcdoc = document.createElement("iframe");
  srcdoc.id = "srcdoc";
  srcdoc.srcdoc = '<a id="l" href="https://site-b.test/x">x</a>';
  srcdoc.onload = () => done("srcdocLinkAttr", srcdoc.contentDocument.getElementById("l").href);
  document.body.appendChild(srcdoc);
</script>`,
);

const IDB_STORE = page(
  "IndexedDB store",
  `<p id="value"></p>
<script>
  (async () => {
    const set = new URL(location.href).searchParams.get("set");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("store", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const kv = (mode) => db.transaction("kv", mode).objectStore("kv");
    if (set) await new Promise((resolve) => { kv("readwrite").put(set, "k").onsuccess = resolve; });
    const got = await new Promise((resolve) => { kv("readonly").get("k").onsuccess = (e) => resolve(e.target.result); });
    document.getElementById("value").textContent = got || "";
  })();
</script>`,
);

const POSTMESSAGE = page(
  "PostMessage",
  `<p id="got"></p><iframe src="/pm-child"></iframe>
<script>
  window.addEventListener("message", (event) => {
    document.getElementById("got").textContent = event.data + " from " + event.origin;
  });
</script>`,
);

const PM_CHILD = page("PM child", `<script>parent.postMessage("hello", location.origin);</script>`);

// The page touches the frame before it loads, as reCAPTCHA does, and both sides check who sent each message.
const PM_SOURCE = page(
  "PostMessage source",
  `<pre id="results"></pre>
<script>
  const frame = document.createElement("iframe");
  frame.src = "https://site-b.test/pm-source-child";
  document.body.appendChild(frame);
  const child = frame.contentWindow;
  const out = {};
  window.addEventListener("message", (event) => {
    if (event.data === "ready") {
      out.readyOrigin = event.origin;
      out.readyFromChild = event.source === child;
      child.postMessage("ping", "https://site-b.test");
    } else {
      Object.assign(out, event.data);
      document.getElementById("results").textContent = JSON.stringify(out);
    }
  });
</script>`,
);

const PM_SOURCE_CHILD = page(
  "PostMessage source child",
  `<script>
  window.addEventListener("message", (event) => {
    if (event.data !== "ping") return;
    parent.postMessage({ pingFromParent: event.source === parent, pingOrigin: event.origin }, "https://site-a.test");
  });
  parent.postMessage("ready", "https://site-a.test");
</script>`,
);

// Reading contentWindow installs the runtime into the blank frame before the page gives the frame its src.
const REUSE = page(
  "Reuse",
  `<pre id="results"></pre>
<script>
  document.cookie = "a=1; path=/";
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const blank = frame.contentWindow;
  window.addEventListener("message", (event) => {
    const out = { ...event.data, fromChild: event.source === frame.contentWindow };
    document.getElementById("results").textContent = JSON.stringify(out);
  });
  frame.src = "https://site-b.test/reuse-child";
</script>`,
);

const REUSE_CHILD = page(
  "Reuse child",
  `<script>parent.postMessage({ cookie: document.cookie, href: location.href }, "*");</script>`,
);

// Workers come from a blank frame's constructor, the way anti-tamper code reaches for untouched natives.
const FRAME_WORKER = page(
  "Frame worker",
  `<pre id="results"></pre>
<script>
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const FrameWorker = frame.contentWindow.Worker;
  const out = {};
  let pending = 2;
  const done = (key, value) => {
    out[key] = value;
    if (--pending === 0) document.getElementById("results").textContent = JSON.stringify(out);
  };
  const blob = new FrameWorker(URL.createObjectURL(new Blob(['postMessage("blob ok")'], { type: "text/javascript" })));
  blob.onmessage = (event) => done("blob", event.data);
  blob.onerror = () => done("blob", "error");
  try {
    const classic = new FrameWorker("/worker-classic.js");
    classic.onmessage = (event) => done("classic", event.data);
    classic.onerror = () => done("classic", "error");
  } catch (error) {
    done("classic", "threw " + error.name);
  }
</script>`,
);

// Both scripts read location, so the proxy rewrites them and the hashes below stop matching what it serves.
const SRI_A = 'document.getElementById("a").textContent = location.hostname;';
const SRI_B = 'document.getElementById("b").textContent = location.hostname;';
const sha384 = (body: string) => `sha384-${createHash("sha384").update(body).digest("base64")}`;
const SRI = page(
  "SRI",
  `<p id="a"></p><p id="b"></p>
<script>
  const a = document.createElement("script");
  a.src = "/sri-a.js";
  a.integrity = "${sha384(SRI_A)}";
  document.head.appendChild(a);
  const b = document.createElement("script");
  b.setAttribute("src", "/sri-b.js");
  b.setAttribute("integrity", "${sha384(SRI_B)}");
  document.head.appendChild(b);
</script>`,
);

const SRCDOC_ESCAPE = page(
  "Srcdoc escape",
  `<iframe srcdoc="<script>fetch('https://site-b.test/api').catch(function(){})<\/script>"></iframe>`,
);

const NOTIFY = page(
  "Notify",
  `<p id="perm"></p>
<script>
  Notification.requestPermission().then((p) => {
    document.getElementById("perm").textContent = p;
  });
</script>`,
);

const RAW_ATTR = page(
  "Raw attr",
  `<a id="link" href="/api">x</a><p id="raw"></p><p id="rawnode"></p><p id="fetched"></p>
<script>
  (async () => {
    const link = document.getElementById("link");
    const raw = link.getAttributeNode("href").value;
    document.getElementById("raw").textContent = raw;
    document.getElementById("rawnode").textContent = link.getAttributeNode("href").nodeValue;
    const response = await fetch(new URL(raw, document.baseURI).href);
    const data = await response.json();
    document.getElementById("fetched").textContent = data.method;
  })();
</script>`,
);

const PLAIN_BODY = '<script>parent.postMessage("ran", "*")</script>';
const SVG_BODY = `<svg xmlns="http://www.w3.org/2000/svg"><script>document.documentElement.setAttribute("data-ran", "1"); parent.postMessage("ran", "*")</script></svg>`;
const XML_BODY = `<html xmlns="http://www.w3.org/1999/xhtml"><body><script>parent.postMessage("ran", "*")</script></body></html>`;

const INERT = page(
  "Inert",
  `<pre id="results"></pre>
<iframe src="/plain.txt"></iframe>
<iframe src="/doc.svg"></iframe>
<iframe src="/untyped"></iframe>
<iframe src="/data.xml"></iframe>
<object data="/doc.svg" type="image/svg+xml"></object>
<embed src="/untyped">
<script>
  let ran = 0;
  window.addEventListener("message", (event) => { if (event.data === "ran") ran++; });
  setTimeout(() => {
    const readable = [];
    for (let i = 0; i < frames.length; i++) {
      try { readable.push(Boolean(frames[i].document)); } catch { readable.push(false); }
    }
    document.getElementById("results").textContent = JSON.stringify({ ran, readable });
  }, 1500);
</script>`,
);

const typed =
  (type: string | null, body: string): Route =>
  (_req, res) => {
    res.writeHead(200, type ? { "content-type": type } : {});
    res.end(body);
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
    "/keys": html(
      page(
        "Keys",
        `<p id="keys">0</p>
<script>let n = 0; document.addEventListener("keydown", () => { document.getElementById("keys").textContent = String(++n); });</script>`,
      ),
    ),
    "/wipe": html(
      page(
        "Wipe",
        `<script>addEventListener("load", () => {
  const body = document.createElement("body"); body.id = "wiped";
  document.documentElement.replaceChildren(document.createElement("head"), body);
});</script>`,
      ),
    ),
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
    "/ui-link": html(page("UI link", '<a id="settings" href="/settings">settings</a>')),
    "/settings": html(page("Site settings", "<p>site settings</p>")),
    "/third-party": html(
      page(
        "Third party",
        `<p id="fetch"></p><iframe id="tp" src="https://site-b.test/cookie/whoami"></iframe>
    <script>fetch("https://site-b.test/cookie/echo", { credentials: "include" }).then((r) => r.text()).then((t) => { document.getElementById("fetch").textContent = t || "none"; });</script>`,
      ),
    ),
    "/storage": html(STORAGE),
    "/idb-store": html(IDB_STORE),
    "/api": api,
    "/sse": sse,
    "/cookie/echo": cookieEcho,
    "/old-channel": html(OLD_CHANNEL),
    "/cookie/script": html(COOKIE_SCRIPT),
    "/cookie/set-api": cookieApi,
    "/cookie/api-page": html(COOKIE_API_PAGE),
    "/network": html(NETWORK),
    "/worker": html(WORKER),
    "/worker.js": script('importScripts("lib.js");\npostMessage(self.answer);'),
    "/lib.js": script('self.answer = typeof self.location.href === "string" ? 42 : 0;'),
    "/realtime": html(REALTIME),
    "/range": rangeRoute(Buffer.alloc(10000, 65), "application/octet-stream"),
    "/video-page": html(VIDEO_PAGE),
    "/sample.webm": rangeRoute(sampleWebm, "video/webm"),
    "/sample.mp4": rangeRoute(sampleMp4, "video/mp4"),
    "/mse": html(MSE),
    "/abortable": abortable.stream,
    "/abortable/aborts": abortable.count,
    "/slow-stream": slowStreamRoute(800),
    "/sinks": html(SINKS),
    "/sinks-write": html(SINKS_WRITE),
    "/exec": html(EXEC),
    "/nav-api": html(
      page("Nav API", `<button id="go" onclick="navigation.navigate('https://site-b.test/')">go</button>`),
    ),
    "/frames": html(FRAMES),
    "/postmessage": html(POSTMESSAGE),
    "/pm-child": html(PM_CHILD),
    "/pm-source": html(PM_SOURCE),
    "/reuse": html(REUSE),
    "/plain.txt": typed("text/plain", PLAIN_BODY),
    "/doc.svg": typed("image/svg+xml", SVG_BODY),
    "/untyped": typed(null, PLAIN_BODY),
    "/data.xml": typed("application/xml", XML_BODY),
    "/inert": html(INERT),
    "/frame-worker": html(FRAME_WORKER),
    "/sri": html(SRI),
    "/sri-a.js": script(SRI_A),
    "/sri-b.js": script(SRI_B),
    "/notify": html(NOTIFY),
    "/srcdoc-escape": html(SRCDOC_ESCAPE),
    "/raw-attr": html(RAW_ATTR),
    "/worker2": html(WORKER2),
    "/worker-escape": html(WORKER_ESCAPE),
    "/admin-probe": html(
      page(
        "Admin probe",
        `<pre id="result"></pre><script>
  const proxy = new URLSearchParams(location.search).get("proxy");
  (async () => {
    const out = {};
    const hooked = await fetch(proxy + "/_g/admin/settings");
    out.hooked = hooked.status + " " + (await hooked.text());
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const raw = frames[frames.length - 1];
    const post = await raw.fetch(proxy + "/_g/admin/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blockedHosts: [] }),
    });
    out.rawPost = post.status;
    out.rawGet = (await raw.fetch(proxy + "/_g/admin/settings")).status;
    document.getElementById("result").textContent = JSON.stringify(out);
  })();
</script>`,
      ),
    ),
    "/native-tostring": html(
      page(
        "Native toString",
        `<pre id="result"></pre><script>
  const native = (fn) => /\\[native code\\]/.test(Function.prototype.toString.call(fn));
  document.getElementById("result").textContent = JSON.stringify({
    fetch: native(fetch),
    xhrOpen: native(XMLHttpRequest.prototype.open),
    xhrSend: native(XMLHttpRequest.prototype.send),
    toString: native(Function.prototype.toString),
    setTimeout: native(setTimeout),
  });
</script>`,
      ),
    ),
    "/worker-origin": html(
      page(
        "Worker origin",
        `<pre id="result"></pre><script>
  const w = new Worker("/worker-origin.js");
  w.onmessage = (e) => { document.getElementById("result").textContent = e.data; };
</script>`,
      ),
    ),
    "/worker-origin.js": script("postMessage(self.origin);"),
    "/worker-classic.js": script("postMessage(self.location.href);"),
    "/worker-cookie": html(
      page(
        "Worker cookie",
        `<p id="worker"></p>
<script>const w = new Worker("/worker-cookie.js"); w.onmessage = (e) => { document.getElementById("worker").textContent = e.data || "none"; };</script>`,
      ),
    ),
    "/worker-cookie.js": script(
      'fetch("/cookie/echo", { credentials: "include" }).then((r) => r.text()).then((t) => postMessage(t));',
    ),
    "/worker-module.js": script("postMessage(self.location.href);"),
    "/doors-workers": html(DOORS_WORKERS),
    "/probe-worker.js": script(PROBE_WORKER),
    "/nest.js": script(
      'const inner = new Worker("/probe-worker.js");\ninner.onmessage = (event) => postMessage(event.data);\ninner.onerror = () => postMessage("error");',
    ),
  },
  "www.site-a.test": { "/landing": html(page("Landing", "<h1>Landing</h1>")), "/cookie/whoami": whoami },
  "cdn.site-a.test": { "/b.png": png, "/style.css": css("#external { background-image: url(/b.png); }") },
  "site-b.test": {
    "/": html(page("Site B", "<h1>Site B</h1>")),
    "/search": search,
    "/frame": html(FRAME),
    "/cookie/whoami": whoami,
    "/cookie/set": (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "tp=1; Path=/; SameSite=None; Secure",
      });
      res.end(page("Set", "<p>set</p>"));
    },
    "/cookie/echo": cookieEcho,
    "/storage": html(STORAGE),
    "/idb-store": html(IDB_STORE),
    "/api": api,
    "/pm-source-child": html(PM_SOURCE_CHILD),
    "/reuse-child": html(REUSE_CHILD),
    "/broadcast": html(
      page(
        "Broadcast",
        `<script>const channel = new BroadcastChannel("probe"); setInterval(() => channel.postMessage("x"), 200);</script>`,
      ),
    ),
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
