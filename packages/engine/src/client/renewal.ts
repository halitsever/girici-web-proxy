import { PROTOCOL_VERSION, type ClientConfig } from "../shared/protocol.ts";
import { readConfig } from "./config.ts";
import type { Realm } from "./url-context.ts";

export interface EngineScript {
  src: string;
  config: string | null;
}

const CLIENT_FILE = /^\/_g\/client\.[A-Za-z0-9]+\.js$/;

/** Only the engine's own file on our origin may renew a window: every way a page inserts a script rewrites its src. */
export function engineScriptConfig(script: EngineScript | null, origin: string): ClientConfig | null {
  if (!script?.src.startsWith(`${origin}/`) || !CLIENT_FILE.test(script.src.slice(origin.length))) return null;
  const config = readConfig(script.config);
  return config.v === PROTOCOL_VERSION ? config : null;
}

/** Taken before the attribute hooks, which report a script's src as the page's real URL. */
export function captureCurrentScript(win: Realm): () => EngineScript | null {
  const currentScript = Object.getOwnPropertyDescriptor(win.Document.prototype, "currentScript")?.get;
  const src = Object.getOwnPropertyDescriptor(win.HTMLScriptElement.prototype, "src")?.get;
  const { getAttribute } = win.Element.prototype;
  return () => {
    try {
      const script = currentScript?.call(win.document) as HTMLScriptElement | null | undefined;
      if (!script || !src) return null;
      return { src: String(src.call(script)), config: getAttribute.call(script, "data-girici") };
    } catch {
      // An SVG script has no HTML src and is never the engine's.
      return null;
    }
  };
}

/** Engines differ on whether a reused window keeps its listeners, so they are added again; the browser drops repeats. */
export interface DocumentListeners {
  listen(): void;
}

/** Per-document state: a window the browser reuses for a new document runs these again with that document's config. */
export class DocumentSteps {
  readonly #steps: Array<[string, (config: ClientConfig) => void]> = [];

  add(name: string, step: (config: ClientConfig) => void): void {
    this.#steps.push([name, step]);
  }

  run(config: ClientConfig): void {
    for (const [name, step] of this.#steps) {
      try {
        step(config);
      } catch (error) {
        // One browser difference should cost one step, not the whole document.
        console.warn("Girici:", name, error);
      }
    }
  }
}
