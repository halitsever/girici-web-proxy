<script setup lang="ts">
import { ArrowRight } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { getAuthState } from "@/lib/auth";
import { lang, t, type TextKey } from "@/lib/i18n";
import { openProxied, openProxiedTab, serviceWorkerSupport } from "@/lib/proxy";
import { loadHistory, rememberVisit, relativeTime, type HistoryEntry } from "@/lib/history";
import { loadSettings } from "@/lib/settings";
import { sharedInput } from "@/lib/shared";
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
const box = ref<HTMLInputElement | null>(null);
const selectedIndex = ref(0);
const error = ref<string | null>(null);
const success = ref<string | null>(null);
// Null until the sign-in state is read, so the single-origin note does not flash in subdomain mode.
const siteMode = ref<boolean | null>(null);
// Someone on a public instance who has not signed in, and may never have heard of Girici.
const visitor = ref(false);
const STEPS: ReadonlyArray<[TextKey, TextKey]> = [
  ["visitor.step1Title", "visitor.step1"],
  ["visitor.step2Title", "visitor.step2"],
  ["visitor.step3Title", "visitor.step3"],
];
const safety = computed<TextKey[]>(() => [
  "visitor.operator",
  ...(siteMode.value === false ? (["browse.sharedOrigin"] as TextKey[]) : []),
  "visitor.local",
]);

