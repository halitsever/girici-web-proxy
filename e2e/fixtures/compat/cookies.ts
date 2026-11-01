import { html, page, type Route } from "../sites.ts";
import type { CompatRoutes } from "./index.ts";

/** Writes go on across promise jobs, so later ones queue while the first batch is still at the worker. */
const COOKIE_BURST = page(
  "Cookie burst",
  `<a id="next" href="/cookie-seen">next</a>
<script>
  document.getElementById("next").addEventListener("click", async () => {
    for (let i = 1; i <= 40; i++) {
      document.cookie = "n=" + i;
      if (i % 10 === 0) await Promise.resolve();
    }
  });
</script>`,
);

const cookieSeen: Route = (req, res) => {
  const seen = (req.headers.cookie ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page("Cookie seen", `<p id="seen">${seen}</p>`));
};

export const ROUTES: CompatRoutes = {
  "site-a.test": {
    "/cookie-burst": html(COOKIE_BURST),
    "/cookie-seen": cookieSeen,
  },
};
