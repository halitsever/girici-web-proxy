import { html, page, script, type Route } from "../sites.ts";
import type { CompatRoutes } from "./index.ts";

const WS_ECHO = page(
  "Socket echo",
  `<pre id="text"></pre><pre id="binary"></pre>
<script>
  const socket = new WebSocket("wss://site-a.test/echo-socket");
  socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    socket.send("hello");
    socket.send(new Uint8Array([1, 2, 3]));
  };
  socket.onmessage = (event) => {
    if (typeof event.data === "string") document.getElementById("text").textContent = event.data;
    else document.getElementById("binary").textContent = new Uint8Array(event.data).join(",");
  };
</script>`,
);

// The id reaches the fixture socket, which logs how the client closed under it.
const WS_CLOSE = page(
  "Socket close",
  `<p id="state">connecting</p><pre id="closed"></pre>
<button id="client-close">client close</button>
<button id="server-close">server close</button>
<button id="drop">drop</button>
<script>
  const id = new URLSearchParams(location.search).get("id") ?? "";
  const socket = new WebSocket("wss://site-a.test/echo-socket?id=" + encodeURIComponent(id));
  socket.onopen = () => {
    document.getElementById("state").textContent = "open";
  };
  socket.onclose = (event) => {
    document.getElementById("closed").textContent = \`\${event.code} \${event.reason}\`;
  };
  document.getElementById("client-close").onclick = () => socket.close(4001, "bye");
  document.getElementById("server-close").onclick = () => socket.send("close:4002:srv");
  document.getElementById("drop").onclick = () => socket.send("drop");
</script>`,
);

// Relative and http(s) addresses connect as the browser maps them; other schemes and fragments throw.
const WS_URLS = page(
  "Socket addresses",
  `<pre id="urls"></pre>
<script>
  const result = {};
  const thrown = (url) => {
    try {
      new WebSocket(url);
      return "none";
    } catch (error) {
      return error.name;
    }
  };
  result.ftp = thrown("ftp://site-a.test/echo-socket");
  result.fragment = thrown("/echo-socket#x");
  const echo = (url) =>
    new Promise((resolve) => {
      const socket = new WebSocket(url);
      socket.onopen = () => socket.send("hello");
      socket.onmessage = (event) => {
        socket.close();
        resolve(socket.url + " " + event.data);
      };
      socket.onerror = () => resolve(socket.url + " error");
    });
  Promise.all([echo("/echo-socket"), echo("https://site-a.test/echo-socket")]).then(([relative, https]) => {
    Object.assign(result, { relative, https });
    document.getElementById("urls").textContent = JSON.stringify(result);
  });
</script>`,
);

const WS_WORKER = page(
  "Worker socket",
  `<pre id="worker"></pre>
<script>
  const worker = new Worker("/ws-worker.js");
  worker.onmessage = (event) => {
    document.getElementById("worker").textContent = JSON.stringify(event.data);
  };
</script>`,
);

// Asks for its cookie, has the server close it, then reconnects once.
const WS_WORKER_SCRIPT = `const result = {};
function connect(first) {
  const socket = new WebSocket("wss://site-a.test/echo-socket");
  socket.onopen = () => socket.send(first ? "cookie?" : "hello");
  socket.onmessage = (event) => {
    if (first) {
      result.cookie = event.data;
      socket.send("close:4002:again");
    } else {
      result.reconnected = event.data;
      socket.close();
      postMessage(result);
    }
  };
  socket.onclose = (event) => {
    if (!first) return;
    result.closed = event.code;
    connect(false);
  };
}
connect(true);`;

const wsWorkerPage: Route = (_req, res) => {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "set-cookie": "ws=1; Path=/; Secure; SameSite=Lax",
  });
  res.end(WS_WORKER);
};

// A nested worker asks for the cookie and Origin its socket carried.
const WS_NESTED = page(
  "Nested worker socket",
  `<pre id="nested"></pre>
<script>
  const worker = new Worker("/ws-nested-outer.js");
  worker.onmessage = (event) => {
    document.getElementById("nested").textContent = JSON.stringify(event.data);
  };
</script>`,
);

const WS_NESTED_OUTER = `const inner = new Worker("/ws-nested-inner.js");
inner.onmessage = (event) => postMessage(event.data);`;

const WS_NESTED_INNER = `const socket = new WebSocket("wss://site-a.test/echo-socket");
const result = {};
socket.onopen = () => socket.send("cookie?");
socket.onmessage = (event) => {
  if (event.data.startsWith("cookie:")) {
    result.cookie = event.data;
    socket.send("origin?");
    return;
  }
  result.origin = event.data;
  socket.close();
  postMessage(result);
};`;

const wsNestedPage: Route = (_req, res) => {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "set-cookie": "ws=1; Path=/; Secure; SameSite=Lax",
  });
  res.end(WS_NESTED);
};

const RTC_WORKER = page(
  "Worker transports",
  `<pre id="rtc"></pre>
<script>
  const worker = new Worker("/rtc-worker.js");
  worker.onmessage = (event) => {
    const frame = document.createElement("iframe");
    frame.src = "about:blank";
    document.body.appendChild(frame);
    const results = { ...event.data, page: typeof RTCPeerConnection, frame: typeof frame.contentWindow.RTCPeerConnection };
    document.getElementById("rtc").textContent = JSON.stringify(results);
  };
</script>`,
);

const RTC_WORKER_SCRIPT = `postMessage({
  webTransport: typeof WebTransport,
  webSocketStream: typeof WebSocketStream,
  rtc: typeof RTCPeerConnection,
});`;

export const ROUTES: CompatRoutes = {
  "site-a.test": {
    "/ws-echo": html(WS_ECHO),
    "/ws-close": html(WS_CLOSE),
    "/ws-urls": html(WS_URLS),
    "/ws-worker": wsWorkerPage,
    "/ws-worker.js": script(WS_WORKER_SCRIPT),
    "/ws-nested": wsNestedPage,
    "/ws-nested-outer.js": script(WS_NESTED_OUTER),
    "/ws-nested-inner.js": script(WS_NESTED_INNER),
    "/rtc-worker": html(RTC_WORKER),
    "/rtc-worker.js": script(RTC_WORKER_SCRIPT),
  },
};
