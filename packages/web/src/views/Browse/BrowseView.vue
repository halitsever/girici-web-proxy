<script setup lang="ts">
import { ArrowRight, Clock, Search } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { openProxied, serviceWorkerSupport, startEngine } from "@/lib/proxy";
import { loadHistory, rememberVisit, relativeTime, type HistoryEntry } from "@/lib/history";
import { loadSettings } from "@/lib/settings";
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
const tagline = getRandomTagline();
const query = ref("");
const selectedIndex = ref(0);
const error = ref<string | null>(null);
const success = ref<string | null>(null);

const resolution = computed(() => classifyInput(query.value, settings.value.engine));

const badge = computed(() => {
  switch (resolution.value.kind) {
    case "url":
      return "URL";
    case "invalid":
      return "INVALID";
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
      label: `Search ${res.engine} for “${query.value.trim()}”`,
      path: res.path,
    });
  if (!q && history.value.length) {
    for (const entry of history.value.slice(0, 3)) {
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

const grouped = computed(() => {
  const groups: Array<{ group: string; items: Row[] }> = [];
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
    error.value = "Girici needs HTTPS (or localhost) to run in this browser.";
    return;
  }
  if (support === "unsupported") {
    error.value = "This browser does not support service workers, which Girici needs.";
    return;
  }
  error.value = null;
  const name = row.host ?? row.label;
  if (settings.value.rememberHistory && row.kind !== "recent") history.value = rememberVisit(history.value, name);
  success.value = `Opening ${name}${settings.value.newTab ? " in a new tab" : ""}…`;
  try {
    if (settings.value.newTab) {
      await startEngine();
      window.open(row.path, "_blank", "noopener");
    } else {
      await openProxied(row.path);
    }
  } catch (cause) {
    success.value = null;
    error.value = `Could not start the proxy engine: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

function onSubmit() {
  const row = rows.value[selectedIndex.value];
  if (row) {
    void openRow(row);
    return;
  }
  if (resolution.value.kind === "empty") error.value = "Enter a website or search term.";
  else if (resolution.value.kind === "invalid") error.value = "That doesn’t look like a valid URL.";
}

function onEscape() {
  query.value = "";
  error.value = null;
  success.value = null;
}

onMounted(() => {
  settings.value = loadSettings();
  history.value = loadHistory();
});
</script>

<template>
  <div
    class="mx-auto flex w-full max-w-[1120px] flex-col items-center px-4"
    style="padding-top: clamp(40px, 12vh, 120px)"
  >
    <h1 class="text-center text-[clamp(26px,5vw,36px)] font-semibold tracking-[-0.035em] text-balance">
      {{ tagline }}
    </h1>
    <p class="mt-3 mb-8 text-[15px] text-muted-foreground">Type a URL or search. Everything routes through Girici.</p>

    <form
      class="w-full max-w-[620px] rounded-[14px] border bg-card shadow-[0_24px_64px_-16px_rgba(0,0,0,.6)] transition-colors"
      :class="error ? 'border-[var(--gi-danger-border)]' : 'border-border'"
      @submit.prevent="onSubmit"
    >
      <div class="flex h-[60px] items-center gap-3 border-b border-border px-4">
        <Search class="h-[18px] w-[18px] shrink-0 text-gi-subtle" />
        <input
          v-model="query"
          type="text"
          class="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-[var(--gi-placeholder)]"
          placeholder="Type a URL or search…"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          aria-label="URL or search"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.esc.prevent="onEscape"
        />
        <span
          v-if="badge"
          class="shrink-0 rounded-[5px] border border-[var(--gi-strong)] px-1.5 py-0.5 font-mono text-[11px] text-gi-subtle"
        >
          {{ badge }}
        </span>
      </div>

      <div class="flex flex-col gap-0.5 p-2">
        <template v-for="section in grouped" :key="section.group">
          <div class="px-2.5 pt-2 pb-1.5 text-[12px] font-medium text-gi-subtle">{{ section.group }}</div>
          <button
            v-for="row in section.items"
            :key="row.key"
            type="button"
            class="flex min-h-12 items-center gap-3 rounded-lg px-2.5 text-left transition-colors"
            :class="row.index === selectedIndex ? 'bg-accent' : 'hover:bg-accent'"
            @mouseenter="selectedIndex = row.index"
            @click="openRow(row)"
          >
            <span
              v-if="row.kind === 'open-url' || row.kind === 'open-search'"
              class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gi-brand text-white"
            >
              <ArrowRight class="h-4 w-4" />
            </span>
            <span
              v-else-if="row.kind === 'recent'"
              class="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-gi-subtle"
            >
              <Clock class="h-4 w-4" />
            </span>
            <span
              v-else
              class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-[11px] font-semibold text-[#d4d4d8]"
            >
              {{ row.label.charAt(0) }}
            </span>

            <span class="flex min-w-0 flex-1 flex-col">
              <span
                class="truncate text-[14px] text-[#e4e4e7]"
                :class="(row.kind === 'open-url' || row.kind === 'recent') && 'font-mono text-[13px]'"
              >
                {{ row.label }}
              </span>
              <span v-if="row.host" class="truncate font-mono text-[12px] text-gi-subtle">{{ row.host }}</span>
            </span>

            <span
              v-if="row.kind === 'open-url' || row.kind === 'open-search'"
              class="shrink-0 font-mono text-[12px] text-gi-subtle"
              >↵</span
            >
            <span v-else-if="row.time" class="shrink-0 font-mono text-[12px] text-gi-subtle">{{ row.time }}</span>
          </button>
        </template>
      </div>

      <div
        class="flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 font-mono text-[12px]"
      >
        <span v-if="error" class="text-gi-danger">{{ error }}</span>
        <span v-else-if="success" class="text-gi-success">{{ success }}</span>
        <span v-else class="text-gi-subtle">Routed via Girici</span>
        <span class="text-gi-subtle">↑↓ navigate · ↵ open · esc clear</span>
      </div>
    </form>
  </div>
</template>
