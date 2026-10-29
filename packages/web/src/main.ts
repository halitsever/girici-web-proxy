import "@fontsource-variable/geist";
import "./assets/main.css";

import { createApp } from "vue";
import App from "./App.vue";
import { syncEnginePrefs } from "./lib/engine-prefs";
import { loadSettings } from "./lib/settings";
import router from "./router";

createApp(App).use(router).mount("#app");
// A worker installed before the last settings change still holds the old choice until it hears this.
void syncEnginePrefs(loadSettings());
