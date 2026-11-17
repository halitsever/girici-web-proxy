import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
// Same Geist the app ships, so the docs read as one product.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./custom.css";
import Landing from "./Landing.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Landing", Landing);
  },
} satisfies Theme;