const resolution = computed(() => classifyInput(query.value, settings.value.engine));
/** The address the opened page will have, split so the route Girici adds stands out. */
const preview = computed(() => {
  const res = resolution.value;
  if (res.kind !== "url" && res.kind !== "search") return null;
  const match = /^(\/~\/[^/]+\/)(.*)$/.exec(res.path);
  return match ? { host: window.location.host, route: match[1], rest: match[2] } : null;
});
/** The host a tile opens, with any scheme and path dropped. */
function hostOf(row: Row): string {
  return (row.host ?? row.label).replace(/^https?:\/\//, "").split("/")[0] ?? "";
}

/** The site's own name, so en.wikipedia.org and wikipedia.org both read as W. */
function initial(row: Row): string {
  const labels = hostOf(row).split(".");
  return (labels.length > 1 ? labels[labels.length - 2] : labels[0])?.charAt(0) ?? "";
}

/** Icons that arrived; the letter shows until then, and for good when one never does. */
const icons = ref(new Set<string>());
const iconUrl = (row: Row) => `/_g/favicon?host=${encodeURIComponent(hostOf(row))}`;
const launching = ref(false);
const words = computed(() => tagline.split(" "));

/** Points the tile's light at the cursor. */
function spotlight(event: PointerEvent) {
  const tile = event.currentTarget as HTMLElement;
  const box = tile.getBoundingClientRect();
  tile.style.setProperty("--mx", `${event.clientX - box.left}px`);
  tile.style.setProperty("--my", `${event.clientY - box.top}px`);
}

/** The route sweeps the screen before the page opens; a new tab must open inside the click, so it skips this. */
async function launch() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  launching.value = true;
  await new Promise((resolve) => setTimeout(resolve, 520));
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
    else {
      await launch();
      await openProxied(row.path);
    }
  } catch (cause) {
    launching.value = false;
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

/** Takes a link shared from another app into the box and drops it from the address, so a reload starts clean. */
function takeShared() {
  const shared = sharedInput(new URLSearchParams(window.location.search));
  if (shared === null) return;
  query.value = shared;
  window.history.replaceState(window.history.state, "", window.location.pathname);
}

/** A touch keyboard would cover the page the moment it loads. */
function focusBox() {
  if (window.matchMedia("(pointer: fine)").matches) box.value?.focus();
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

function onSlash(event: KeyboardEvent) {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
  event.preventDefault();
  box.value?.focus();
}

function onPageShow() {
  // Back from the opened site, the page may come out of the cache with the sweep still covering it.
  launching.value = false;
  focusBox();
}

onMounted(async () => {
  takeShared();
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("keydown", onSlash);
  focusBox();
  settings.value = loadSettings();
  history.value = loadHistory();
  const state = await getAuthState().catch(() => null);
  siteMode.value = isSiteMode(state);
  visitor.value = state?.authed === false;
});

onUnmounted(() => {
  window.removeEventListener("pageshow", onPageShow);
  window.removeEventListener("keydown", onSlash);
});
</script>

<template>
  <div class="mx-auto flex w-full max-w-[920px] flex-col px-5" style="padding-top: clamp(24px, 9vh, 96px)">
    <h1 class="max-w-[18ch] text-[clamp(34px,6vw,60px)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance">
      <template v-for="(word, index) in words" :key="index"
        ><span class="word" :style="{ '--i': index }">{{ word }}</span
        >{{ index < words.length - 1 ? " " : "" }}</template
      >
    </h1>
    <p class="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-muted-foreground">{{ t("browse.lead") }}</p>

    <form class="mt-10" @submit.prevent="onSubmit">
      <div
        class="group relative flex h-[72px] items-center gap-4 overflow-hidden rounded-2xl border bg-[#0d1326] pr-3 pl-5 transition-colors focus-within:border-[#2c3a66]"
        :class="error ? 'border-[var(--gi-danger-border)]' : 'border-[#1c2440]'"
      >
        <svg viewBox="0 0 64 64" class="door h-7 w-7 shrink-0" aria-hidden="true">
          <path fill="#fafafa" d="M30 6A26 26 0 1 0 55.3 38H44.83A16 16 0 1 1 30 16Z" />
          <rect width="38" height="8" x="24" y="26" fill="#3d6bff" />
        </svg>
        <input
          ref="box"
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
        <!-- Keys mean nothing on a touch screen. -->
        <span v-else class="text-gi-subtle pointer-coarse:hidden">{{ t("browse.keys") }}</span>
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
              class="tile group/tile relative flex min-w-0 flex-col items-start gap-5 overflow-hidden rounded-2xl border bg-[#0c1124] p-4 text-left transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-[#2c3a66] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:hover:translate-y-0"
              :class="row.index === selectedIndex && tiles.length ? 'border-[#1c2440]' : 'border-[#161d36]'"
              :style="{ '--i': row.index }"
              @pointermove="spotlight"
              @click="openRow(row)"
            >
              <span class="mark relative grid h-9 w-9 place-items-center" aria-hidden="true">
                <span class="mark-ring absolute inset-0 rounded-full border-[3px] border-[#e4e4e7]" />
                <span class="mark-bar absolute top-1/2 left-1/2 h-[5px] w-[22px] -translate-y-1/2 bg-gi-brand" />
                <!-- A light disc, so dark icons such as GitHub's stay visible on Midnight. -->
                <span
                  class="mark-icon grid h-[22px] w-[22px] place-items-center rounded-full bg-[#f4f4f5]"
                  :class="icons.has(hostOf(row)) ? '' : 'absolute opacity-0'"
                >
                  <img
                    :src="iconUrl(row)"
                    alt=""
                    class="h-[14px] w-[14px] object-contain"
                    @load="icons = new Set(icons).add(hostOf(row))"
                  />
                </span>
                <span
                  v-if="!icons.has(hostOf(row))"
                  class="mark-letter text-[13px] font-semibold text-[#e4e4e7] uppercase"
                  >{{ initial(row) }}</span
                >
              </span>
              <span class="relative flex w-full min-w-0 flex-col gap-0.5">
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

    <template v-if="visitor">
      <section class="mt-24">
        <h2 class="text-[clamp(26px,3.6vw,36px)] font-semibold tracking-[-0.035em]">{{ t("visitor.howTitle") }}</h2>
        <ol class="route-line relative mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
          <li v-for="([title, text], index) in STEPS" :key="title" class="stop relative" :style="{ '--i': index }">
            <span class="stop-mark block h-[22px] w-[22px] rounded-full border-[5px] border-[#fafafa] bg-background" />
            <h3 class="mt-6 text-[18px] font-semibold tracking-[-0.01em]">{{ t(title) }}</h3>
            <p class="mt-2 max-w-[34ch] text-[15px] leading-relaxed text-muted-foreground">{{ t(text) }}</p>
          </li>
        </ol>
      </section>

      <section class="mt-24">
        <h2 class="text-[clamp(26px,3.6vw,36px)] font-semibold tracking-[-0.035em]">{{ t("visitor.safeTitle") }}</h2>
        <ul class="mt-8 grid gap-6 sm:grid-cols-2">
          <li v-for="key in safety" :key="key" class="max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground">
            <span class="mb-4 block h-1 w-7 rounded-full bg-gi-brand" aria-hidden="true" />
            {{ t(key) }}
          </li>
        </ul>
      </section>
    </template>
    <p v-else-if="siteMode === false" class="mt-12 max-w-[68ch] text-[13px] leading-relaxed text-gi-subtle">
      {{ t("browse.sharedOrigin") }}
    </p>

    <div v-if="launching" class="launch" aria-hidden="true"><span class="launch-route" /></div>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .word {
    display: inline-block;
    animation: rise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) both;
    animation-delay: calc(var(--i) * 70ms);
  }
  .door {
    animation: turn-in 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) 0.2s backwards;
    transition: transform 0.6s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .group:focus-within .door {
    transform: rotate(-360deg);
  }
  .tile {
    animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
    animation-delay: calc(0.35s + var(--i) * 45ms);
  }
}

