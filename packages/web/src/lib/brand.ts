import { ref } from "vue";

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
