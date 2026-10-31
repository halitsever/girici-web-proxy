import "@fontsource-variable/geist";
import "./assets/main.css";

import { createApp, watch } from "vue";
import App from "./App.vue";
import { applyBrandToDocument, brand, loadBrand, type BrandDocument } from "./lib/brand";
import { syncEnginePrefs } from "./lib/engine-prefs";
import { reloadThroughEngine } from "./lib/proxy";
import { loadSettings } from "./lib/settings";
import router from "./router";

void reloadThroughEngine()
  .catch(() => false)
  .then(async (reloading) => {
    if (reloading) return;
    await loadBrand();
    // BrandDocument is the narrow structural view the unit test fakes; the real Document satisfies it at run time.
    watch(brand, (next) => applyBrandToDocument(next, document as unknown as BrandDocument), { immediate: true });
    createApp(App).use(router).mount("#app");
    // A worker installed before the last settings change still holds the old choice until it hears this.
    void syncEnginePrefs(loadSettings());
  });
