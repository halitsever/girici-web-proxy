import type { IncomingMessage, ServerResponse } from "node:http";
import type { Route } from "../sites.ts";

/** Pages that prove sites stay apart in subdomain mode. Self-contained: `sites.ts` imports this module. */

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const html =
  (body: string, headers: Record<string, string> = {}): Route =>
  (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(body);
  };

const CHILD = html(page("Child", "<h1>Child</h1>"));

const FRAMES = page(
  "Frames",
  `<iframe id="b" name="bframe" src="https://site-b.test/sites/child"></iframe>
<iframe id="www" src="https://www.site-a.test/sites/child"></iframe>
<button id="probe">probe</button><pre id="results"></pre>
<script>
  const attempt = (read) => {
    try {
      read();
      return "read";
    } catch (error) {
      return error.name;
    }
  };
  document.getElementById("probe").addEventListener("click", () => {
    document.getElementById("results").textContent = JSON.stringify({
      framesDocument: attempt(() => frames[0].document.title),
      windowIndex: attempt(() => window[0].localStorage.length),
      named: attempt(() => window.bframe.document.title),
      computedLocation: attempt(() => frames[0]["loc" + "ation"].href),
      sameSite: attempt(() => frames[1].document.title),
    });
  });
</script>`,
);

const OPFS = page(
  "OPFS",
  `<p id="opfs"></p>
<script>
  const show = (text) => (document.getElementById("opfs").textContent = text);
  (async () => {
    const root = await navigator.storage.getDirectory();
    if (new URLSearchParams(location.search).has("write")) {
      const writable = await (await root.getFileHandle("secret.txt", { create: true })).createWritable();
      await writable.write("secret");
      await writable.close();
      show("written");
      return;
    }
    await root.getFileHandle("secret.txt").then(() => show("present"), () => show("missing"));
  })().catch((error) => show("error " + error.name));
</script>`,
);

// The script comes before the frame, so the listener is there when the child says it is ready.
const BLOB = page(
  "Blob",
  `<p id="blob"></p>
<script>
  const url = URL.createObjectURL(new Blob(["secret"], { type: "text/plain" }));
  addEventListener("message", (event) => {
    if (event.origin !== "https://site-b.test") return;
    if (event.data === "ready") event.source.postMessage(url, event.origin);
    else document.getElementById("blob").textContent = event.data;
  });
</script>
<iframe src="https://site-b.test/sites/blob-child"></iframe>`,
);

const BLOB_CHILD = page(
  "Blob child",
  `<script>
  addEventListener("message", async (event) => {
    if (event.origin !== "https://site-a.test") return;
    let result = "read";
    try {
      await (await fetch(event.data)).text();
    } catch {
      result = "blocked";
    }
    event.source.postMessage(result, event.origin);
  });
  parent.postMessage("ready", "https://site-a.test");
</script>`,
);

// `?popup=` names another popup, and the popup's `?opener=` the origin it answers.
const OAUTH = page(
  "OAuth",
  `<button id="open">Sign in</button><p id="opener"></p>
<script>
  const popup = new URLSearchParams(location.search).get("popup") || "https://site-b.test/sites/oauth-popup";
  document.getElementById("open").addEventListener("click", () => {
    window.open(popup);
  });
  addEventListener("message", (event) => {
    if (event.origin !== new URL(popup).origin) return;
    document.getElementById("opener").textContent = event.origin + " " + event.data.token;
    event.source.postMessage("ack", event.origin);
  });
</script>`,
);

const OAUTH_POPUP = page(
  "OAuth popup",
  `<p id="popup"></p>
<script>
  addEventListener("message", (event) => {
    document.getElementById("popup").textContent = event.data + " from " + event.origin;
  });
  opener.postMessage({ token: "t" }, new URLSearchParams(location.search).get("opener") || "https://site-a.test");
</script>`,
);

const POST = page(
  "Post",
  `<button id="send">send</button>
<script>
  document.getElementById("send").addEventListener("click", () => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "https://site-b.test/sites/echo";
    for (const [name, value] of [["q", "posted"], ["n", "ü"]]) {
      const input = document.createElement("input");
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  });
</script>`,
);

const echo: Route = (req, res, body) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page("Echo", `<pre id="echo">${escapeHtml(`${req.method ?? ""} ${body}`)}</pre>`));
};

/** Answers a credentialed read from another site, so only the jar decides which cookies it sees. */
const whoami: Route = (req, res) => {
  const origin = req.headers.origin;
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    ...(origin ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" } : {}),
  });
  res.end(page("Who am I", `<p id="cookie">${escapeHtml(req.headers.cookie ?? "")}</p>`));
};

const FETCH_A = page(
  "Fetch A",
  `<p id="seen"></p>
<script>
  const show = (text) => (document.getElementById("seen").textContent = text);
  fetch("https://site-a.test/sites/whoami", { credentials: "include" })
    .then((response) => response.text())
    .then((text) => {
      const cookie = new DOMParser().parseFromString(text, "text/html").getElementById("cookie");
      show("seen: " + (cookie ? cookie.textContent : "?"));
    })
    .catch((error) => show("error " + error.name));
</script>`,
);

const STORAGE = page(
  "Storage",
  `<p id="ls"></p>
<script>
  if (new URLSearchParams(location.search).has("set")) localStorage.setItem("k", "v");
  document.getElementById("ls").textContent = String(localStorage.getItem("k"));
</script>`,
);

export const ISOLATION_ROUTES: Record<string, Record<string, Route>> = {
  "site-a.test": {
    "/sites/frames": html(FRAMES),
    "/sites/opfs": html(OPFS),
    "/sites/blob": html(BLOB),
    "/sites/oauth": html(OAUTH),
    "/sites/post": html(POST),
    "/sites/embed-c": html(page("Embed C", '<iframe id="c" src="http://site-c.test/"></iframe>')),
    "/sites/set-cookie": html(page("Set", "<p>set</p>"), { "set-cookie": "a=1; Path=/; SameSite=None; Secure" }),
    "/sites/whoami": whoami,
    "/sites/storage": html(STORAGE),
  },
  "www.site-a.test": { "/sites/child": CHILD, "/sites/oauth-popup": html(OAUTH_POPUP) },
  "site-b.test": {
    "/sites/child": CHILD,
    "/sites/opfs": html(OPFS),
    "/sites/blob-child": html(BLOB_CHILD),
    "/sites/oauth": html(OAUTH),
    "/sites/oauth-popup": html(OAUTH_POPUP),
    "/sites/echo": echo,
    "/sites/fetch-a": html(FETCH_A),
    "/sites/storage": html(STORAGE),
  },
};
