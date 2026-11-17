<script setup lang="ts">
import { ArrowRight } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { getAuthState } from "@/lib/auth";
import { lang, t, type TextKey } from "@/lib/i18n";
import { openProxied, openProxiedTab, serviceWorkerSupport } from "@/lib/proxy";
import { loadHistory, rememberVisit, relativeTime, type HistoryEntry } from "@/lib/history";
import { loadSettings } from "@/lib/settings";
import { isSiteMode } from "@/lib/sites";
import { classifyInput, toProxyPath } from "@/lib/target";
import { getRandomTagline } from "@/data/taglines";

interface Row {
  index: number;
  group: "Open" | "Recent" | "Suggestions";
  key: string;
  kind: "open-url" | "open-search" | "recent" | "suggestion";
  label: string;
  path: string;
  host?: string;
  time?: string;
}

const SUGGESTIONS = [
  { name: "Wikipedia", host: "wikipedia.org" },
  { name: "YouTube", host: "youtube.com" },
  { name: "Reddit", host: "reddit.com" },
  { name: "Internet Archive", host: "archive.org" },
];

const settings = ref(loadSettings());
const history = ref<HistoryEntry[]>([]);
const tagline = getRandomTagline(lang.value);
const query = ref("");
const selectedIndex = ref(0);
const error = ref<string | null>(null);
const success = ref<string | null>(null);
// Null until the sign-in state is read, so the single-origin note does not flash in subdomain mode.
const siteMode = ref<boolean | null>(null);

const resolution = computed(() => classifyInput(query.value, settings.value.engine));
/** The address the opened page will have, split so the route Girici adds stands out. */
const preview = computed(() => {
  const res = resolution.value;
  if (res.kind !== "url" && res.kind !== "search") return null;
  const match = /^(\/~\/[^/]+\/)(.*)$/.exec(res.path);
  return match ? { host: window.location.host, route: match[1], rest: match[2] } : null;
});
/** The site's own name, so en.wikipedia.org and wikipedia.org both read as W. */
function initial(row: Row): string {
  const host = (row.host ?? row.label).replace(/^https?:\/\//, "").split("/")[0] ?? "";
  const labels = host.split(".");
  return (labels.length > 1 ? labels[labels.length - 2] : labels[0])?.charAt(0) ?? "";
}
const typing = computed(() => query.value.trim() !== "");
const tiles = computed(() => rows.value.filter((row) => row.kind === "recent" || row.kind === "suggestion"));

const badge = computed(() => {
  switch (resolution.value.kind) {
    case "url":
      return "URL";
    case "invalid":
      return t("browse.badgeInvalid");
    case "search":
      return resolution.value.engine.toUpperCase();
    default:
      return null;
  }
});

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const q = query.value.trim().toLowerCase();
  const push = (row: Omit<Row, "index">) => out.push({ ...row, index: out.length });
  const res = resolution.value;
  if (res.kind === "url") push({ group: "Open", key: "open", kind: "open-url", label: res.display, path: res.path });
  else if (res.kind === "search")
    push({
      group: "Open",
      key: "open",
      kind: "open-search",
      label: t("browse.search", { engine: res.engine, query: query.value.trim() }),
      path: res.path,
    });
  if (!q && history.value.length) {
    for (const entry of history.value.slice(0, 8)) {
      push({
        group: "Recent",
        key: `r:${entry.name}`,
        kind: "recent",
        label: entry.name,
        time: relativeTime(entry.t),
        path: toProxyPath(entry.name) ?? "",
      });
    }
  }
  for (const s of SUGGESTIONS) {
    if (!q || s.name.toLowerCase().includes(q) || s.host.includes(q)) {
      push({
        group: "Suggestions",
        key: `s:${s.host}`,
        kind: "suggestion",
        label: s.name,
        host: s.host,
        path: toProxyPath(s.host) ?? "",
      });
    }
  }
  return out;
});

