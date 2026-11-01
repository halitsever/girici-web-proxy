import "@fontsource-variable/geist";
import "./assets/main.css";

import { createApp, watch } from "vue";
import App from "./App.vue";
import { getAuthState } from "./lib/auth";
import { applyBrandToDocument, brand, loadBrand, type BrandDocument } from "./lib/brand";
import { reloadThroughEngine } from "./lib/proxy";
import { loadSettings } from "./lib/settings";
import { isSiteMode, retireRootEngine, syncSettings } from "./lib/sites";
import router from "./router";

async function start(): Promise<void> {
  // The router guard reuses this cached read.
  const state = await getAuthState().catch(() => null);
  const reloading = await (isSiteMode(state) ? retireRootEngine() : reloadThroughEngine()).catch(() => false);
  if (reloading) return;
  await loadBrand();
  // BrandDocument is the narrow structural view the unit test fakes; the real Document satisfies it at run time.
  watch(brand, (next) => applyBrandToDocument(next, document as unknown as BrandDocument), { immediate: true });
  createApp(App).use(router).mount("#app");
  // The engine may still hold settings from before the last change, in a root worker or the site hosts' cookie.
  void syncSettings(loadSettings(), state);
}

void start();