/* The cursor carries a soft light across each tile. */
.tile::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(220px circle at var(--mx, 50%) var(--my, 50%), rgba(61, 107, 255, 0.16), transparent 70%);
  opacity: 0;
  transition: opacity 0.3s ease;
}
.tile:hover::before {
  opacity: 1;
}

/* Hovered, the letter's ring opens into the logo's door and the route slides in. */
.mark-ring {
  transition:
    border-color 0.3s ease,
    transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.mark-bar {
  transform-origin: right center;
  transform: translate(0, -50%) scaleX(0);
  transition: transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.mark-letter,
.mark-icon {
  transition: opacity 0.2s ease;
}
.tile:hover .mark-ring,
.tile:focus-visible .mark-ring {
  border-right-color: transparent;
  transform: rotate(20deg);
}
.tile:hover .mark-bar,
.tile:focus-visible .mark-bar {
  transform: translate(0, -50%) scaleX(1);
}
.tile:hover .mark-letter,
.tile:focus-visible .mark-letter,
.tile:hover .mark-icon,
.tile:focus-visible .mark-icon {
  opacity: 0;
}

/* The steps sit on the route; a light travels along it, as in the background. */
.route-line::before,
.route-line::after {
  content: "";
  position: absolute;
  pointer-events: none;
}
.route-line::before {
  top: 9px;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 999px;
  background: var(--gi-brand);
  transform-origin: left center;
}
.route-line::after {
  top: 8px;
  left: 0;
  width: 120px;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.85));
  opacity: 0;
}
.stop-mark {
  position: relative;
}
@media (max-width: 639px) {
  .route-line {
    padding-left: 40px;
  }
  .route-line::before {
    top: 0;
    bottom: 0;
    left: 9px;
    right: auto;
    width: 4px;
    height: auto;
  }
  .route-line::after {
    display: none;
  }
  .stop-mark {
    position: absolute;
    left: -40px;
    top: 0;
  }
  .stop h3 {
    margin-top: 0;
  }
}
@media (prefers-reduced-motion: no-preference) and (min-width: 640px) {
  .route-line::after {
    animation: run 4.5s cubic-bezier(0.5, 0, 0.5, 1) 1.2s infinite;
  }
  @supports (animation-timeline: view()) {
    .route-line::before {
      animation: draw linear both;
      animation-timeline: view();
      animation-range: entry 10% cover 35%;
    }
    .stop {
      animation: rise linear both;
      animation-timeline: view();
      animation-range: entry calc(10% + var(--i) * 6%) cover calc(30% + var(--i) * 6%);
    }
  }
}
@keyframes draw {
  from {
    transform: scaleX(0);
  }
}
@keyframes run {
  0% {
    opacity: 0;
    left: 0;
  }
  15%,
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    left: calc(100% - 120px);
  }
}

/* Opening a site: the route crosses the screen, then opens like a door onto the next page. */
.launch {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  align-items: center;
  pointer-events: none;
}
.launch-route {
  display: block;
  height: 6px;
  background: var(--gi-brand);
  box-shadow: 0 0 40px rgba(61, 107, 255, 0.9);
  transform-origin: left center;
  animation:
    sweep 0.26s cubic-bezier(0.6, 0, 0.2, 1) both,
    open 0.3s cubic-bezier(0.6, 0, 0.2, 1) 0.24s both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}
@keyframes turn-in {
  from {
    opacity: 0;
    transform: rotate(-120deg) scale(0.6);
  }
}
@keyframes sweep {
  from {
    transform: scaleX(0);
  }
}
@keyframes open {
  to {
    height: 100vh;
    background: var(--background);
    box-shadow: none;
  }
}
</style>
