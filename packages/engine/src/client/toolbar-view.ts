/** The Girici mark from girici-icon-white.svg, without its metadata block. */
const MARK =
  '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M30 6A26 26 0 1 0 55.3 38H44.83A16 16 0 1 1 30 16Z"/><rect width="38" height="8" x="24" y="26"/></svg>';

const icon = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

const BACK = icon("M15 18l-6-6 6-6");
const FORWARD = icon("M9 18l6-6-6-6");
const RELOAD = icon("M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4");
const TRASH = icon("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13");
const CLOSE = icon("M6 6l12 12M18 6L6 18");

const button = (action: string, label: string, content: string) =>
  `<button type="button" data-action="${action}" aria-label="${label}" title="${label}">${content}</button>`;

/** Static markup only: no URLs, so nothing in it depends on the page's rewriting. */
export const TOOLBAR_HTML = `<button class="handle" type="button" aria-label="Girici toolbar">${MARK}</button>
<div class="panel" role="toolbar" aria-label="Girici" hidden>
${button("home", "Girici home", MARK)}${button("back", "Back", BACK)}${button("forward", "Forward", FORWARD)}${button("reload", "Reload", RELOAD)}
<input class="address" type="text" aria-label="Address" spellcheck="false" autocomplete="off" autocapitalize="off">
${button("clear", "Clear site data", TRASH)}${button("hide", "Hide toolbar", CLOSE)}
</div>
<div class="panel confirm" role="group" aria-label="Clear site data" hidden>
<span class="message"></span>
<button class="text danger" type="button" data-action="confirm-clear">Clear</button>
<button class="text" type="button" data-action="cancel-clear">Cancel</button>
</div>`;

export const TOOLBAR_CSS = `
:host { all: initial; position: fixed; left: 12px; bottom: 12px; z-index: 2147483647; color: #fafafa;
  font: 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
[hidden] { display: none !important; }
button { all: unset; box-sizing: border-box; display: grid; place-items: center; flex: none; width: 32px; height: 32px;
  border-radius: 8px; color: #a1a1aa; cursor: pointer; }
button:hover { color: #fafafa; background: #27272a; }
button:focus-visible, .address:focus-visible { outline: 2px solid #3d6bff; outline-offset: 1px; }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round;
  stroke-linejoin: round; }
svg.mark { fill: currentColor; stroke: none; }
.handle { border-radius: 50%; background: #0a0f1e; border: 1px solid #27272a; color: #fafafa;
  box-shadow: 0 4px 16px rgb(0 0 0 / 35%); }
.panel { display: flex; align-items: center; gap: 2px; box-sizing: border-box; height: 40px;
  width: min(560px, calc(100vw - 24px)); padding: 0 4px; background: #0a0f1e; border: 1px solid #27272a;
  border-radius: 12px; box-shadow: 0 8px 24px rgb(0 0 0 / 40%); }
.address { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: 8px;
  background: #18181b; color: #fafafa; font: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.address[aria-invalid="true"] { box-shadow: inset 0 0 0 1px #f87171; }
.message { flex: 1; min-width: 0; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button.text { width: auto; padding: 0 10px; color: #fafafa; }
button.danger { color: #f87171; }
@media print { :host { display: none; } }
`;
