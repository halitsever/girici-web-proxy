import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// The hash in each name lets the server cache it forever and the workers inject the matching copy.
const workerRuntimeOptions = {
  ...common,
  entryPoints: { worker: "src/client/worker-runtime.ts" },
  entryNames: "[name].[hash]",
  metafile: true,
};

function clientOptions(workerPath) {
  return {
    ...common,
    entryPoints: { client: "src/client/index.ts" },
    entryNames: "[name].[hash]",
    define: { __GIRICI_WORKER__: JSON.stringify(workerPath) },
    metafile: true,
  };
}

function swBootOptions(clientPath, workerPath) {
  return {
    ...common,
    entryPoints: { sw: "src/sw/index.ts", boot: "src/boot/index.ts" },
    define: { __GIRICI_CLIENT__: JSON.stringify(clientPath), __GIRICI_WORKER__: JSON.stringify(workerPath) },
    metafile: true,
  };
}

function bundlePathOf(result, name) {
  const output = Object.keys(result.metafile.outputs).find((file) => new RegExp(`${name}\\.[^/]+\\.js$`).test(file));
  if (!output) throw new Error(`The ${name} bundle was not written`);
  return `/_g/${basename(output)}`;
}

/** Bundling copies third-party code into our files, so their license texts have to ship next to them. */
function writeLicenses(results) {
  const packages = new Set();
  for (const result of results) {
    for (const output of Object.values(result.metafile.outputs)) {
      for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
        // Tree-shaken modules contribute nothing, and nested node_modules hold separate packages.
        const match = bytesInOutput > 0 && /.*node_modules\/(?:@[^/]+\/)?[^/]+\//.exec(input);
        if (match) packages.add(match[0].slice(0, -1));
      }
    }
  }
  const entries = [...packages].sort().map((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const file = readdirSync(dir).find((name) => /^licen[cs]e(\.md|\.txt)?$/i.test(name));
    const text = file ? readFileSync(join(dir, file), "utf8").trim() : `License: ${manifest.license}`;
    return `== ${manifest.name}@${manifest.version} (${manifest.license}) ==\n\n${text}\n`;
  });
  writeFileSync(join(OUT_DIR, "THIRD_PARTY_LICENSES.txt"), entries.join("\n"));
}

function removeOldBundles() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const file of readdirSync(OUT_DIR)) {
    if (file.startsWith("client.") || file.startsWith("worker.")) rmSync(join(OUT_DIR, file));
  }
}

const onEnd = (handler) => ({
  name: "on-end",
  setup: (builder) => builder.onEnd((result) => (result.errors.length === 0 ? handler(result) : undefined)),
});

removeOldBundles();
if (process.argv.includes("--watch")) {
  // Dev chain worker-runtime -> client -> sw/boot: an upstream rebuild refreshes the hashed paths downstream.
  let clientContext;
  let swContext;
  let workerPath;
  let clientPath;
  const rebuildSw = async (path) => {
    if (path === clientPath) return;
    clientPath = path;
    await swContext?.dispose();
    swContext = await context(swBootOptions(clientPath, workerPath));
    await swContext.watch();
  };
  const rebuildClient = async (path) => {
    if (path === workerPath) return;
    workerPath = path;
    await clientContext?.dispose();
    clientContext = await context({
      ...clientOptions(workerPath),
      plugins: [onEnd((result) => rebuildSw(bundlePathOf(result, "client")))],
    });
    await clientContext.watch();
  };
  const workerContext = await context({
    ...workerRuntimeOptions,
    plugins: [onEnd((result) => rebuildClient(bundlePathOf(result, "worker")))],
  });
  await workerContext.watch();
} else {
  const workerRuntime = await build(workerRuntimeOptions);
  const client = await build(clientOptions(bundlePathOf(workerRuntime, "worker")));
  const swBoot = await build(swBootOptions(bundlePathOf(client, "client"), bundlePathOf(workerRuntime, "worker")));
  writeLicenses([workerRuntime, client, swBoot]);
}
