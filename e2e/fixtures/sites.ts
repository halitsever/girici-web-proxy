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
<button id="blank-popup" onclick="const w = window.open(); w.location = 'https://site-b.test/';">blank popup</button>
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
  let parentHref;
  try {
    parentHref = parent.location.href;
  } catch (error) {
    parentHref = error.name;
  }
  document.getElementById("frame-results").textContent = JSON.stringify({ href: location.href, parent: parentHref });
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

// Reports how a binary frame reached it, to its parent when it is a frame.
const WS_BINARY = page(
  "Binary socket",
  `<pre id="type"></pre>
<script>
  const socket = new WebSocket("wss://site-b.test/binary-socket");
  socket.onmessage = (event) => {
    const type = event.data instanceof Blob ? "blob" : Object.prototype.toString.call(event.data);
    document.getElementById("type").textContent = type;
    if (parent !== window) parent.postMessage("socket:" + type, "*");
  };
</script>`,
);

const WS_FRAME = page(
  "Binary socket frame",
  `<pre id="type"></pre><iframe src="/ws-binary"></iframe>
<script>
  addEventListener("message", (event) => {
    if (typeof event.data === "string" && event.data.startsWith("socket:")) {
      document.getElementById("type").textContent = event.data.slice(7);
    }
  });
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
// The click writes a cookie first, so the runtime holds the navigation until the write is stored.
const COOKIE_CLICK = page(
  "Cookie click",
  `<a id="go" href="https://site-b.test/">site b</a>
<script>
  document.getElementById("go").addEventListener("click", () => {
    document.cookie = "clicked=1; path=/";
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

// Each case makes one window and checks it at once through a raw index, which no hook sees.
const DOORS_FRAMES = page(
  "Doors frames",
  `<iframe id="parsed"></iframe>
<script>const parsedHooked = Object.getOwnPropertyDescriptor(frames[0], "__g$") !== undefined;</script>
<button id="start">start</button><pre id="results"></pre>
<script>
  ${PROBE}
  const hookedOf = (w) => Boolean(w) && Object.getOwnPropertyDescriptor(w, "__g$") !== undefined;
  // A window may be missing (the server refused the load) or sandboxed into another origin; neither reaches storage.
  const stateOf = (w) => {
    if (!w) return "none";
    try {
      return hookedOf(w);
    } catch {
      return "cross-origin";
    }
  };
  // Frames name a page, as real ones do: a frame without src loads its blank document at once, and that load alone
  // would adopt it.
  const frame = () => {
    const f = document.createElement("iframe");
    f.src = "/page2";
    return f;
  };
  const blankFrame = () => document.createElement("iframe");
  // A fresh empty element at the end of body, so a frame made in it is the last window.
  const box = () => document.getElementById("slot").appendChild(document.createElement("div"));
  const last = () => frames[frames.length - 1];
  // Each case must make a window; one that makes none reports that instead of passing on an older frame.
  const newest = (view, count) => (view.length > count ? view[view.length - 1] : "no window");
  const inBox = (insert) => {
    const count = frames.length;
    insert(box(), frame());
    return newest(window, count);
  };
  // Frames in a shadow tree are never indexed, so DocumentFragment insertions are reachable only through the hooked
  // getters and have no case here.
  // A blank frame whose document has no element yet, for Document and DocumentType insertions.
  const inHost = (insert) => {
    const host = box().appendChild(blankFrame());
    const doc = host.contentDocument;
    const child = host.contentWindow;
    doc.documentElement.remove();
    insert(doc, frame());
    return newest(child, 0);
  };
  // A blank frame whose document keeps its elements, for setters that need a document element.
  const inLoadedHost = (insert) => {
    const host = box().appendChild(blankFrame());
    const doc = host.contentDocument;
    const child = host.contentWindow;
    insert(doc, child);
    return newest(child, 0);
  };
  const withDoctype = (doc) => {
    const doctype = doc.implementation.createDocumentType("html", "", "");
    doc.appendChild(doctype);
    return doctype;
  };
  const cases = {
    "Node.appendChild": () => inBox((b, f) => b.appendChild(f)),
    "Node.insertBefore": () => inBox((b, f) => b.insertBefore(f, null)),
    "Node.replaceChild": () => inBox((b, f) => b.replaceChild(f, b.appendChild(document.createElement("span")))),
    "Element.append": () => inBox((b, f) => b.append(f)),
    "Element.prepend": () => inBox((b, f) => b.prepend(f)),
    "Element.replaceChildren": () => inBox((b, f) => b.replaceChildren(f)),
    "Element.before": () => inBox((b, f) => b.appendChild(document.createElement("span")).before(f)),
    "Element.after": () => inBox((b, f) => b.appendChild(document.createElement("span")).after(f)),
    "Element.replaceWith": () => inBox((b, f) => b.appendChild(document.createElement("span")).replaceWith(f)),
    "Element.insertAdjacentElement": () => inBox((b, f) => b.insertAdjacentElement("beforeend", f)),
    "Document.append": () => inHost((d, f) => d.append(f)),
    "Document.prepend": () => inHost((d, f) => d.prepend(f)),
    "Document.replaceChildren": () => inHost((d, f) => d.replaceChildren(f)),
    "Document.body": () =>
      inLoadedHost((d) => {
        const body = d.createElement("body");
        const f = d.createElement("iframe");
        f.src = "/page2";
        body.append(f);
        d.body = body;
      }),
    "table.caption": () =>
      inBox((b, f) => {
        const caption = document.createElement("caption");
        caption.append(f);
        b.appendChild(document.createElement("table")).caption = caption;
      }),
    "table.tHead": () =>
      inBox((b, f) => {
        const head = document.createElement("thead");
        head.insertRow().insertCell().append(f);
        b.appendChild(document.createElement("table")).tHead = head;
      }),
    "table.tFoot": () =>
      inBox((b, f) => {
        const foot = document.createElement("tfoot");
        foot.insertRow().insertCell().append(f);
        b.appendChild(document.createElement("table")).tFoot = foot;
      }),
    execCommand: () =>
      inBox((b) => {
        b.contentEditable = "true";
        b.focus();
        getSelection().selectAllChildren(b);
        document.execCommand("insertHTML", false, "<iframe src='/page2'></iframe>");
      }),
    "CharacterData.before": () => inBox((b, f) => b.appendChild(document.createTextNode("t")).before(f)),
    "CharacterData.after": () => inBox((b, f) => b.appendChild(document.createTextNode("t")).after(f)),
    "CharacterData.replaceWith": () => inBox((b, f) => b.appendChild(document.createTextNode("t")).replaceWith(f)),
    // An element can never come before a doctype, so DocumentType.before cannot make a window.
    "DocumentType.after": () => inHost((d, f) => withDoctype(d).after(f)),
    "DocumentType.replaceWith": () => inHost((d, f) => withDoctype(d).replaceWith(f)),
    "Range.insertNode": () =>
      inBox((b, f) => {
        const range = document.createRange();
        range.selectNodeContents(b);
        range.insertNode(f);
      }),
    "Range.surroundContents": () =>
      inBox((b, f) => {
        b.appendChild(document.createTextNode("t"));
        const range = document.createRange();
        range.selectNodeContents(b);
        range.surroundContents(f);
      }),
    innerHTML: () => inBox((b) => (b.innerHTML = "<iframe src='/page2'></iframe>")),
    outerHTML: () => inBox((b) => (b.appendChild(document.createElement("span")).outerHTML = "<iframe src='/page2'></iframe>")),
    insertAdjacentHTML: () => inBox((b) => b.insertAdjacentHTML("beforeend", "<iframe src='/page2'></iframe>")),
    "document.write": () => {
      const host = box().appendChild(blankFrame());
      const doc = host.contentDocument;
      const child = host.contentWindow;
      doc.open();
      doc.write("<iframe src='/page2'></iframe>");
      const made = child[0];
      doc.close();
      return made;
    },
    // A write to a loaded document opens it first, which drops the document's listeners.
    "document.write after load": () =>
      inLoadedHost((d) => {
        d.write("<iframe src='/page2'></iframe>");
        d.close();
      }),
    "fragment after open": () =>
      inLoadedHost((d) => {
        d.open();
        d.write("<body></body>");
        d.close();
        const fragment = d.createDocumentFragment();
        const f = d.createElement("iframe");
        f.src = "/page2";
        fragment.append(f);
        d.body.appendChild(fragment);
      }),
  };
  // A javascript: URL whose string result becomes the frame's next document; its script reports what it found.
  const jsDocument = (key) =>
    "javascript:" +
    JSON.stringify(
      "<scr" + "ipt>parent.jsDone(" + JSON.stringify(key) + ", Object.getOwnPropertyDescriptor(window, '__g$') !== undefined)</scr" + "ipt>",
    );
  const jsWaiting = {};
  window.jsDone = (key, value) => jsWaiting[key]?.(value);
  const viaJavascript = (key, navigate) =>
    new Promise((resolve) => {
      jsWaiting[key] = resolve;
      setTimeout(() => resolve("timeout"), 5000);
      const f = box().appendChild(blankFrame());
      navigate(f, jsDocument(key));
    });
  const loadedWindow = (element) =>
    new Promise((resolve) => {
      const count = frames.length;
      element.onload = element.onerror = () => resolve(frames.length > count ? last() : null);
      setTimeout(() => resolve(frames.length > count ? last() : null), 5000);
      box().appendChild(element);
    });
  document.getElementById("start").onclick = async () => {
    const hooked = { parsed: parsedHooked };
    // First, while the click still counts as user activation.
    let pip = "unavailable";
    try {
      const w = await documentPictureInPicture.requestWindow();
      pip = hookedOf(w);
      w.close();
    } catch {}
    for (const [name, make] of Object.entries(cases)) {
      const made = make();
      hooked[name] = made === "no window" ? made : hookedOf(made);
    }
    hooked["javascript: src"] = await viaJavascript("src", (f, url) => (f.src = url));
    hooked["javascript: location"] = await viaJavascript("location", (f, url) => (f.contentWindow.location.href = url));
    hooked["javascript: self"] = await viaJavascript("self", (f, url) =>
      new f.contentWindow.Function("location.href = " + JSON.stringify(url))(),
    );
    // Object and embed windows come a task later, so they are checked when the element loads.
    const object = document.createElement("object");
    object.type = "text/html";
    object.data = "/page2";
    const embed = document.createElement("embed");
    embed.type = "text/html";
    embed.src = "/page2";
    const loaded = { object: stateOf(await loadedWindow(object)), embed: stateOf(await loadedWindow(embed)) };
    const popup = open();
    hooked.open = hookedOf(popup);
    const named = document.open("", "doors-named", "");
    hooked["document.open with three arguments"] = hookedOf(named);
    let probed = null;
    for (let i = frames.length - 1; i >= 0 && !probed; i--) if (stateOf(frames[i]) === true) probed = frames[i];
    const [frameProbe, popupProbe] = await Promise.all([girProbe(probed), girProbe(popup)]);
    popup.close();
    named?.close();
    document.getElementById("results").textContent = JSON.stringify({ hooked, loaded, pip, frameProbe, popupProbe });
  };
</script><div id="slot"></div>`,
);

const DOORS_WORKERS = page(
  "Doors workers",
  `<button id="start">start</button><pre id="results"></pre>
<script>
  const probeSource = ${JSON.stringify(PROBE_WORKER)};
  const probeUrl = () => URL.createObjectURL(new Blob([probeSource], { type: "text/javascript" }));
  // Each tamper is undone at once, so the engine's later calls see the real prototypes.
  const viaTrap = () => {
    let leaked = null;
    Object.prototype.get = function (target, key, receiver) {
      leaked = target;
      return Reflect.get(target, key, receiver);
    };
    try { void Worker.name; } finally { delete Object.prototype.get; }
    return leaked || Worker;
  };
  const viaCall = () => {
    let leaked = null;
    const call = Function.prototype.call;
    Function.prototype.call = function (self, ...rest) {
      if (typeof self === "function" && self !== Worker) leaked = self;
      return Reflect.apply(this, self, rest);
    };
    try { Worker.toString(); } finally { Function.prototype.call = call; }
    return leaked || Worker;
  };
  const viaParts = () => {
    const iterate = Array.prototype[Symbol.iterator];
    Array.prototype[Symbol.iterator] = function () {
      const swap = typeof this[0] === "string" && this[0].includes("__giriciRuntime");
      return swap ? [probeSource].values() : iterate.call(this);
    };
    try { return new Worker("/probe-worker.js"); } finally { Array.prototype[Symbol.iterator] = iterate; }
  };
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
    const TrapWorker = viaTrap();
    const CallWorker = viaCall();
    const [own, nested, leakedWorker, leakedChannel, trapWorker, callWorker, partsWorker] = await Promise.all([
      answer(worker),
      answer(new Worker("/nest.js")),
      answer(new LeakedWorker(probeUrl())),
      listen(new LeakedChannel("__g|https://site-b.test|probe")),
      answer(new TrapWorker(probeUrl())),
      answer(new CallWorker(probeUrl())),
      answer(viaParts()),
    ]);
    document.getElementById("results").textContent = JSON.stringify({
      worker: own, nested, leakedWorker, leakedChannel, trapWorker, callWorker, partsWorker,
    });
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
const SEALED_PAGE = page(
  "Sealed",
  `<h1>Sealed</h1>
<img id="rel" src="dot.png" alt="">
<script type="module">import "./mod.js";</script>
<a href="https://site-b.test/target">site-b</a>`,
);
const SEALED_SPA = page(
  "Sealed SPA",
  `<h1>SPA</h1>
<button id="push">Push</button><pre id="href"></pre>
<a id="to-bottom" href="#bottom">bottom</a> <a id="page2" href="?page=2">page 2</a>
<form action="/sealed/search"><input name="q" aria-label="Search"><button id="search-go">Search</button></form>
<button id="popup-go">Popup</button><pre id="popup"></pre>
<iframe id="frame" src="https://www.site-a.test/sealed/cookie-echo"></iframe>
<div style="height: 3000px"></div><p id="bottom">Bottom</p>
<script>
  window.marker = "kept";
  document.getElementById("push").onclick = () => {
    history.pushState({}, "", "next?a=1");
    document.getElementById("href").textContent = location.href;
  };
  document.getElementById("popup-go").onclick = () => {
    const popup = window.open("/sealed/next");
    const poll = setInterval(() => {
      try {
        if (popup.location.pathname !== "/sealed/next") return;
        document.getElementById("popup").textContent = popup.location.pathname;
        clearInterval(poll);
      } catch {}
    }, 100);
  };
</script>`,
);
const SEALED_ECHO = `<pre id="href"></pre><pre id="search"></pre>
<script>
  document.getElementById("href").textContent = location.href;
  document.getElementById("search").textContent = location.search;
</script>`;

/** Sets the cookie a same-site frame of the page should still carry. */
const sealedCookie =
  (body: string): Route =>
  (_req, res) => {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": "sealed=1; Path=/; Domain=site-a.test; SameSite=Lax",
    });
    res.end(body);
  };
const sealedPage = sealedCookie(SEALED_PAGE);
const sealedSearch: Route = (req, res) => {
  const query = new URL(req.url ?? "/", "http://fixture").search;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page("Sealed search", `<pre id="query">${escapeHtml(query)}</pre>${SEALED_ECHO}`));
};

const search: Route = (req, res) => {
  const query = new URL(req.url ?? "/", "http://fixture").searchParams.get("q") ?? "";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page("Search", `<h1 id="query">${escapeHtml(query)}</h1>`));
};

/** Served markup and headers that name a blob URL the page made, the way a site's own server could echo one back. */
const servedBlob =
  (kind: "frame" | "meta" | "header"): Route =>
  (req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture").searchParams.get("u") ?? "";
    const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
    if (kind === "header") headers.refresh = `0;url=${url}`;
    res.writeHead(200, headers);
    const body =
      kind === "frame"
        ? `<iframe src="${escapeHtml(url)}"></iframe>`
        : kind === "meta"
          ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(url)}">`
          : "<p>header</p>";
    res.end(page("Served blob", body));
  };

// A page that breaks the array iterator before its frames are adopted, to reach the jar or navigate unhooked.
const ITERATOR_ADOPTION = page(
  "Iterator adoption",
  `<pre id="results"></pre>
<script>
  const results = {};
  const iterate = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function* () {};
  const first = document.createElement("iframe");
  document.body.appendChild(first);
  Array.prototype[Symbol.iterator] = iterate;
  const request = first.contentWindow.indexedDB.open("__girici");
  request.onsuccess = () => {
    results.stores = request.result.objectStoreNames.length;
    request.result.close();
    document.getElementById("results").textContent = JSON.stringify(results);
  };
  request.onerror = () => {
    results.stores = "error";
    document.getElementById("results").textContent = JSON.stringify(results);
  };
  Array.prototype[Symbol.iterator] = function () {
    throw new Error("page");
  };
  const second = document.createElement("iframe");
  second.name = "second";
  try {
    document.body.appendChild(second);
  } catch {
    // The insertion may fail; the frame must still not navigate around the proxy.
  }
  Array.prototype[Symbol.iterator] = iterate;
  second.contentWindow.open("https://site-b.test/", "_self");
</script>`,
);

// A served refresh whose target starts with a quote; the rewritten value must keep it inside the proxy.
const REFRESH_QUOTE = page(
  "Refresh quote",
  "<p>quote</p>",
  `<meta http-equiv="refresh" content="0; url=&quot;'//site-b.test/&quot;">`,
);
const REFRESH_QUOTE_HOST = page(
  "Refresh quote host",
  `<pre id="done"></pre><iframe id="quoted" src="/refresh-quote"></iframe>
<script>
  setTimeout(() => (document.getElementById("done").textContent = "done"), 2500);
</script>`,
);

const SERVED_BLOBS = page(
  "Served blobs",
  `<pre id="results"></pre>
<script>
  const ran = [];
  addEventListener("message", (event) => {
    if (typeof event.data === "string" && event.data.startsWith("ran:")) ran.push(event.data.slice(4));
  });
  for (const kind of ["frame", "meta", "header"]) {
    const code = '<svg xmlns="http://www.w3.org/2000/svg"><script>top.postMessage("ran:' + kind + '", "*")<\\/script></svg>';
    const url = URL.createObjectURL(new Blob([code], { type: "image/svg+xml" }));
    const frame = document.createElement("iframe");
    frame.src = "/served-blob-" + kind + "?u=" + encodeURIComponent(url);
    document.body.appendChild(frame);
  }
  setTimeout(() => (document.getElementById("results").textContent = JSON.stringify({ ran: ran.sort() })), 3000);
</script>`,
);

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

// The page holds the frame's blank window before it names the page to load, as some widget loaders do.
const PM_TOUCH = page(
  "PostMessage touch",
  `<pre id="results"></pre>
<script>
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const child = frame.contentWindow;
  frame.src = "https://site-b.test/pm-touch-child";
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

const TOP_HOST = page(
  "Top host",
  `<p id="top"></p><iframe src="https://site-b.test/top-probe"></iframe>
<script>
  window.addEventListener("message", (event) => {
    document.getElementById("top").textContent = String(event.data);
  });
</script>`,
);

const TOP_PROBE = page(
  "Top probe",
  `<script>
  let result = "open";
  try {
    top.document.title;
  } catch (error) {
    result = error.name;
  }
  parent.postMessage(result, "*");
</script>`,
);

const CROSS_POPUP = page(
  "Cross popup",
  `<button id="open">open</button><button id="check">check</button><pre id="results"></pre>
<script>
  let w;
  const failure = (read) => {
    try {
      read();
      return "open";
    } catch (error) {
      return error.name;
    }
  };
  document.getElementById("open").onclick = () => {
    w = open("https://site-b.test/");
  };
  document.getElementById("check").onclick = () => {
    let posted = true;
    try {
      w.postMessage("x", "https://site-b.test");
    } catch {
      posted = false;
    }
    document.getElementById("results").textContent = JSON.stringify({
      document: failure(() => w.document),
      storage: failure(() => w.localStorage),
      closed: w.closed,
      posted,
    });
  };
</script>`,
);

const FAILURE = `const failure = (read) => {
    try {
      read();
      return "open";
    } catch (error) {
      return error.name;
    }
  };`;

// Each change shows as [key, newValue, storageArea is this window's localStorage].
// The blob page reports whether the runtime is there, with a fresh number for each load.
const BLOB_FRAME = page(
  "Blob frame",
  `<iframe id="f"></iframe>
<script>
  const html = '<p id="state"></p><script>document.getElementById("state").textContent = typeof window.__g$ + ":" + Math.random();<' + '/script>';
  document.getElementById("f").src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
</script>`,
);

const STORAGE_EVENTS = page(
  "Storage events",
  `<pre id="events"></pre>
<script>
  addEventListener("storage", (event) => {
    const line = JSON.stringify([event.key, event.newValue, event.storageArea === localStorage]);
    document.getElementById("events").textContent += line + "\\n";
  });
</script>`,
);

const XS_HOOKS = page(
  "Cross-site hooks",
  `<pre id="results"></pre><iframe id="blank"></iframe><iframe id="b" src="https://site-b.test/xs-child"></iframe>
<script>
  ${FAILURE}
  addEventListener("message", (event) => {
    if (!event.data || event.data.from !== "xs-child") return;
    const frame = document.getElementById("b");
    const blank = document.getElementById("blank").contentWindow;
    document.getElementById("results").textContent = JSON.stringify({
      contentDocument: frame.contentDocument === null,
      svgDocument: typeof frame.getSVGDocument === "function" ? frame.getSVGDocument() === null : "absent",
      sourceDocument: failure(() => event.source.document),
      frameElement: event.data.frameElement,
      history: failure(() => history.pushState.call(blank.history, null, "", location.href)),
    });
  });
</script>`,
);

const XS_CHILD = page(
  "Cross-site child",
  `<script>parent.postMessage({ from: "xs-child", frameElement: window.frameElement === null }, "*");</script>`,
);

// Every route a cross-site frame has to send code to its top; none of it may run there.
const XS_JS_HOST = page(
  "Cross-site javascript host",
  `<pre id="results"></pre><iframe src="https://site-b.test/xs-js-child"></iframe>
<script>
  window.pwned = 0;
  addEventListener("message", (event) => {
    if (event.data !== "xs-js-done") return;
    setTimeout(() => {
      document.getElementById("results").textContent = JSON.stringify({ pwned: window.pwned });
    }, 1500);
  });
</script>`,
);

const XS_JS_CHILD = page(
  "Cross-site javascript child",
  `<script>
  const code = "javascript:void(window.pwned = (window.pwned || 0) + 1)";
  const attempt = (run) => {
    try {
      run();
    } catch {
      // A refusal may throw; the host only counts what ran.
    }
  };
  attempt(() => {
    top.location = code;
  });
  attempt(() => {
    parent.location.href = code;
  });
  attempt(() => top.location.replace(code));
  attempt(() => open(code, "_top"));
  attempt(() => {
    const link = document.createElement("a");
    link.href = code;
    link.target = "_top";
    document.body.appendChild(link);
    link.click();
  });
  parent.postMessage("xs-js-done", "*");
</script>`,
);

const XS_OPENER = page(
  "Cross-site opener",
  `<button id="open">open</button><button id="doc-open">document.open</button><button id="check">check</button>
<pre id="results"></pre>
<script>
  ${FAILURE}
  let w;
  document.getElementById("open").onclick = () => {
    w = open("https://site-b.test/xs-opened");
  };
  document.getElementById("doc-open").onclick = () => {
    w = document.open("https://site-b.test/xs-opened", "xs", "");
  };
  document.getElementById("check").onclick = () => {
    document.getElementById("results").textContent = JSON.stringify({
      document: failure(() => w.document),
      closed: w.closed,
    });
  };
</script>`,
);

// A popup the page could script while it showed this site; once it shows another, every held reference loses it.
const XS_HELD = page(
  "Held popup",
  `<button id="blank">blank</button><button id="same">same</button><button id="hold">hold</button>
<button id="away">away</button><button id="check">check</button><pre id="results"></pre>
<script>
  ${FAILURE}
  let w;
  let global;
  let before;
  const hold = () => {
    global = w.globalThis;
    before = failure(() => w.document.title);
  };
  document.getElementById("blank").onclick = () => {
    w = open();
    hold();
  };
  document.getElementById("same").onclick = () => {
    w = open("https://site-a.test/");
  };
  document.getElementById("hold").onclick = hold;
  document.getElementById("away").onclick = () => {
    w.location = "https://site-b.test/xs-opened";
  };
  document.getElementById("check").onclick = () => {
    document.getElementById("results").textContent = JSON.stringify({
      before,
      document: failure(() => w.document),
      global: failure(() => global.document),
      closed: w.closed,
    });
  };
</script>`,
);

// Opens another site's popup and keeps trying its document until checked; with "forge" its own JSON.parse first drops
// the seal from any engine config and names this page as the one the popup inherits from.
const XS_SEALED_OPENER = page(
  "Sealed opener",
  `<button id="open">open</button><button id="forge">forge</button><button id="check">check</button>
<pre id="results"></pre>
<script>
  ${FAILURE}
  let w;
  let leaks = 0;
  let polling = true;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    if (!polling) return;
    try {
      void w.document;
      leaks++;
    } catch {}
    channel.port2.postMessage(0);
  };
  const open = () => {
    w = window.open("https://site-b.test/xs-opened");
    channel.port2.postMessage(0);
    setTimeout(() => (polling = false), 10000);
  };
  document.getElementById("open").onclick = open;
  document.getElementById("forge").onclick = () => {
    const parse = JSON.parse;
    const base = location.href;
    JSON.parse = function (text, reviver) {
      const value = parse(text, reviver);
      if (value && typeof value === "object" && "cookies" in value) {
        delete value.seal;
        value.inherit = { origin: "forged", base };
      }
      return value;
    };
    open();
  };
  document.getElementById("check").onclick = () => {
    polling = false;
    document.getElementById("results").textContent = JSON.stringify({
      document: failure(() => w.document),
      leaks,
      closed: w.closed,
    });
  };
</script>`,
);

const XS_OPENED = page(
  "Cross-site opened",
  `<pre id="results"></pre>
<script>
  ${FAILURE}
  document.getElementById("results").textContent = JSON.stringify({
    runtime: typeof window.__g$ === "object",
    openerDocument: failure(() => opener.document),
    openerClosed: opener.closed,
  });
</script>`,
);

const EMBED_STORAGE = page(
  "Embed storage",
  `<iframe id="b" src="https://site-b.test/storage"></iframe>
<iframe id="www" src="https://www.site-a.test/storage"></iframe>`,
);

// A src set before insertion is the one order in which every browser reuses the blank window for the child page.
const REUSE = page(
  "Reuse",
  `<pre id="results"></pre>
<script>
  document.cookie = "a=1; path=/";
  const frame = document.createElement("iframe");
  frame.src = "https://site-b.test/reuse-child";
  document.body.appendChild(frame);
  frame.contentWindow.mark = "reused";
  window.addEventListener("message", (event) => {
    const out = { ...event.data, fromChild: event.source === frame.contentWindow };
    document.getElementById("results").textContent = JSON.stringify(out);
  });
</script>`,
);

// Same-site children in reused windows: one learns its top from its parent, one only by asking the frame itself.
const REUSE_SAME = page(
  "Reuse same site",
  `<pre id="results"></pre>
<script>
  document.cookie = "a=1; path=/";
  const out = {};
  const children = {};
  const make = (key, policy) => {
    const frame = document.createElement("iframe");
    if (policy) frame.referrerPolicy = policy;
    frame.src = "/reuse-same-child?k=" + key;
    document.body.appendChild(frame);
    const blank = frame.contentWindow;
    blank.mark = key;
    // A write from the blank document first, so the renewed one cannot start from its sequence.
    blank.document.cookie = key + "-blank=1; path=/";
    children[key] = frame;
  };
  window.addEventListener("message", (event) => {
    const { key } = event.data;
    out[key] = { ...event.data, fromChild: event.source === children[key].contentWindow };
    if (Object.keys(out).length === 2) document.getElementById("results").textContent = JSON.stringify(out);
  });
  make("told");
  make("asked", "no-referrer");
</script>`,
);

const REUSE_SAME_CHILD = page(
  "Reuse same site child",
  `<script>
  const key = new URLSearchParams(location.search).get("k");
  const reused = window.mark === key;
  document.cookie = key + "=1; path=/";
  fetch("/cookie/echo")
    .then((r) => r.text())
    .then((echo) => parent.postMessage({ key, reused, echo }, "*"));
</script>`,
);

// The worker comes from a blank frame, whose own address names no page to bind it to.
const BLANK_WORKER = page(
  "Blank worker",
  `<p id="worker"></p>
<script>
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const code = 'fetch("/cookie/echo", { credentials: "include" }).then((r) => r.text()).then((t) => postMessage(t));';
  const blob = frame.contentWindow.URL.createObjectURL(new frame.contentWindow.Blob([code], { type: "text/javascript" }));
  const worker = new frame.contentWindow.Worker(blob);
  worker.onmessage = (e) => { document.getElementById("worker").textContent = e.data || "none"; };
  worker.onerror = () => { document.getElementById("worker").textContent = "error"; };
</script>`,
);

// A third-party frame's own write stays out of its mirror only once the window runs on this document's config.
const REUSE_CHILD = page(
  "Reuse child",
  `<script>
  document.cookie = "own=1; path=/";
  parent.postMessage({ cookie: document.cookie, href: location.href, reused: window.mark === "reused" }, "*");
</script>`,
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

/** A srcdoc document whose first script reports whether the runtime is in place and what its realm reaches. */
const srcdocReport = (id: string): string =>
  `<p>${id}</p><script>${PROBE}
(async () => {
  const hooked = Object.getOwnPropertyDescriptor(window, "__g$") !== undefined;
  const base = document.baseURI;
  parent.postMessage(JSON.stringify({ id: ${JSON.stringify(id)}, hooked, base, probe: await girProbe(window) }), "*");
})();</script>`;

const DOORS_SRCDOC = page(
  "Doors srcdoc",
  `<base href="https://cdn.site-a.test/d/"><pre id="results"></pre><pre id="readback"></pre>
<script>
  const seen = {};
  addEventListener("message", (event) => {
    const report = JSON.parse(event.data);
    seen[report.id] = { hooked: report.hooked, base: report.base, probe: report.probe };
    if (Object.keys(seen).length === 3) document.getElementById("results").textContent = JSON.stringify(seen);
  });
  const docs = ${JSON.stringify({ property: srcdocReport("property"), attribute: srcdocReport("attribute") }).replace(/<\//g, "<\\/")};
  const byProperty = document.createElement("iframe");
  byProperty.srcdoc = docs.property;
  document.body.appendChild(byProperty);
  const byAttribute = document.createElement("iframe");
  byAttribute.setAttribute("srcdoc", docs.attribute);
  document.body.appendChild(byAttribute);
  document.getElementById("readback").textContent = JSON.stringify({
    property: byProperty.srcdoc === docs.property,
    attribute: byAttribute.getAttribute("srcdoc") === docs.attribute,
    markup: !document.body.innerHTML.includes("data-" + "girici") && !byProperty.outerHTML.includes("data-" + "girici"),
  });
</script>
<iframe srcdoc="${escapeHtml(srcdocReport("parsed"))}"></iframe>`,
);

/**
 * A blob page that reports the address it sees and what its realm reaches; a popup names itself by its opener.
 * WebKit gives blob documents a cache storage that refuses every call, so a refusal counts as reaching no cache.
 */
const blobReport = (id: string): string =>
  `<!doctype html><p>${id}</p><script>${PROBE}
(async () => {
  const keys = () => Promise.resolve().then(() => caches.keys()).catch(() => []);
  const scope = { indexedDB, BroadcastChannel, caches: { keys } };
  const report = { id: opener ? "popup" : ${JSON.stringify(id)}, ran: true, href: location.href, probe: await girProbe(scope) };
  (opener || parent).postMessage(JSON.stringify(report), "*");
})();</script>`;

const DOORS_BLOBS = page(
  "Doors blobs",
  `<button id="start">start</button><pre id="results"></pre>
<a id="dl" download="x.txt">download</a>
<script>
  const docs = ${JSON.stringify({
    html: blobReport("html"),
    untyped: blobReport("untyped"),
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>parent.postMessage("svg ran", "*")</script></svg>',
  }).replace(/<\//g, "<\\/")};
  const blobUrl = (text, type) => URL.createObjectURL(type === undefined ? new Blob([text]) : new Blob([text], { type }));
  document.getElementById("dl").href = blobUrl("hello", "text/plain");
  const seen = {};
  let svgRan = false;
  addEventListener("message", (event) => {
    if (event.data === "svg ran") svgRan = true;
    else {
      try {
        const report = JSON.parse(event.data);
        seen[report.id] = { ran: report.ran, href: report.href, probe: report.probe };
      } catch {}
    }
  });
  const frameOf = (set) => {
    const frame = document.createElement("iframe");
    set(frame);
    document.body.appendChild(frame);
    return frame;
  };
  // True when this page can read the SVG document, directly or inside the frame that shows it.
  const readable = (frame) => {
    try {
      if (frame.contentDocument?.querySelector("svg")) return true;
      const inner = frame.contentWindow.frames[0];
      return Boolean(inner?.document.querySelector("svg"));
    } catch {
      return false;
    }
  };
  document.getElementById("start").onclick = () => {
    const htmlUrl = blobUrl(docs.html, "text/html");
    const popup = open(htmlUrl);
    frameOf((frame) => (frame.src = htmlUrl));
    const svgFrame = frameOf((frame) => frame.setAttribute("src", blobUrl(docs.svg, "image/svg+xml")));
    frameOf((frame) => (frame.src = blobUrl(docs.untyped)));
    const started = Date.now();
    // The two pages that should run report first; the others get two more seconds to show they stay inert.
    const finish = () => {
      if ((!seen.html || !seen.popup) && Date.now() - started < 10000) return void setTimeout(finish, 100);
      setTimeout(() => {
        popup?.close();
        document.getElementById("results").textContent = JSON.stringify({
          html: seen.html ?? null,
          svgRan,
          untypedRan: Boolean(seen.untyped),
          popup: seen.popup ?? null,
          svgReadable: readable(svgFrame),
        });
      }, 2000);
    };
    finish();
  };
</script>`,
);

// Each sink loads an SVG whose script would report its name; a swapped sink shows it sandboxed instead.
const DOORS_BLOB_SINKS = page(
  "Doors blob sinks",
  `<button id="start">start</button><pre id="results"></pre>
<a id="ctx">context</a>
<iframe name="t-link"></iframe><iframe name="t-detached"></iframe><iframe name="t-dispatch"></iframe>
<iframe name="t-svg"></iframe><iframe name="t-xlink"></iframe><iframe name="t-form"></iframe><iframe name="t-request"></iframe>
<iframe id="nav"></iframe><iframe id="writer"></iframe><iframe name="t-docopen"></iframe>
<iframe id="meta-attr"></iframe><iframe id="meta-property"></iframe><iframe id="meta-markup"></iframe>
<iframe id="meta-space"></iframe><iframe id="meta-fraction"></iframe><iframe id="meta-quoted"></iframe>
<iframe id="meta-web"></iframe><iframe id="meta-quote-web"></iframe>
<div id="box"></div>
<script>
  const ran = [];
  addEventListener("message", (event) => {
    if (typeof event.data === "string" && event.data.startsWith("ran:")) ran.push(event.data.slice(4));
  });
  const blobOf = (text, type) => URL.createObjectURL(new Blob([text], { type }));
  const svg = (id) =>
    blobOf('<svg xmlns="http://www.w3.org/2000/svg"><script>top.postMessage("ran:' + id + '", "*")<\\/script></svg>', "image/svg+xml");
  document.getElementById("ctx").href = blobOf('<!doctype html><p id="opened">opened</p>', "text/html");
  const SVG = "http://www.w3.org/2000/svg";
  const XLINK = "http://www.w3.org/1999/xlink";
  const byId = (id) => document.getElementById(id);
  const add = (element, parent = document.body) => parent.appendChild(element);
  const readBack = {};
  byId("start").onclick = () => {
    const property = document.createElement("iframe");
    const propertyUrl = svg("property");
    property.src = propertyUrl;
    add(property);
    readBack.property = property.src === propertyUrl && property.getAttribute("src") === propertyUrl;

    const byNode = document.createElement("iframe");
    const node = document.createAttribute("src");
    const nodeUrl = svg("attr");
    node.value = nodeUrl;
    byNode.setAttributeNode(node);
    add(byNode);
    readBack.attr = byNode.getAttributeNode("src").value === nodeUrl;

    const object = document.createElement("object");
    const objectUrl = svg("object");
    object.data = objectUrl;
    add(object);
    readBack.object = object.data === objectUrl;
    const embed = document.createElement("embed");
    const embedUrl = svg("embed");
    embed.src = embedUrl;
    add(embed);
    readBack.embed = embed.src === embedUrl;

    byId("nav").contentWindow.location.href = svg("location");

    const box = byId("box");
    const markupUrl = svg("innerHTML");
    box.innerHTML = '<iframe src="' + markupUrl + '"></iframe>';
    readBack.markup = box.innerHTML.includes(markupUrl) && box.firstChild.src === markupUrl;
    box.insertAdjacentHTML("beforeend", '<iframe src="' + svg("insertAdjacentHTML") + '"></iframe>');
    add(document.createElement("div"), box).outerHTML = '<iframe src="' + svg("outerHTML") + '"></iframe>';
    box.appendChild(document.createRange().createContextualFragment('<iframe src="' + svg("fragment") + '"></iframe>'));
    const parsed = new DOMParser().parseFromString('<iframe src="' + svg("DOMParser") + '"></iframe>', "text/html");
    box.appendChild(document.adoptNode(parsed.body.firstChild));
    const written = byId("writer").contentDocument;
    written.write('<iframe src="' + svg("write") + '"></iframe>');
    written.close();

    const link = document.createElement("a");
    const linkUrl = svg("link");
    link.href = linkUrl;
    link.target = "t-link";
    link.addEventListener("click", () => {
      readBack.link = link.href === linkUrl && link.getAttribute("href") === linkUrl;
    });
    add(link).click();
    const detached = document.createElement("a");
    detached.href = svg("detached");
    detached.target = "t-detached";
    detached.click();
    const dispatched = document.createElement("a");
    dispatched.href = svg("dispatch");
    dispatched.target = "t-dispatch";
    dispatched.dispatchEvent(new MouseEvent("click"));

    const root = add(document.createElementNS(SVG, "svg"));
    const svgLink = document.createElementNS(SVG, "a");
    svgLink.setAttribute("href", svg("svg-href"));
    svgLink.setAttribute("target", "t-svg");
    add(svgLink, root).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const xlink = document.createElementNS(SVG, "a");
    xlink.setAttributeNS(XLINK, "xlink:href", svg("svg-xlink"));
    xlink.setAttribute("target", "t-xlink");
    add(xlink, root).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const form = add(document.createElement("form"));
    form.action = svg("form-submit");
    form.target = "t-form";
    form.submit();
    const requested = add(document.createElement("form"));
    requested.setAttribute("action", svg("form-request"));
    requested.target = "t-request";
    requested.requestSubmit();

    // Each runs in a frame of its own, since it navigates the window it runs in.
    window.svgBlob = svg;
    const frameRun = (code) => {
      const frame = document.createElement("iframe");
      frame.srcdoc = "<script>" + code + "<\\/script>";
      add(frame);
    };
    frameRun("location = parent.svgBlob('location-assign')");
    frameRun("location &&= parent.svgBlob('location-and')");
    frameRun("[location] = [parent.svgBlob('location-pattern')]");
    document.open(svg("document-open"), "t-docopen", "");
    frameRun("if (window.navigation) Object.getPrototypeOf(navigation).navigate.call(navigation, parent.svgBlob('navigation-proto'))");

    // Parsers the HTML sinks do not see; their nodes meet the insertion backstop.
    const XHTML = "http://www.w3.org/1999/xhtml";
    const xml = (markup) => new DOMParser().parseFromString(markup, "application/xml").documentElement;
    box.appendChild(document.importNode(xml('<iframe xmlns="' + XHTML + '" src="' + svg("xml-parser") + '"/>'), true));
    const xmlSrcdoc = "&lt;script&gt;location = parent.svgBlob('xml-srcdoc')&lt;/script&gt;";
    box.appendChild(document.importNode(xml('<iframe xmlns="' + XHTML + '" srcdoc="' + xmlSrcdoc + '"/>'), true));
    const request = new XMLHttpRequest();
    request.open("GET", "data:text/html," + encodeURIComponent('<iframe src="' + svg("xhr-document") + '"></iframe>'));
    request.responseType = "document";
    request.onload = () => box.appendChild(document.importNode(request.response.body.firstChild, true));
    request.send();

    const refresh = (id) => byId(id).contentDocument;
    const byAttribute = refresh("meta-attr").createElement("meta");
    byAttribute.setAttribute("http-equiv", "refresh");
    byAttribute.setAttribute("content", "0;url=" + svg("meta-attr"));
    refresh("meta-attr").head.appendChild(byAttribute);
    const byProperty = refresh("meta-property").createElement("meta");
    byProperty.content = "0; url=" + svg("meta-property");
    byProperty.httpEquiv = "refresh";
    refresh("meta-property").head.appendChild(byProperty);
    refresh("meta-markup").body.innerHTML = '<meta http-equiv="refresh" content="0;url=' + svg("meta-markup") + '">';
    // Spellings the browser's refresh parser accepts.
    refresh("meta-space").body.innerHTML = '<meta http-equiv="refresh" content="0 url=' + svg("meta-space") + '">';
    const fraction = refresh("meta-fraction").createElement("meta");
    fraction.setAttribute("http-equiv", "refresh");
    fraction.setAttribute("content", ".5;url=" + svg("meta-fraction"));
    refresh("meta-fraction").head.appendChild(fraction);
    const quoted = refresh("meta-quoted").createElement("meta");
    quoted.httpEquiv = "refresh";
    quoted.content = "0;url='" + svg("meta-quoted") + "' x";
    refresh("meta-quoted").head.appendChild(quoted);
    refresh("meta-web").body.innerHTML = '<meta http-equiv="refresh" content="0 url=https://site-b.test/">';
    // A target that itself starts with a quote, which a rewritten value must not hand back to the parser.
    const quoteWeb = refresh("meta-quote-web").createElement("meta");
    quoteWeb.setAttribute("http-equiv", "refresh");
    quoteWeb.setAttribute("content", '0; url="' + "'//site-b.test/" + '"');
    refresh("meta-quote-web").head.appendChild(quoteWeb);

    setTimeout(() => (byId("results").textContent = JSON.stringify({ ran: ran.sort(), readBack })), 4000);
  };
</script>`,
);

const ATTR_NODE = page(
  "Attr node",
  `<script>
  const byNode = document.createElement("iframe");
  const node = document.createAttribute("src");
  node.value = "https://site-b.test/";
  byNode.id = "by-node";
  byNode.setAttributeNode(node);
  document.body.appendChild(byNode);
  const byMap = document.createElement("iframe");
  const named = document.createAttribute("src");
  named.value = "https://site-b.test/";
  byMap.id = "by-map";
  byMap.attributes.setNamedItem(named);
  document.body.appendChild(byMap);
  const doc = "<p id='doc'>doc</p><script>document.getElementById('doc').textContent = location.hostname<\\/script>";
  const bySrcdoc = document.createElement("iframe");
  const written = document.createAttribute("srcdoc");
  written.value = doc;
  bySrcdoc.id = "by-srcdoc";
  bySrcdoc.setAttributeNode(written);
  document.body.appendChild(bySrcdoc);
  const moved = document.createElement("iframe");
  moved.id = "moved-srcdoc";
  bySrcdoc.removeAttributeNode(written);
  moved.setAttributeNode(written);
  document.body.appendChild(moved);
  const readback = document.createElement("p");
  readback.id = "readback";
  readback.textContent = JSON.stringify({
    node: written.value === doc,
    attribute: moved.getAttribute("srcdoc") === doc,
    property: moved.srcdoc === doc,
    markup: !moved.outerHTML.includes("data-" + "girici"),
  });
  document.body.appendChild(readback);
</script>`,
);

/** Replaces the built-ins the engine's URL checks once leaned on, then navigates to site-b every way it can. */
const DOORS_BUILTINS = page(
  "Doors built-ins",
  `<a id="link">b</a><iframe id="frame"></iframe>
<button id="assign">assign</button><button id="open">open</button><button id="frame-src">frame</button>
<script>
  const startsWith = String.prototype.startsWith;
  String.prototype.startsWith = function (prefix, position) {
    return prefix === "#" || startsWith.call(this, prefix, position);
  };
  const exec = RegExp.prototype.exec;
  RegExp.prototype.exec = function (text) {
    return this.source.slice(-2) === "*:" ? ["javascript:"] : exec.call(this, text);
  };
  window.URL = class extends URL {
    get protocol() {
      return "x:";
    }
  };
  document.getElementById("link").href = "https://site-b.test/";
  document.getElementById("assign").addEventListener("click", () => location.assign("https://site-b.test/"));
  document.getElementById("open").addEventListener("click", () => window.open("https://site-b.test/"));
  document.getElementById("frame-src").addEventListener("click", () => {
    document.getElementById("frame").src = "https://site-b.test/frame";
  });
</script>`,
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
    "/cookie/click": html(COOKIE_CLICK),
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
    "/abortable/aborted": abortable.check,
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
    "/pm-touch": html(PM_TOUCH),
    "/top-host": html(TOP_HOST),
    "/cross-popup": html(CROSS_POPUP),
    "/storage-events": html(STORAGE_EVENTS),
    "/blob-frame": html(BLOB_FRAME),
    "/xs-hooks": html(XS_HOOKS),
    "/xs-opener": html(XS_OPENER),
    "/xs-held": html(XS_HELD),
    "/xs-sealed-opener": html(XS_SEALED_OPENER),
    "/xs-js-host": html(XS_JS_HOST),
    "/served-blobs": html(SERVED_BLOBS),
    "/refresh-quote": html(REFRESH_QUOTE),
    "/refresh-quote-host": html(REFRESH_QUOTE_HOST),
    "/iterator-adoption": html(ITERATOR_ADOPTION),
    "/ws-binary": html(WS_BINARY),
    "/ws-frame": html(WS_FRAME),
    "/served-blob-frame": servedBlob("frame"),
    "/served-blob-meta": servedBlob("meta"),
    "/served-blob-header": servedBlob("header"),
    "/embed-storage": html(EMBED_STORAGE),
    "/reuse": html(REUSE),
    "/reuse-same": html(REUSE_SAME),
    "/reuse-same-child": html(REUSE_SAME_CHILD),
    "/blank-worker": html(BLANK_WORKER),
    "/plain.txt": typed("text/plain", PLAIN_BODY),
    "/doc.svg": typed("image/svg+xml", SVG_BODY),
    "/untyped": typed(null, PLAIN_BODY),
    "/untyped-page": typed(
      null,
      `\uFEFF\n<!DOCTYPE html><title>Untyped</title><p id="where"></p>
<script>document.getElementById("where").textContent = location.href;</script>`,
    ),
    "/cyrillic.txt": (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain; charset=windows-1251" });
      // "Привет" in windows-1251.
      res.end(Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]));
    },
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
    "/worker-kinds": html(
      page(
        "Worker kinds",
        `<p id="module"></p><p id="blob"></p><p id="nested"></p>
<script>
  const show = (id, worker) => {
    worker.onmessage = (e) => { document.getElementById(id).textContent = e.data || "none"; };
    worker.onerror = () => { document.getElementById(id).textContent = "error"; };
  };
  const echo = 'fetch("/cookie/echo", { credentials: "include" }).then((r) => r.text()).then((t) => postMessage(t));';
  show("module", new Worker("/worker-cookie.js", { type: "module" }));
  show("blob", new Worker(URL.createObjectURL(new Blob([echo], { type: "text/javascript" }))));
  show("nested", new Worker("/worker-nest-cookie.js"));
</script>`,
      ),
    ),
    "/worker-nest-cookie.js": script(
      'const inner = new Worker("/worker-cookie.js");\ninner.onmessage = (e) => postMessage(e.data);\ninner.onerror = () => postMessage("error");',
    ),
    "/worker-forge": html(
      page(
        "Worker forge",
        `<p id="worker"></p>
<script>
  const query = new URLSearchParams(location.search);
  const proxy = query.get("proxy");
  const blobOf = (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const forge =
    'fetch("https://site-b.test/cookie/echo", { credentials: "include", referrer: ' +
    JSON.stringify(proxy + "/~/https/site-b.test/") +
    ' }).then((r) => r.text()).then((t) => postMessage(t));';
  // The nested form starts the forging worker from inside another worker.
  const code = query.has("nested")
    ? 'const inner = new Worker(' + JSON.stringify(blobOf(forge)) + '); inner.onmessage = (e) => postMessage(e.data);'
    : forge;
  const w = new Worker(blobOf(code));
  w.onmessage = (e) => { document.getElementById("worker").textContent = e.data || "none"; };
</script>`,
      ),
    ),
    "/doors-workers": html(DOORS_WORKERS),
    "/doors-frames": html(DOORS_FRAMES),
    "/doors-srcdoc": html(DOORS_SRCDOC),
    "/doors-builtins": html(DOORS_BUILTINS),
    "/doors-blobs": html(DOORS_BLOBS),
    "/doors-blob-sinks": html(DOORS_BLOB_SINKS),
    "/attr-node": html(ATTR_NODE),
    "/probe-worker.js": script(PROBE_WORKER),
    "/nest.js": script(
      'const inner = new Worker("/probe-worker.js");\ninner.onmessage = (event) => postMessage(event.data);\ninner.onerror = () => postMessage("error");',
    ),
    "/sealed/page": sealedPage,
    "/sealed/dot.png": png,
    "/sealed/mod.js": script('document.body.dataset.mod = "1";'),
    "/sealed/spa": sealedCookie(SEALED_SPA),
    "/sealed/next": html(page("Sealed next", SEALED_ECHO)),
    "/sealed/search": sealedSearch,
  },
  "www.site-a.test": {
    "/landing": html(page("Landing", "<h1>Landing</h1>")),
    "/cookie/whoami": whoami,
    "/storage": html(STORAGE),
    "/sealed/cookie-echo": cookieEcho,
  },
  "cdn.site-a.test": { "/b.png": png, "/style.css": css("#external { background-image: url(/b.png); }") },
  "site-b.test": {
    "/": html(page("Site B", "<h1>Site B</h1>")),
    "/target": html(page("Target", "<h1>Target</h1>")),
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
    "/pm-touch-child": html(PM_SOURCE_CHILD),
    "/top-probe": html(TOP_PROBE),
    "/storage-events": html(STORAGE_EVENTS),
    "/xs-child": html(XS_CHILD),
    "/xs-opened": html(XS_OPENED),
    "/xs-js-child": html(XS_JS_CHILD),
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
