import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "selfsigned";

export const CACHE_DIR = join(import.meta.dirname, "..", ".cache");
export const CERT_PATH = join(CACHE_DIR, "fixtures-cert.pem");
const KEY_PATH = join(CACHE_DIR, "fixtures-key.pem");
export const HTTPS_HOSTS = ["site-a.test", "cdn.site-a.test", "www.site-a.test", "site-b.test"];

/** Reused between runs because generating an RSA key takes a noticeable moment. */
export async function fixtureCert(): Promise<{ key: string; cert: string }> {
  if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) {
    return { key: readFileSync(KEY_PATH, "utf8"), cert: readFileSync(CERT_PATH, "utf8") };
  }
  const pems = await generate([{ name: "commonName", value: "site-a.test" }], {
    extensions: [
      { name: "basicConstraints", cA: true },
      { name: "subjectAltName", altNames: HTTPS_HOSTS.map((value) => ({ type: 2, value })) },
    ],
  });
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CERT_PATH, pems.cert);
  writeFileSync(KEY_PATH, pems.private);
  return { key: pems.private, cert: pems.cert };
}
