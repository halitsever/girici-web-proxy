import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStore } from "../src/auth/store.ts";
import { BrandStore } from "../src/brand/store.ts";
import { openDb } from "../src/db/open.ts";

const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      reads.count++;
      return fs.readFileSync(...args);
    },
  };
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "girici-brand-"));
  dirs.push(dir);
  return dir;
}

describe("BrandStore", () => {
  it("changes nothing when the logo file cannot be written", () => {
    const store = new AuthStore(openDb(":memory:"));
    const dir = join(root(), "brand");
    // A file where the brand directory belongs makes every logo write fail.
    writeFileSync(dir, "x");
    const brand = new BrandStore(dir, store);
    expect(() => brand.update({ name: "New name", logo: { bytes: PNG, type: "image/png" } })).toThrow();
    expect(brand.info()).toEqual({ name: null, logo: null });
  });

  it("looks for a recorded logo whose file is gone only once", () => {
    const store = new AuthStore(openDb(":memory:"));
    const brand = new BrandStore(join(root(), "brand"), store);
    store.setBrandLogo({ type: "image/png", sha256: "a".repeat(64) });
    reads.count = 0;
    for (let index = 0; index < 3; index++) expect(brand.logo()).toBeNull();
    expect(reads.count).toBe(1);
  });
});
