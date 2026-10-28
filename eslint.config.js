import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import skipFormatting from "@vue/eslint-config-prettier/skip-formatting";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default defineConfigWithVueTs(
  { ignores: ["**/dist/**", "**/node_modules/**", "coverage/**", "test-results/**", "playwright-report/**", "packages/web/src/components/ui/**"] },
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  { files: ["packages/web/src/**/*.{ts,vue}"], languageOptions: { globals: globals.browser } },
  { files: ["packages/server/**/*.ts", "packages/web/*.ts", "*.{js,ts}"], languageOptions: { globals: globals.node } },
  { files: ["packages/engine/src/sw/**/*.ts"], languageOptions: { globals: globals.serviceworker } },
  { files: ["packages/engine/src/{boot,client}/**/*.ts"], languageOptions: { globals: globals.browser } },
  {
    files: ["packages/engine/src/{shared,rewrite}/**/*.ts"],
    languageOptions: { globals: globals["shared-node-browser"] },
  },
  {
    files: ["packages/engine/{scripts,test}/**/*.{ts,mjs}", "e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  skipFormatting,
);
