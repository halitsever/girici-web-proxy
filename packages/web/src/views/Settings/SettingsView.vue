<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { Switch } from "@/components/ui/switch";
import { getAuthState, setPublicAccess } from "@/lib/auth";
import { clearHistory, loadHistory, relativeTime, removeVisit, type HistoryEntry } from "@/lib/history";
import { openProxied } from "@/lib/proxy";
import { loadSettings, saveSettings } from "@/lib/settings";
import { SEARCH_ENGINES, toProxyPath, type SearchEngine } from "@/lib/target";

const engines = Object.keys(SEARCH_ENGINES) as SearchEngine[];
const settings = ref(loadSettings());
const history = ref<HistoryEntry[]>([]);
const authed = ref(false);
const publicAccess = ref(false);
const publicError = ref("");

watch(settings, (value) => saveSettings(value), { deep: true });

async function onTogglePublic(on: boolean) {
  publicError.value = "";
  const previous = publicAccess.value;
  publicAccess.value = on;
  try {
    publicAccess.value = await setPublicAccess(on);
  } catch (e) {
    publicAccess.value = previous;
    publicError.value = e instanceof Error ? e.message : "Could not change public access.";
  }
}

async function openEntry(name: string) {
  const path = toProxyPath(name);
  if (!path) return;
  try {
    await openProxied(path);
  } catch {
    // A failed open is a no-op here; the Browse screen surfaces engine errors.
  }
}

function removeEntry(name: string) {
  history.value = removeVisit(history.value, name);
}

function onClearHistory() {
  clearHistory();
  history.value = [];
}

onMounted(async () => {
  settings.value = loadSettings();
  history.value = loadHistory();
  const state = await getAuthState(true);
  authed.value = state.authed;
  publicAccess.value = state.public;
});
</script>

<template>
  <div class="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-4" style="padding-top: clamp(28px, 6vh, 56px)">
    <div>
      <h1 class="text-[26px] font-semibold tracking-[-0.03em]">Settings</h1>
      <p class="mt-1 text-[14px] text-muted-foreground">How Girici opens and handles the sites you visit.</p>
    </div>

    <div class="divide-y divide-border rounded-xl border border-border bg-gi-panel">
      <div class="flex flex-col gap-3.5 p-5">
        <div>
          <p class="text-[14px] font-medium">Search engine</p>
          <p class="text-[13px] text-muted-foreground">Used when what you type isn't a URL.</p>
        </div>
        <div
          class="grid gap-1 rounded-[10px] border border-border bg-card p-1"
          style="grid-template-columns: repeat(auto-fit, minmax(110px, 1fr))"
        >
          <button
            v-for="engine in engines"
            :key="engine"
            type="button"
            class="h-9 rounded-[7px] text-[13px] font-medium transition-colors"
            :class="
              settings.engine === engine
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="settings.engine = engine"
          >
            {{ engine }}
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between gap-4 px-5 py-[18px]">
        <div>
          <p class="text-[14px] font-medium">Open in new tab</p>
          <p class="text-[13px] text-muted-foreground">Keep Girici open while you browse.</p>
        </div>
        <Switch v-model="settings.newTab" />
      </div>

      <div class="flex items-center justify-between gap-4 px-5 py-[18px]">
        <div>
          <p class="text-[14px] font-medium">Remember history</p>
          <p class="text-[13px] text-muted-foreground">Show recent sites in the palette. Stored on this device only.</p>
        </div>
        <Switch v-model="settings.rememberHistory" />
      </div>

      <div class="flex items-center justify-between gap-4 px-5 py-[18px]">
        <div>
          <p class="text-[14px] font-medium">Block third-party cookies</p>
          <p class="text-[13px] text-muted-foreground">Stops trackers from following you across proxied sites.</p>
        </div>
        <Switch v-model="settings.blockCookies" />
      </div>
    </div>

    <div v-if="authed" class="rounded-xl border border-border bg-gi-panel">
      <div class="px-5 pt-5">
        <p class="text-[15px] font-semibold">Admin</p>
        <p class="mt-1 text-[13px] text-muted-foreground">Operator controls for this proxy.</p>
      </div>
      <div class="mt-4 flex items-center justify-between gap-4 border-t border-border px-5 py-[18px]">
        <div>
          <p class="text-[14px] font-medium">Public access</p>
          <p class="text-[13px] text-muted-foreground">
            When on, anyone can browse without signing in. Account and admin settings still need you.
          </p>
          <p v-if="publicError" class="mt-1 text-[13px] text-gi-danger">{{ publicError }}</p>
        </div>
        <Switch :model-value="publicAccess" @update:model-value="onTogglePublic" />
      </div>
    </div>

    <div class="overflow-hidden rounded-xl border border-border bg-gi-panel">
      <div class="flex items-center justify-between px-5 py-4">
        <div>
          <p class="text-[15px] font-semibold">History</p>
          <p class="mt-1 text-[13px] text-muted-foreground">Sites you opened, on this device only.</p>
        </div>
        <button
          type="button"
          class="h-9 rounded-md border border-[var(--gi-danger-border)] px-3.5 text-[13px] font-medium text-gi-danger transition-colors hover:bg-[var(--gi-danger-bg)] disabled:opacity-40"
          :disabled="!history.length"
          @click="onClearHistory"
        >
          Clear all
        </button>
      </div>
      <div v-for="entry in history" :key="entry.name" class="flex items-center gap-3 border-t border-border px-5 py-3">
        <span
          class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-[11px] font-semibold text-[#d4d4d8]"
        >
          {{ entry.name.charAt(0).toUpperCase() }}
        </span>
        <span class="min-w-0 flex-1 truncate text-[14px]">{{ entry.name }}</span>
        <span class="shrink-0 font-mono text-[12px] text-gi-subtle">{{ relativeTime(entry.t) }}</span>
        <button
          type="button"
          class="h-8 shrink-0 rounded-md border border-border px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          @click="openEntry(entry.name)"
        >
          Open
        </button>
        <button
          type="button"
          class="h-8 shrink-0 rounded-md px-2.5 text-[13px] font-medium text-gi-subtle transition-colors hover:text-gi-danger"
          :aria-label="`Remove ${entry.name}`"
          @click="removeEntry(entry.name)"
        >
          Remove
        </button>
      </div>
      <p v-if="!history.length" class="border-t border-border px-5 py-4 text-[13px] text-muted-foreground">
        No history yet.
      </p>
    </div>
  </div>
</template>
