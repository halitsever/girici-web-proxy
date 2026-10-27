import { build, context } from "esbuild";

const options = {
  entryPoints: { sw: "src/sw/index.ts", boot: "src/boot/index.ts" },
  outdir: "dist/bundles",
  bundle: true,
  // Service workers registered without type: "module" must be classic scripts.
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: "linked",
  legalComments: "linked",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
