import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import skipFormatting from "@vue/eslint-config-prettier/skip-formatting";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default defineConfigWithVueTs(
  { ignores: ["**/dist/**", "**/node_modules/**", "coverage/**", "test-results/**", "playwright-report/**"] },
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  { files: ["packages/web/src/**/*.{ts,vue}"], languageOptions: { globals: globals.browser } },
  { files: ["packages/server/**/*.ts", "packages/web/*.ts", "*.{js,ts}"], languageOptions: { globals: globals.node } },
  skipFormatting,
);
