import { resolve } from "node:path";

/** Resolves the same from src/ (dev) and dist/ (build), so the working directory does not matter. */
export const webDistDir = resolve(import.meta.dirname, "../../web/dist");
