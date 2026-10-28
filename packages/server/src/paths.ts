import { resolve } from "node:path";

/** Resolves the same from src/ (dev) and dist/ (build), so the working directory does not matter. */
export const webDistDir = resolve(import.meta.dirname, "../../web/dist");
export const engineBundlesDir = resolve(import.meta.dirname, "../../engine/dist/bundles");
// Writable out of the box for local runs; Docker overrides it with GIRICI_DATA_DIR=/data.
export const defaultDataDir = resolve(import.meta.dirname, "../../../.data");
