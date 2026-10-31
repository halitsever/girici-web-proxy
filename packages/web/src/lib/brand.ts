import { ref } from "vue";
import { writeError } from "./auth";

export const DEFAULT_BRAND_NAME = "Girici";
const LOGO_PREFIX = "/_g/brand/logo";

export interface Brand {
  name: string;
  logo: string | null;
}

export const DEFAULT_BRAND: Brand = { name: DEFAULT_BRAND_NAME, logo: null };

/** Only this instance's own logo path counts, so a bad response cannot point the UI elsewhere. */
export function parseBrand(value: unknown): Brand {
  const { name, logo } = (typeof value === "object" && value !== null ? value : {}) as {
    name?: unknown;
    logo?: unknown;
  };
  return {
    name: typeof name === "string" && name !== "" ? name : DEFAULT_BRAND_NAME,
    logo: typeof logo === "string" && logo.startsWith(LOGO_PREFIX) ? logo : null,
  };
}

export async function fetchBrand(fetcher: typeof fetch = fetch): Promise<Brand> {
  try {
    const res = await fetcher("/_g/brand", { headers: { accept: "application/json" } });
    return res.ok ? parseBrand(await res.json()) : DEFAULT_BRAND;
  } catch {
    return DEFAULT_BRAND;
  }
}

export const brand = ref<Brand>(DEFAULT_BRAND);

export async function loadBrand(): Promise<void> {
  brand.value = await fetchBrand();
}

export function setBrand(next: Brand): void {
  brand.value = next;
}

export interface BrandElement {
  id: string;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** The part of Document the brand touches. */
export interface BrandDocument {
  title: string;
  head: { appendChild(element: BrandElement): unknown };
  createElement(tag: "link"): BrandElement;
  querySelectorAll(selector: string): Iterable<BrandElement>;
}

const ICON_ID = "brand-icon";
// The shell's own icon links, kept so the default brand can put them back.
let removed: BrandElement[] = [];

export function applyBrandToDocument(next: Brand, doc: BrandDocument): void {
  doc.title = next.name;
  for (const link of [...doc.querySelectorAll(`#${ICON_ID}`)]) link.remove();
  if (next.logo) {
    if (removed.length === 0) {
      removed = [...doc.querySelectorAll('link[rel~="icon"]'), ...doc.querySelectorAll('link[rel="apple-touch-icon"]')];
      for (const link of removed) link.remove();
    }
    const icon = doc.createElement("link");
    icon.id = ICON_ID;
    icon.setAttribute("rel", "icon");
    icon.setAttribute("href", next.logo);
    doc.head.appendChild(icon);
    return;
  }
  for (const link of removed) doc.head.appendChild(link);
  removed = [];
}

export const LOGO_ERROR = "The logo must be a PNG, JPEG, WebP or SVG file of at most 256 KB.";
const NAME_ERROR = "The name can have up to 40 characters, without control characters.";
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_LOGO_BYTES = 262_144;

export async function readLogoFile(file: Blob): Promise<{ type: string; data: string }> {
  if (!LOGO_TYPES.includes(file.type) || file.size > MAX_LOGO_BYTES) throw new Error(LOGO_ERROR);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // Chunks keep the argument list of fromCharCode short.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: file.type, data: btoa(binary) };
}

export async function saveBrand(
  change: { name?: string | null; logo?: { type: string; data: string } | null },
  currentPassword: string,
): Promise<Brand> {
  const res = await fetch("/_g/admin/brand", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ...change, currentPassword }),
  });
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { invalid?: string };
    throw new Error(body.invalid === "name" ? NAME_ERROR : LOGO_ERROR);
  }
  if (res.status === 413) throw new Error(LOGO_ERROR);
  if (!res.ok) throw writeError(res.status, "Could not save the instance.");
  const saved = parseBrand(await res.json());
  setBrand(saved);
  return saved;
}
