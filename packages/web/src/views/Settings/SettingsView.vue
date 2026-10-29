<script setup lang="ts">
import type { SiteSummary } from "@girici/engine/shared";
import { computed, onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getAdminSettings, getAuthState, saveBlockedHosts, setPublicAccess } from "@/lib/auth";
import { syncEnginePrefs } from "@/lib/engine-prefs";
import { clearHistory, loadHistory, relativeTime, removeVisit, type HistoryEntry } from "@/lib/history";
import { openProxied, serviceWorkerSupport } from "@/lib/proxy";
import { clearSiteData, listSiteData } from "@/lib/site-data";
import { loadSettings, saveSettings } from "@/lib/settings";
import { SEARCH_ENGINES, toProxyPath, type SearchEngine } from "@/lib/target";

const engines = Object.keys(SEARCH_ENGINES) as SearchEngine[];
const settings = ref(loadSettings());
const history = ref<HistoryEntry[]>([]);
const authed = ref(false);
const publicAccess = ref(false);
const publicError = ref("");
const blockedText = ref("");
const envBlocked = ref<string[]>([]);
const blockedStatus = ref("");
const blockedError = ref("");
const savingBlocked = ref(false);
const sites = ref<SiteSummary[]>([]);
const sitesLoaded = ref(false);
const siteBusy = ref(false);
const siteError = ref("");
const siteSupport = serviceWorkerSupport({
  isSecureContext: window.isSecureContext,
  hasServiceWorker: "serviceWorker" in navigator,
});
const siteNote = computed(() => {
  if (siteSupport !== "ok") return "Site data needs HTTPS (or localhost).";
  return sitesLoaded.value && !sites.value.length ? "No site data yet." : "";
});

watch(settings, (value) => saveSettings(value), { deep: true });
watch(
  () => settings.value.blockCookies,
  () => void syncEnginePrefs(settings.value),
);

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

async function onSaveBlocked() {
  blockedStatus.value = "";
  blockedError.value = "";
  savingBlocked.value = true;
  try {
    const hosts = blockedText.value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const saved = await saveBlockedHosts(hosts);
    blockedText.value = saved.blockedHosts.join("\n");
    blockedStatus.value = "Saved.";
  } catch (e) {
    blockedError.value = e instanceof Error ? e.message : "Could not save blocked sites.";
  } finally {
    savingBlocked.value = false;
  }
}

function siteDetail(entry: SiteSummary): string {
  const parts: string[] = [];
  if (entry.cookies > 0) parts.push(entry.cookies === 1 ? "1 cookie" : `${entry.cookies} cookies`);
  if (entry.origins.length > 0) parts.push("storage");
  return parts.join(" · ");
}

async function loadSites() {
  if (siteSupport !== "ok") return;
  try {
    sites.value = await listSiteData();
    siteError.value = "";
  } catch (e) {
    siteError.value = e instanceof Error ? e.message : "Could not load site data.";
  } finally {
    sitesLoaded.value = true;
  }
}

async function onClearSite(site: string | null) {
  siteBusy.value = true;
  siteError.value = "";
  try {
    await clearSiteData(site);
  } catch (e) {
    siteError.value = e instanceof Error ? e.message : "Could not clear site data.";
  } finally {
    siteBusy.value = false;
  }
  await loadSites();
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
  void loadSites();
  const state = await getAuthState(true);
  authed.value = state.authed;
  publicAccess.value = state.public;
  if (!state.authed) return;
  try {
    const admin = await getAdminSettings();
    blockedText.value = admin.blockedHosts.join("\n");
    envBlocked.value = admin.envBlockedHosts;
  } catch {
    // The editor starts empty; saving still reports its own errors.
  }
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
          <p class="text-[14px] font-medium">Show toolbar on sites</p>
          <p class="text-[13px] text-muted-foreground">
            A small Girici button on every site, for the address bar and quick actions.
          </p>
        </div>
        <Switch v-model="settings.toolbar" aria-label="Show toolbar on sites" />
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
        <Switch v-model="settings.blockCookies" aria-label="Block third-party cookies" />
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
      <div class="flex flex-col gap-3 border-t border-border px-5 py-[18px]">
        <div>
          <label for="blocked-hosts" class="text-[14px] font-medium">Blocked sites</label>
          <p class="text-[13px] text-muted-foreground">
            One site per line. Blocking a site also blocks its subdomains.
          </p>
        </div>
        <textarea
          id="blocked-hosts"
          v-model="blockedText"
          rows="5"
          spellcheck="false"
          placeholder="example.com"
          class="w-full rounded-md border border-input bg-card px-3.5 py-2 font-mono text-[13px] shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <p v-if="envBlocked.length" class="text-[13px] text-muted-foreground">
          Also blocked by GIRICI_BLOCKED_HOSTS: {{ envBlocked.join(", ") }}
        </p>
        <div class="flex items-center gap-3">
          <Button type="button" size="sm" :disabled="savingBlocked" @click="onSaveBlocked">Save</Button>
          <span v-if="blockedStatus" class="text-[13px] text-gi-success">{{ blockedStatus }}</span>
          <span v-if="blockedError" class="text-[13px] text-gi-danger">{{ blockedError }}</span>
        </div>
      </div>
    </div>

    <section class="overflow-hidden rounded-xl border border-border bg-gi-panel">
      <div class="flex items-center justify-between px-5 py-4">
        <div>
          <p class="text-[15px] font-semibold">Site data</p>
          <p class="mt-1 text-[13px] text-muted-foreground">
            Cookies and storage that sites keep through Girici, on this device.
          </p>
        </div>
        <button
          type="button"
          class="h-9 rounded-md border border-[var(--gi-danger-border)] px-3.5 text-[13px] font-medium text-gi-danger transition-colors hover:bg-[var(--gi-danger-bg)] disabled:opacity-40"
          :disabled="!sites.length || siteBusy"
          @click="onClearSite(null)"
        >
          Clear all
        </button>
      </div>
      <div v-for="entry in sites" :key="entry.site" class="flex items-center gap-3 border-t border-border px-5 py-3">
        <span
          class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-[11px] font-semibold text-[#d4d4d8]"
        >
          {{ entry.site.charAt(0).toUpperCase() }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14px]">{{ entry.site }}</p>
          <p class="text-[12px] text-gi-subtle">{{ siteDetail(entry) }}</p>
        </div>
        <button
          type="button"
          class="h-8 shrink-0 rounded-md border border-border px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          :aria-label="`Clear ${entry.site}`"
          :disabled="siteBusy"
          @click="onClearSite(entry.site)"
        >
          Clear
        </button>
      </div>
      <p v-if="siteNote" class="border-t border-border px-5 py-4 text-[13px] text-muted-foreground">{{ siteNote }}</p>
      <p v-if="siteError" class="border-t border-border px-5 py-3 text-[13px] text-gi-danger">{{ siteError }}</p>
    </section>

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
