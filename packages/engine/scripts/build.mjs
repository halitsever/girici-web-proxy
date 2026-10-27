import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { build, context } from "esbuild";

const OUT_DIR = "dist/bundles";

const common = {
  outdir: OUT_DIR,
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

// The hash in the client's name lets the server cache it forever and the worker inject the matching copy.
const clientOptions = {
  ...common,
  entryPoints: { client: "src/client/index.ts" },
  entryNames: "[name].[hash]",
  metafile: true,
};

function workerOptions(clientPath) {
  return {
    ...common,
    entryPoints: { sw: "src/sw/index.ts", boot: "src/boot/index.ts" },
    define: { __GIRICI_CLIENT__: JSON.stringify(clientPath) },
  };
}

function clientPathOf(result) {
  const output = Object.keys(result.metafile.outputs).find((file) => /client\.[^/]+\.js$/.test(file));
  if (!output) throw new Error("The client bundle was not written");
  return `/_g/${basename(output)}`;
}

function removeOldClients() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const file of readdirSync(OUT_DIR)) if (file.startsWith("client.")) rmSync(join(OUT_DIR, file));
}

removeOldClients();
if (process.argv.includes("--watch")) {
  let workerContext;
  let currentPath;
  const restartWorkers = {
    name: "restart-workers",
    setup(builder) {
      builder.onEnd(async (result) => {
        if (result.errors.length > 0) return;
        const clientPath = clientPathOf(result);
        if (clientPath === currentPath) return;
        currentPath = clientPath;
        await workerContext?.dispose();
        workerContext = await context(workerOptions(clientPath));
        await workerContext.watch();
      });
    },
  };
  const clientContext = await context({ ...clientOptions, plugins: [restartWorkers] });
  await clientContext.watch();
} else {
  const client = await build(clientOptions);
  await build(workerOptions(clientPathOf(client)));
}