const GROUP_LABELS: Record<Row["group"], TextKey> = {
  Open: "browse.groupOpen",
  Recent: "browse.groupRecent",
  Suggestions: "browse.groupSuggestions",
};

const grouped = computed(() => {
  const groups: Array<{ group: Row["group"]; items: Row[] }> = [];
  for (const row of rows.value) {
    const last = groups.at(-1);
    if (last && last.group === row.group) last.items.push(row);
    else groups.push({ group: row.group, items: [row] });
  }
  return groups;
});

watch(rows, () => {
  selectedIndex.value = 0;
});
watch(query, () => {
  error.value = null;
  success.value = null;
});

function move(delta: number) {
  const count = rows.value.length;
  if (!count) return;
  selectedIndex.value = (selectedIndex.value + delta + count) % count;
}

async function openRow(row: Row | undefined) {
  if (!row || !row.path) return;
  const support = serviceWorkerSupport({
    isSecureContext: window.isSecureContext,
    hasServiceWorker: "serviceWorker" in navigator,
  });
  if (support === "insecure") {
    error.value = t("browse.needsHttps");
    return;
  }
  if (support === "unsupported") {
    error.value = t("browse.noWorker");
    return;
  }
  error.value = null;
  const name = row.host ?? row.label;
  if (settings.value.rememberHistory && row.kind !== "recent") history.value = rememberVisit(history.value, name);
  success.value = t(settings.value.newTab ? "browse.openingTab" : "browse.opening", { name });
  try {
    if (settings.value.newTab) await openProxiedTab(row.path);
    else await openProxied(row.path);
  } catch (cause) {
    success.value = null;
    error.value = t("browse.engineFailed", { error: cause instanceof Error ? cause.message : String(cause) });
  }
}

function onSubmit() {
  const row = rows.value[selectedIndex.value];
  if (row) {
    void openRow(row);
    return;
  }
  if (resolution.value.kind === "empty") error.value = t("browse.empty");
  else if (resolution.value.kind === "invalid") error.value = t("browse.invalid");
}

function onEscape() {
  query.value = "";
  error.value = null;
  success.value = null;
}

onMounted(async () => {
  settings.value = loadSettings();
  history.value = loadHistory();
  siteMode.value = isSiteMode(await getAuthState().catch(() => null));
});
</script>

