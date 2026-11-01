import { html, page } from "../sites.ts";
import type { CompatRoutes } from "./index.ts";

const REFRESH = "0;url=https://www.site-a.test/landing";

/** Each run-time script writes the address it sees into the element its id names. */
const DYNAMIC_SCRIPTS = page(
  "Dynamic scripts",
  `<p id="tc"></p><p id="text"></p><p id="inner"></p><p id="html"></p><p id="node"></p><p id="late"></p>
<p id="module"></p><p id="data"></p><p id="readback"></p><p id="unsafe"></p><p id="parsed"></p>
<p id="jsopen"></p><p id="jsnav"></p>
<div id="unsafe-host"></div><div id="parsed-host"></div>
<button id="meta">meta</button>
<iframe id="m1" srcdoc="<p>m1</p>"></iframe>
<iframe id="m2" srcdoc="<p>m2</p>"></iframe>
<iframe id="m3" srcdoc="<p>m3</p>"></iframe>
<script>
  const code = (id) => 'document.getElementById("' + id + '").textContent = location.href';
  const show = (id, value) => (document.getElementById(id).textContent = value);
  const make = (type) => {
    const script = document.createElement("script");
    if (type) script.type = type;
    return script;
  };
  const add = (script) => document.body.appendChild(script);

  // An empty connected script runs the first text it gets, so only the setters see these.
  const tc = add(make());
  tc.textContent = code("tc");
  show("readback", String(tc.textContent === code("tc")));
  add(make()).text = code("text");
  add(make()).innerText = code("inner");
  add(make()).innerHTML = code("html");
  add(make()).appendChild(document.createTextNode(code("node")));

  // Text the hooks never saw, in a script that is not connected yet.
  const late = make();
  const lateText = document.createTextNode("");
  late.appendChild(lateText);
  lateText.data = code("late");
  add(late);

  const module = make("module");
  module.textContent = code("module");
  add(module);

  const data = make("application/json");
  data.textContent = '{"a":1}';
  add(data);
  show("data", data.textContent);

  const link = (a) => a.getAttribute("href") + " " + a.href;
  const host = document.getElementById("unsafe-host");
  if (host.setHTMLUnsafe) {
    host.setHTMLUnsafe('<a href="https://site-a.test/next">next</a>');
    show("unsafe", link(host.querySelector("a")));
  } else show("unsafe", "absent");
  if (Document.parseHTMLUnsafe) {
    const parsed = Document.parseHTMLUnsafe('<a href="https://site-a.test/next">next</a>').querySelector("a");
    show("parsed", link(parsed));
    // Adopted so the test can read the address the DOM holds.
    document.getElementById("parsed-host").append(parsed);
  } else show("parsed", "absent");

  window.jsNav = () => {
    if (!window.navigation || !navigation.navigate) return show("jsnav", "absent");
    try {
      const result = navigation.navigate("javascript:document.getElementById('jsnav').textContent = location.href; void 0");
      // Browsers refuse javascript: addresses here with NotSupportedError and run nothing.
      result.committed.catch((error) => show("jsnav", error.name === "NotSupportedError" ? "refused" : error.name));
      result.finished.catch(() => {});
    } catch (error) {
      show("jsnav", "threw " + error.name);
    }
  };
  // After load, and one after the other, so neither javascript: navigation cancels the other.
  addEventListener("load", () => {
    window.open("javascript:document.getElementById('jsopen').textContent = location.href; jsNav(); void 0", "_self");
  });

  document.getElementById("meta").addEventListener("click", () => {
    const frame = (id) => document.getElementById(id).contentDocument;
    const first = frame("m1");
    const byProperty = first.createElement("meta");
    byProperty.content = ${JSON.stringify(REFRESH)};
    byProperty.httpEquiv = "refresh";
    first.head.append(byProperty);
    const second = frame("m2");
    const byAttribute = second.createElement("meta");
    byAttribute.setAttribute("http-equiv", "refresh");
    byAttribute.setAttribute("content", ${JSON.stringify(REFRESH)});
    second.head.append(byAttribute);
    // Built by a parser the hooks never see, then inserted.
    const third = frame("m3");
    const xml = new DOMParser().parseFromString(
      '<meta xmlns="http://www.w3.org/1999/xhtml" http-equiv="refresh" content="${REFRESH}"/>',
      "application/xml",
    );
    third.head.append(third.importNode(xml.documentElement, true));
  });
</script>`,
);

export const ROUTES: CompatRoutes = {
  "site-a.test": {
    "/dynamic-scripts": html(DYNAMIC_SCRIPTS),
  },
};
