import { html, page, script } from "../sites.ts";
import type { CompatRoutes } from "./index.ts";

/** `#count` shows how many tabs the worker has seen, `#where` the address the worker believes it runs at. */
const SHARED_COUNT = page(
  "Shared count",
  `<p id="count"></p><p id="where"></p>
<script>
  const worker = new SharedWorker("/shared-count.js");
  const answers = ["count", "where"];
  worker.onerror = () => (document.getElementById("count").textContent = "error");
  worker.port.onmessage = (event) => (document.getElementById(answers.shift()).textContent = event.data);
  worker.port.postMessage("count");
  worker.port.postMessage("where");
</script>`,
);

const SHARED_COUNT_JS = `let n = 0;
onconnect = (e) => {
  n++;
  const p = e.ports[0];
  p.onmessage = (m) => p.postMessage(m.data === "where" ? location.href : String(n));
};`;

const SHARED_FRAME = page("Shared frame", `<iframe id="frame" src="https://site-a.test/shared-count"></iframe>`);

const sharedCount = { "/shared-count": html(SHARED_COUNT), "/shared-count.js": script(SHARED_COUNT_JS) };

export const ROUTES: CompatRoutes = {
  "site-a.test": sharedCount,
  "site-b.test": { ...sharedCount, "/shared-frame": html(SHARED_FRAME) },
};
