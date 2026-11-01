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
    "/ws-worker": wsWorkerPage,
    "/ws-worker.js": script(WS_WORKER_SCRIPT),
    "/rtc-worker": html(RTC_WORKER),
    "/rtc-worker.js": script(RTC_WORKER_SCRIPT),
  },
};
