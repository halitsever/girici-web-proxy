import { runInContext, createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { rewriteJs } from "../src/rewrite/js.ts";

const VALUE = '"//evil.test/"';
// Each comment holds code that would leave the proxy if a rewrite cut the comment open.
const PAYLOAD = '"//evil.test/", b';
const COMMENTS = [`/*${PAYLOAD}*/`, `//${PAYLOAD}\n`, `<!--${PAYLOAD}\n`, `\n-->${PAYLOAD}\n`];
const FORMS = ["=", "+=", ">>>=", "&&=", "||=", "??=", "destructure", "for-of", "++", "--"];

/** Every place a comment can sit in a target, written as a template with `C` for the comment. */
const TARGETS = [
  "location C",
  "(location C)",
  "(C location)",
  "window C .location",
  "window. C location",
  "(window C).location",
  "(window).location C",
  "window[C 'location']",
  "window['location' C]",
  "(window C)['location']",
];

function source(target: string, form: string, comment: string): string {
  const t = target.replace("C", comment);
  const body =
    form === "destructure"
      ? `[${t}] = [${VALUE}];`
      : form === "for-of"
        ? `for (${t} of [${VALUE}]);`
        : form === "++" || form === "--"
          ? `${t}${form};`
          : `${t} ${form} (${comment} ${VALUE});`;
  return `var b = 0; ${body}`;
}

/** Runs rewritten code where every raw write to a Location is recorded; the helpers answer "SAFE". */
function run(code: string): unknown[] {
  const raw: unknown[] = [];
  const location = {
    set href(value: unknown) {
      raw.push(value);
    },
    get href() {
      return "https://proxy.test/~/https/site.test/";
    },
  };
  const window: Record<string, unknown> = {};
  Object.defineProperty(window, "location", { get: () => location, set: (value) => raw.push(value) });
  const helpers = {
    // A read hands back a stand-in, as the runtime's L does for a real Location.
    L: (value: unknown) => (value === location ? { href: "" } : value),
    N: () => "SAFE",
    W: (value: unknown) => value,
    D: (value: unknown) => value,
    S: () => "SAFE",
    A: () => ({
      get v() {
        return "current";
      },
      set v(_value: unknown) {},
    }),
  };
  const context: Record<string, unknown> = { __g$: helpers, window, b: 0 };
  Object.defineProperty(context, "location", { get: () => location, set: (value) => raw.push(value) });
  createContext(context);
  runInContext(code, context);
  // N's answer is the converted URL, so a write of it is the one write that may reach the real Location.
  return raw.filter((value) => value !== "SAFE");
}

describe("location rewrites with comments anywhere", () => {
  it("never lets an unconverted value reach a Location", () => {
    let valid = 0;
    let checked = 0;
    const escapes: string[] = [];
    for (const target of TARGETS) {
      for (const form of FORMS) {
        for (const comment of COMMENTS) {
          const input = source(target, form, comment);
          try {
            new Script(input);
          } catch {
            continue;
          }
          valid++;
          const output = rewriteJs(input);
          let raw: unknown[];
          try {
            raw = run(output);
          } catch (error) {
            // A runtime error in the stub world is fine; a syntax error means the rewrite broke the script.
            if (error instanceof SyntaxError) escapes.push(`${JSON.stringify(input)} broke: ${output}`);
            continue;
          }
          checked++;
          if (raw.length) escapes.push(`${JSON.stringify(input)} => ${JSON.stringify(output)} wrote ${String(raw)}`);
        }
      }
    }
    expect(escapes).toEqual([]);
    expect(valid).toBeGreaterThan(200);
    expect(checked).toBe(valid);
  });
});

describe("the reviewer's HTML comment cases", () => {
  it.each([
    'var b = 0; location <!--"//evil.test/", b\n>>>= u',
    'var b = 0; location\n--> "//evil.test/", b\n>>>= u',
    'var b = 0; location /*\n*/--> "//evil.test/", b\n>>>= u',
    'var b = 0; location <!-- "//evil.test/", b\n<<= u',
    'var b = 0; (location) <!--"//evil.test/", b\n>>>= u',
    'var a = 1, b = 0; location <!--a ? 0 : "//evil.test/", b\n+= u',
    'window<!-- . [ =\n.location = "//evil.test/"',
    'window<!--x\n["location"] = "//evil.test/"',
    'window\n--> . [\n.location.href = "//evil.test/"',
    'window.location = (u, "//evil.test/")',
    'window.location = /*x*/ ("//evil.test/")',
    "window.location++",
    "location--",
  ])("rewrites %j with nothing unconverted reaching a Location", (input) => {
    const output = rewriteJs(input);
    expect(() => new Script(output)).not.toThrow();
    expect(run(`var u = "u"; ${output}`)).toEqual([]);
  });
});