<template>
  <div class="mx-auto flex w-full max-w-[920px] flex-col px-5" style="padding-top: clamp(24px, 9vh, 96px)">
    <h1 class="max-w-[18ch] text-[clamp(34px,6vw,60px)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance">
      {{ tagline }}
    </h1>
    <p class="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-muted-foreground">{{ t("browse.lead") }}</p>

    <form class="mt-10" @submit.prevent="onSubmit">
      <div
        class="group relative flex h-[72px] items-center gap-4 overflow-hidden rounded-2xl border bg-[#0d1326] pr-3 pl-5 transition-colors focus-within:border-[#2c3a66]"
        :class="error ? 'border-[var(--gi-danger-border)]' : 'border-[#1c2440]'"
      >
        <svg viewBox="0 0 64 64" class="h-7 w-7 shrink-0" aria-hidden="true">
          <path fill="#fafafa" d="M30 6A26 26 0 1 0 55.3 38H44.83A16 16 0 1 1 30 16Z" />
          <rect width="38" height="8" x="24" y="26" fill="#3d6bff" />
        </svg>
        <input
          v-model="query"
          type="text"
          class="min-w-0 flex-1 bg-transparent text-[19px] text-foreground outline-none placeholder:text-[var(--gi-placeholder)]"
          :placeholder="t('browse.placeholder')"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          :aria-label="t('browse.inputLabel')"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.esc.prevent="onEscape"
        />
        <span
          v-if="badge"
          class="shrink-0 rounded-md border border-[var(--gi-strong)] px-2 py-1 font-mono text-[11px] text-gi-subtle"
        >
          {{ badge }}
        </span>
        <button
          type="submit"
          class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gi-brand text-white transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:bg-[#161d36] disabled:text-gi-subtle"
          :disabled="!typing"
          :aria-label="t('browse.groupOpen')"
        >
          <ArrowRight class="h-5 w-5" />
        </button>
        <!-- The route lights up while you type an address. -->
        <span
          class="absolute inset-x-0 bottom-0 h-[3px] origin-left scale-x-0 bg-gi-brand transition-transform duration-500 ease-out group-focus-within:scale-x-100 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </div>

      <p class="mt-3 flex min-h-6 flex-wrap items-center gap-x-3 font-mono text-[13px]">
        <span v-if="error" class="text-gi-danger">{{ error }}</span>
        <span v-else-if="success" class="text-gi-success">{{ success }}</span>
        <span v-else-if="preview" class="truncate text-gi-subtle">
          <span class="text-[#d4d4d8]">{{ preview.host }}</span
          ><span class="text-[#6e90ff]">{{ preview.route }}</span
          >{{ preview.rest }}
        </span>
        <span v-else class="text-gi-subtle">{{ t("browse.keys") }}</span>
      </p>

      <!-- Typing: what Enter opens, then the suggestions that match. -->
      <div v-if="typing" class="mt-4 flex flex-col gap-1">
        <button
          v-for="row in rows"
          :key="row.key"
          type="button"
          class="flex min-h-14 items-center gap-4 rounded-xl px-4 text-left transition-colors"
          :class="row.index === selectedIndex ? 'bg-[#121a33]' : 'hover:bg-[#0f1529]'"
          @mouseenter="selectedIndex = row.index"
          @click="openRow(row)"
        >
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :class="row.index === selectedIndex ? 'bg-gi-brand' : 'bg-[#2a3150]'"
            aria-hidden="true"
          />
          <span class="flex min-w-0 flex-1 flex-col">
            <span
              class="truncate text-[15px] text-[#e4e4e7]"
              :class="row.kind === 'open-url' && 'font-mono text-[14px]'"
              >{{ row.label }}</span
            >
            <span v-if="row.host" class="truncate font-mono text-[12px] text-gi-subtle">{{ row.host }}</span>
          </span>
          <span v-if="row.index === selectedIndex" class="shrink-0 font-mono text-[12px] text-gi-subtle">↵</span>
        </button>
      </div>

      <!-- Empty: one click back to recent sites, then a few to start with. -->
      <template v-else>
        <template v-for="section in grouped" :key="section.group">
          <h2 class="mt-12 mb-4 text-[13px] font-medium text-gi-subtle">{{ t(GROUP_LABELS[section.group]) }}</h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <button
              v-for="row in section.items"
              :key="row.key"
              type="button"
              class="group/tile flex min-w-0 flex-col items-start gap-5 rounded-2xl border bg-[#0c1124] p-4 text-left transition-colors hover:border-[#2c3a66] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              :class="row.index === selectedIndex && tiles.length ? 'border-[#1c2440]' : 'border-[#161d36]'"
              @click="openRow(row)"
            >
              <span class="flex w-full items-center">
                <span
                  class="grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#e4e4e7] text-[13px] font-semibold text-[#e4e4e7] uppercase transition-colors group-hover/tile:border-gi-brand"
                  aria-hidden="true"
                  >{{ initial(row) }}</span
                >
              </span>
              <span class="flex w-full min-w-0 flex-col gap-0.5">
                <span class="truncate text-[15px] font-medium text-[#e4e4e7]">{{
                  row.kind === "recent" ? row.label.replace(/^https?:\/\//, "") : row.label
                }}</span>
                <span class="truncate font-mono text-[12px] text-gi-subtle">{{ row.host ?? row.time }}</span>
              </span>
            </button>
          </div>
        </template>
      </template>
    </form>

    <p v-if="siteMode === false" class="mt-12 max-w-[68ch] text-[13px] leading-relaxed text-gi-subtle">
      {{ t("browse.sharedOrigin") }}
    </p>
  </div>
</template>
