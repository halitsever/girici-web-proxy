import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");
const LABEL_SITE = join(SRC, "shared", "label-site.ts");
const PULLS_IN_PSL = /from\s+["'](?:tldts|[^"']*label-site\.ts)["']/;
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Every module the page runtime's files reach through relative imports. */
function reachedFrom(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      if (specifier?.startsWith(".")) queue.push(resolve(dirname(file), specifier));
    }
  }
  return seen;
}

describe("page runtime imports", () => {
  it("keeps the public suffix list out of the page runtime", () => {
    const files = [
      ...filesUnder(join(SRC, "client")),
      ...filesUnder(join(SRC, "shared")).filter((file) => file !== LABEL_SITE),
    ];
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(PULLS_IN_PSL);
  });

  it("reaches no module that loads the public suffix list from the page runtime", () => {
    const reached = reachedFrom(filesUnder(join(SRC, "client")));
    expect(reached.has(join(SRC, "rewrite", "html.ts"))).toBe(true);
    expect(reached.has(LABEL_SITE)).toBe(false);
    for (const file of reached) expect(readFileSync(file, "utf8"), file).not.toMatch(/from\s+["']tldts["']/);
  });
});
