import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const PACKAGE_DIR = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/;

/** Bundling copies third-party code into our files, so their license texts have to ship next to them. */
export function thirdPartyLicenses(fileName: string): Plugin {
  return {
    name: "third-party-licenses",
    generateBundle(_options, bundle) {
      const dirs = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const [id, info] of Object.entries(chunk.modules)) {
          // Tree-shaken modules contribute nothing.
          const match = info.renderedLength > 0 ? PACKAGE_DIR.exec(id.split("?")[0]!) : null;
          if (match) dirs.add(match[1]!);
        }
      }
      const entries = [...dirs].sort().map((dir) => {
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
          name: string;
          version: string;
          license?: string;
        };
        const file = readdirSync(dir).find((name) => /^licen[cs]e(\.md|\.txt)?$/i.test(name));
        const text = file ? readFileSync(join(dir, file), "utf8").trim() : `License: ${manifest.license}`;
        return `== ${manifest.name}@${manifest.version} (${manifest.license}) ==\n\n${text}\n`;
      });
      this.emitFile({ type: "asset", fileName, source: entries.join("\n") });
    },
  };
}
