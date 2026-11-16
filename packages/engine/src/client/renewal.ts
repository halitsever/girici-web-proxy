import { append, apply, exec, listIncludes, sliceOf, startsWith, toText } from "../shared/primordials.ts";
import { PROTOCOL_VERSION, type ClientConfig } from "../shared/protocol.ts";
import { parseConfig } from "./config.ts";
import type { Realm } from "./url-context.ts";

export interface EngineScript {
  src: string;
  config: string | null;
}

const CLIENT_FILE = /^\/_g\/client\.[A-Za-z0-9]+\.js$/;
// Taken at load: steps run on renewals, inside another site's page calls.
const warn = console.warn;
const nativeConsole = console;

/** Only the engine's own file on our origin may renew a window: every way a page inserts a script rewrites its src. */
export function engineScriptConfig(script: EngineScript | null, origin: string): ClientConfig | null {
  if (!script || !startsWith(script.src, `${origin}/`)) return null;
  if (exec(CLIENT_FILE, sliceOf(script.src, origin.length)) === null) return null;
  // A broken config must not renew the window to an empty, unblocked cookie mirror.
  const config = parseConfig(script.config);
  return config?.v === PROTOCOL_VERSION ? config : null;
}

/** Taken before the attribute hooks, which report a script's src as the page's real URL. */
export function captureCurrentScript(win: Realm): () => EngineScript | null {
  const currentScript = Object.getOwnPropertyDescriptor(win.Document.prototype, "currentScript")?.get;
  const src = Object.getOwnPropertyDescriptor(win.HTMLScriptElement.prototype, "src")?.get;
  const getAttribute = win.Element.prototype.getAttribute;
  return () => {
    try {
      // Read at call time: a reused window has a new document by then, and win.document cannot be redefined.
      const script = currentScript ? (apply(currentScript, win.document, []) as object | null) : null;
      if (!script || !src) return null;
      return {
        __proto__: null,
        src: toText(apply(src, script, [])),
        config: apply(getAttribute, script, ["data-girici"]) as string | null,
      } as EngineScript;
    } catch {
      // An SVG script has no HTML src and is never the engine's.
      return null;
    }
  };
}

/** `__g$.renew`: runs the document steps with the config of the engine script now running, if it is the engine's. */
export function createRenew(
  currentScript: () => EngineScript | null,
  origin: string,
  steps: DocumentSteps,
  accept: (config: ClientConfig) => boolean = () => true,
): () => boolean {
  return () => {
    const next = engineScriptConfig(currentScript(), origin);
    if (!next || !accept(next)) return false;
    steps.run(next);
    return true;
  };
}

/**
 * The engine script of a document that reuses a window renews the runtime already there. When that runtime cannot
 * (another engine version, a broken config), a reload gives the document a fresh window instead of the old state.
 * Chromium, Firefox and WebKit reuse only a window's initial blank document, so a reloaded page gets its own window.
 */
export function renewExisting(helpers: unknown, reload: () => void): boolean {
  let renewed = false;
  try {
    const renew = (helpers as { renew?: unknown } | null | undefined)?.renew;
    renewed = typeof renew === "function" && apply(renew, helpers, []) === true;
  } catch {
    // A runtime that fails to renew is treated like one that cannot.
  }
  if (!renewed) reload();
  return renewed;
}

/** Engines differ on whether a reused window keeps its listeners, so they are added again; the browser drops repeats. */
export interface DocumentListeners {
  listen(): void;
}

/** Per-document state: a window the browser reuses for a new document runs these again with that document's config. */
export class DocumentSteps {
  readonly #steps: Array<[string, (config: ClientConfig) => void]> = [];
  #config: ClientConfig | null = null;

  add(name: string, step: (config: ClientConfig) => void): void {
    // Install runs on page calls for a new frame, after the page may have replaced Array.prototype.push.
    append(this.#steps, [name, step]);
  }

  run(config: ClientConfig): void {
    this.#config = config;
    this.#runWhere(config, () => true);
  }

  /** Runs the named steps again with the current config, for a document that document.open cleared. */
  again(names: readonly string[]): void {
    const config = this.#config;
    if (!config) return;
    this.#runWhere(config, (name) => listIncludes(names, name));
  }

  /** Indexed without destructuring, since a page can replace the array iterator. */
  #runWhere(config: ClientConfig, wanted: (name: string) => boolean): void {
    const steps = this.#steps;
    for (let index = 0; index < steps.length; index++) {
      const entry = steps[index] as [string, (config: ClientConfig) => void];
      if (wanted(entry[0])) this.#runStep(entry[0], entry[1], config);
    }
  }

  #runStep(name: string, step: (config: ClientConfig) => void, config: ClientConfig): void {
    try {
      step(config);
    } catch (error) {
      // One browser difference should cost one step, not the whole document.
      apply(warn, nativeConsole, ["Girici:", name, error]);
    }
  }
}
