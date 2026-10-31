import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { thirdPartyLicenses } from "./vite-licenses.ts";

export default defineConfig({
  plugins: [vue(), tailwindcss(), thirdPartyLicenses("_g/ui/THIRD_PARTY_LICENSES.txt")],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // Proxied sites own every other path, so our assets stay under the reserved /_g/ prefix.
    assetsDir: "_g/ui",
  },
});
