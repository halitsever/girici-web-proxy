<script setup lang="ts">
import { captureSiteDataEnv, SITES_CLEARED_PARAM, type SiteListAnswer, type SiteSummary } from "@girici/engine/shared";
import { X } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SiteBadge from "@/components/SiteBadge.vue";
import { Switch } from "@/components/ui/switch";
import { brand, DEFAULT_BRAND_NAME, readLogoFile, saveBrand } from "@/lib/brand";
import {
  getAdminSettings,
  getAuthState,
  saveBlockedHosts,
  setInstanceSwitch,
  setPublicAccess,
  setSealAddresses,
  type AuthState,
  type InstanceSwitch,
} from "@/lib/auth";
import { syncEnginePrefs } from "@/lib/engine-prefs";
import { clearHistory, loadHistory, relativeTime, removeVisit, type HistoryEntry } from "@/lib/history";
import { setLanguage, t, tn, UI_LANGUAGES, type TextKey } from "@/lib/i18n";
import { install, installPrompt } from "@/lib/install";
import { openProxied, serviceWorkerSupport } from "@/lib/proxy";
import {
  clearedNote,
  clearLegacyRootData,
  clearSiteData,
  clearSites,
  hasLegacyRootData,
  listSiteData,
  listVisitedSites,
  siteName,
} from "@/lib/site-data";
import { loadSettings, saveSettings } from "@/lib/settings";
import { isSiteMode, syncSettings } from "@/lib/sites";
import { SEARCH_ENGINES, toProxyPath, type SearchEngine } from "@/lib/target";
import StatusPanel from "./StatusPanel.vue";

const route = useRoute();
const active = ref("browsing");
const sections = computed(() => [
  { id: "browsing", label: "settings.sectionBrowsing" as TextKey },
  { id: "privacy", label: "settings.sectionPrivacy" as TextKey },
  ...(authed.value ? [{ id: "admin", label: "admin.title" as TextKey }] : []),
]);

function jump(id: string) {
  active.value = id;
  document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
  window.history.replaceState(window.history.state, "", `#${id}`);
}

/** The side nav follows whichever section holds the top of the viewport. */
function watchSections(): () => void {
  const observer = new IntersectionObserver(
    (entries) => {
      const shown = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target.id);
      if (shown[0]) active.value = shown[0];
    },
    { rootMargin: "-96px 0px -60% 0px" },
  );
  for (const section of sections.value) {
    const element = document.getElementById(section.id);
    if (element) observer.observe(element);
  }
  return () => observer.disconnect();
}
const router = useRouter();
const engines = Object.keys(SEARCH_ENGINES) as SearchEngine[];
const settings = ref(loadSettings());
const history = ref<HistoryEntry[]>([]);
const authState = ref<AuthState | null>(null);
const siteMode = computed(() => isSiteMode(authState.value));
const authed = ref(false);
const publicAccess = ref(false);
const publicError = ref("");
const instanceSeal = ref(false);
const instanceSealError = ref("");
const SWITCH_ROWS: ReadonlyArray<{ name: InstanceSwitch; label: TextKey; help: TextKey }> = [
  { name: "deepLinkWarning", label: "admin.warning", help: "admin.warningHelp" },
  { name: "proofOfWork", label: "admin.pow", help: "admin.powHelp" },
];
const languageOptions = computed(() => [
  { code: "auto" as const, name: t("settings.languageAuto") },
  ...UI_LANGUAGES.map((info) => ({ code: info.code, name: info.name })),
]);
// The server's defaults until the admin settings load.
const instanceSwitches = ref<Record<InstanceSwitch, boolean>>({ deepLinkWarning: true, proofOfWork: false });
const instanceSwitchErrors = ref<Record<InstanceSwitch, string>>({ deepLinkWarning: "", proofOfWork: "" });
// Kept in memory only, so it is gone once the page closes.
const adminPassword = ref("");
const blockedText = ref("");
const envBlocked = ref<string[]>([]);
const blockedStatus = ref("");
const blockedError = ref("");
const savingBlocked = ref(false);
const instanceName = ref(brand.value.name === DEFAULT_BRAND_NAME ? "" : brand.value.name);
// undefined keeps the saved logo, null removes it, an object replaces it.
const pendingLogo = ref<{ type: string; data: string } | null | undefined>(undefined);
const instanceStatus = ref("");
const instanceError = ref("");
const savingInstance = ref(false);
const logoPreview = computed(() => {
  if (pendingLogo.value === null) return null;
  return pendingLogo.value ? `data:${pendingLogo.value.type};base64,${pendingLogo.value.data}` : brand.value.logo;
});
const sites = ref<SiteSummary[]>([]);
const sitesLoaded = ref(false);
const siteBusy = ref(false);
const siteError = ref("");
// Subdomain mode: the sites the root remembers, data from before it, and the count the clearing chain returns with.
const visited = ref<SiteListAnswer["sites"]>([]);
const legacyData = ref(false);
const clearedStatus = ref(clearedNote(route.query[SITES_CLEARED_PARAM]));
const siteSupport = serviceWorkerSupport({
  isSecureContext: window.isSecureContext,
  hasServiceWorker: "serviceWorker" in navigator,
});
const siteNote = computed(() => {
  if (siteSupport !== "ok") return t("sites.needsHttps");
  if (!sitesLoaded.value) return "";
  if (siteMode.value) return visited.value.length || legacyData.value ? "" : t("sites.empty");
  return sites.value.length ? "" : t("sites.empty");
});

watch(settings, (value) => saveSettings(value), { deep: true });
watch(
  () => settings.value.lang,
  (choice) => void setLanguage(choice, navigator.languages),
);
// Site hosts also read the toolbar and search engine, from the cookie the root keeps for them.
watch(
  () =>
    siteMode.value
      ? [
          settings.value.blockCookies,
          settings.value.sealAddresses,
          settings.value.lang,
          settings.value.toolbar,
          settings.value.engine,
        ]
      : [settings.value.blockCookies, settings.value.sealAddresses, settings.value.lang],
  () => void syncSettings(settings.value, authState.value),
);

async function onToggleInstanceSeal(on: boolean) {
  instanceSealError.value = "";
  if (!adminPassword.value) {
    instanceSealError.value = t("error.passwordFirst");
    return;
  }
  const previous = instanceSeal.value;
  instanceSeal.value = on;
  try {
    instanceSeal.value = await setSealAddresses(on, adminPassword.value);
    // This browser's worker hears it now; others pick it up from the sign-in state.
    await syncEnginePrefs(settings.value, undefined, instanceSeal.value);
  } catch (e) {
    instanceSeal.value = previous;
    instanceSealError.value = e instanceof Error ? e.message : t("error.instanceSeal");
  }
}

async function onToggleInstanceSwitch(name: InstanceSwitch, on: boolean) {
  instanceSwitchErrors.value[name] = "";
  if (!adminPassword.value) {
    instanceSwitchErrors.value[name] = t("error.passwordFirst");
    return;
  }
  const previous = instanceSwitches.value[name];
  instanceSwitches.value[name] = on;
  try {
    instanceSwitches.value[name] = (await setInstanceSwitch(name, on, adminPassword.value))[name];
  } catch (e) {
    instanceSwitches.value[name] = previous;
    instanceSwitchErrors.value[name] = e instanceof Error ? e.message : t("error.setting");
  }
}

async function onTogglePublic(on: boolean) {
  publicError.value = "";
  if (!adminPassword.value) {
    publicError.value = t("error.passwordFirst");
    return;
  }
  const previous = publicAccess.value;
  publicAccess.value = on;
  try {
    publicAccess.value = await setPublicAccess(on, adminPassword.value);
  } catch (e) {
    publicAccess.value = previous;
    publicError.value = e instanceof Error ? e.message : t("error.publicAccess");
  }
}

async function onPickLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  instanceError.value = "";
  instanceStatus.value = "";
  if (!file) return;
  try {
    pendingLogo.value = await readLogoFile(file);
  } catch (e) {
    pendingLogo.value = undefined;
    input.value = "";
    instanceError.value = e instanceof Error ? e.message : t("error.logoRead");
  }
}

async function onSaveInstance() {
  instanceStatus.value = "";
  instanceError.value = "";
  if (!adminPassword.value) {
    instanceError.value = t("error.passwordFirst");
    return;
  }
  savingInstance.value = true;
  try {
    const saved = await saveBrand(
      {
        name: instanceName.value.trim() || null,
        ...(pendingLogo.value !== undefined ? { logo: pendingLogo.value } : {}),
      },
      adminPassword.value,
    );
    instanceName.value = saved.name === DEFAULT_BRAND_NAME ? "" : saved.name;
    pendingLogo.value = undefined;
    instanceStatus.value = t("admin.saved");
  } catch (e) {
    instanceError.value = e instanceof Error ? e.message : t("error.instanceSave");
  } finally {
    savingInstance.value = false;
  }
}

async function onSaveBlocked() {
  blockedStatus.value = "";
  blockedError.value = "";
  if (!adminPassword.value) {
    blockedError.value = t("error.passwordFirst");
    return;
  }
  savingBlocked.value = true;
  try {
    const hosts = blockedText.value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const saved = await saveBlockedHosts(hosts, adminPassword.value);
    blockedText.value = saved.blockedHosts.join("\n");
    blockedStatus.value = t("admin.saved");
  } catch (e) {
    blockedError.value = e instanceof Error ? e.message : t("error.blockedSave");
  } finally {
    savingBlocked.value = false;
  }
}

function siteDetail(entry: SiteSummary): string {
  const parts: string[] = [];
  if (entry.cookies > 0) parts.push(tn("sites.cookies", entry.cookies));
  if (entry.origins.length > 0) parts.push(t("sites.storage"));
  return parts.join(" · ");
}

async function loadSites() {
  if (siteSupport !== "ok") return;
  try {
    // A root worker registered here would only retire again, so subdomain mode lists without one.
    if (siteMode.value) {
      [visited.value, legacyData.value] = await Promise.all([
        listVisitedSites(),
        hasLegacyRootData(captureSiteDataEnv(window)),
      ]);
    } else {
      sites.value = await listSiteData();
    }
    siteError.value = "";
  } catch (e) {
    siteError.value = e instanceof Error ? e.message : t("error.siteLoad");
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
    siteError.value = e instanceof Error ? e.message : t("error.siteClear");
  } finally {
    siteBusy.value = false;
  }
  await loadSites();
}

/** The page leaves for the clearing chain, so it stays busy unless the chain could not start. */
async function onClearSites(target: string[] | "all") {
  siteBusy.value = true;
  siteError.value = "";
  clearedStatus.value = "";
  try {
    await clearSites(target);
  } catch (e) {
    siteError.value = e instanceof Error ? e.message : t("error.siteClear");
    siteBusy.value = false;
  }
}

async function onRemoveLegacy() {
  siteBusy.value = true;
  siteError.value = "";
  try {
    const env = captureSiteDataEnv(window);
    await clearLegacyRootData(env);
    legacyData.value = await hasLegacyRootData(env);
  } catch (e) {
    siteError.value = e instanceof Error ? e.message : t("error.legacyRemove");
  } finally {
    siteBusy.value = false;
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

const sectionNav = ref<HTMLElement | null>(null);
const highlight = ref<Record<string, string> | null>(null);

function placeHighlight() {
  const link = sectionNav.value?.querySelector<HTMLElement>('[aria-current="true"]');
  highlight.value = link
    ? {
        left: `${link.offsetLeft}px`,
        top: `${link.offsetTop}px`,
        width: `${link.offsetWidth}px`,
        height: `${link.offsetHeight}px`,
      }
    : null;
}
watch([active, sections], () => void nextTick(placeHighlight));
onMounted(() => {
  placeHighlight();
  window.addEventListener("resize", placeHighlight);
});
onBeforeUnmount(() => window.removeEventListener("resize", placeHighlight));

let stopWatching: (() => void) | undefined;
onBeforeUnmount(() => stopWatching?.());

onMounted(async () => {
  settings.value = loadSettings();
  history.value = loadHistory();
  // The router guard read the state already, so the mode comes from its cache before the site list loads.
  authState.value = await getAuthState().catch(() => null);
  void loadSites();
  // A reload would otherwise report the same clearing again.
  if (route.query[SITES_CLEARED_PARAM] !== undefined) {
    void router.replace({ query: { ...route.query, [SITES_CLEARED_PARAM]: undefined } });
  }
  const state = await getAuthState(true);
  authState.value = state;
  authed.value = state.authed;
  // After the admin section renders, so it is watched too.
  await nextTick();
  stopWatching?.();
  stopWatching = watchSections();
  publicAccess.value = state.public;
  instanceSeal.value = state.sealAddresses;
  if (!state.authed) return;
  try {
    const admin = await getAdminSettings();
    blockedText.value = admin.blockedHosts.join("\n");
    envBlocked.value = admin.envBlockedHosts;
    instanceSwitches.value = { deepLinkWarning: admin.deepLinkWarning, proofOfWork: admin.proofOfWork };
  } catch {
    // The editor starts empty; saving still reports its own errors.
  }
});
</script>

<template>
  <div class="mx-auto w-full max-w-[1040px] px-5" style="padding-top: clamp(24px, 6vh, 56px)">
    <h1 class="text-[clamp(30px,4.5vw,44px)] leading-tight font-semibold tracking-[-0.04em]">
      {{ t("settings.title") }}
    </h1>
    <p class="mt-2 text-[16px] text-muted-foreground">{{ t("settings.lead") }}</p>

    <div class="mt-10 grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-14">
      <nav
        ref="sectionNav"
        class="relative -mx-5 flex gap-1 overflow-x-auto px-5 lg:sticky lg:top-24 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0"
        :aria-label="t('settings.title')"
      >
        <!-- One highlight that glides to the section in view. -->
        <span
          v-if="highlight"
          class="pointer-events-none absolute rounded-lg bg-accent transition-all duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
          :style="highlight"
          aria-hidden="true"
        >
          <span
            class="absolute top-1/2 left-2 hidden h-[3px] w-2.5 -translate-y-1/2 rounded-full bg-gi-brand shadow-[0_0_10px_rgba(61,107,255,0.8)] lg:block"
          />
        </span>
        <a
          v-for="section in sections"
          :key="section.id"
          :href="`#${section.id}`"
          class="relative flex h-10 shrink-0 items-center rounded-lg px-3 text-[14px] font-medium whitespace-nowrap no-underline transition-colors lg:pl-6"
          :class="active === section.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          :aria-current="active === section.id ? 'true' : undefined"
          @click.prevent="jump(section.id)"
        >
          {{ t(section.label) }}
        </a>
      </nav>

      <div class="flex min-w-0 flex-col gap-16">
        <div id="browsing" class="flex scroll-mt-24 flex-col gap-5">
          <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t("settings.sectionBrowsing") }}</h2>
          <div class="divide-y divide-border rounded-xl border border-border bg-gi-panel">
            <div class="flex flex-col gap-3.5 p-5">
              <div>
                <p id="language-label" class="text-[14px] font-medium">{{ t("settings.language") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("settings.languageHelp") }}</p>
              </div>
              <div
                role="radiogroup"
                aria-labelledby="language-label"
                class="grid gap-1 rounded-[10px] border border-border bg-card p-1"
                style="grid-template-columns: repeat(auto-fit, minmax(110px, 1fr))"
              >
                <button
                  v-for="option in languageOptions"
                  :key="option.code"
                  type="button"
                  role="radio"
                  :aria-checked="settings.lang === option.code"
                  :lang="option.code === 'auto' ? undefined : option.code"
                  class="h-9 rounded-[7px] text-[13px] font-medium transition-colors"
                  :class="
                    settings.lang === option.code
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  "
                  @click="settings.lang = option.code"
                >
                  {{ option.name }}
                </button>
              </div>
            </div>

            <div class="flex flex-col gap-3.5 p-5">
              <div>
                <p class="text-[14px] font-medium">{{ t("settings.engine") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("settings.engineHelp") }}</p>
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
                <p class="text-[14px] font-medium">{{ t("settings.newTab") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("settings.newTabHelp") }}</p>
              </div>
              <Switch v-model="settings.newTab" />
            </div>

            <div v-if="installPrompt" class="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div class="min-w-0">
                <p class="text-[14px] font-medium">{{ t("settings.install") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("settings.installHelp") }}</p>
              </div>
              <Button type="button" size="sm" class="shrink-0" @click="install">
                {{ t("settings.installAction") }}
              </Button>
            </div>

            <div class="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div>
                <p class="text-[14px] font-medium">{{ t("settings.toolbar") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("settings.toolbarHelp") }}</p>
              </div>
              <Switch v-model="settings.toolbar" :aria-label="t('settings.toolbar')" />
            </div>

            <div class="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div>
                <p class="text-[14px] font-medium">{{ t("settings.history") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("settings.historyHelp") }}</p>
              </div>
              <Switch v-model="settings.rememberHistory" />
            </div>

            <div class="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div>
                <p class="text-[14px] font-medium">{{ t("settings.cookies") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("settings.cookiesHelp") }}</p>
                <p v-if="!settings.blockCookies" class="mt-1 text-[13px] text-gi-danger">
                  {{ t("settings.cookiesOff") }}
                </p>
              </div>
              <Switch v-model="settings.blockCookies" :aria-label="t('settings.cookies')" />
            </div>

            <div class="flex items-center justify-between gap-4 px-5 py-[18px]">
              <div>
                <p class="text-[14px] font-medium">{{ t("settings.seal") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("settings.sealHelp") }}</p>
                <p v-if="instanceSeal" class="mt-1 text-[13px] text-muted-foreground">
                  {{ t("settings.sealByAdmin") }}
                </p>
              </div>
              <Switch
                :model-value="settings.sealAddresses || instanceSeal"
                :disabled="instanceSeal"
                :aria-label="t('settings.seal')"
                @update:model-value="(on: boolean) => (settings.sealAddresses = on)"
              />
            </div>
          </div>
        </div>

        <div id="privacy" class="flex scroll-mt-24 flex-col gap-5">
          <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t("settings.sectionPrivacy") }}</h2>
          <section v-if="siteMode" class="overflow-hidden rounded-xl border border-border bg-gi-panel">
            <div class="flex items-center justify-between gap-4 px-5 py-4">
              <div class="min-w-0">
                <p class="text-[15px] font-semibold">{{ t("sites.title") }}</p>
                <p class="mt-1 text-[13px] text-muted-foreground">{{ t("sites.leadSites") }}</p>
              </div>
              <button
                type="button"
                class="h-9 shrink-0 whitespace-nowrap rounded-md border border-[var(--gi-danger-border)] px-3.5 text-[13px] font-medium text-gi-danger transition-colors hover:bg-[var(--gi-danger-bg)] disabled:opacity-40"
                :disabled="!visited.length || siteBusy"
                @click="onClearSites('all')"
              >
                {{ t("sites.clearAll") }}
              </button>
            </div>
            <p v-if="clearedStatus" role="status" class="border-t border-border px-5 py-3 text-[13px] text-gi-success">
              {{ clearedStatus }}
            </p>
            <div
              v-for="entry in visited"
              :key="entry.site"
              class="flex items-center gap-3 border-t border-border px-5 py-3"
            >
              <SiteBadge :host="siteName(entry.site)" />
              <p class="min-w-0 flex-1 truncate text-[14px]">{{ siteName(entry.site) }}</p>
              <button
                type="button"
                class="h-8 shrink-0 rounded-md border border-border px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                :aria-label="t('sites.clearOne', { site: siteName(entry.site) })"
                :disabled="siteBusy"
                @click="onClearSites([entry.site])"
              >
                {{ t("sites.clear") }}
              </button>
            </div>
            <div v-if="legacyData" class="flex items-center justify-between gap-4 border-t border-border px-5 py-3">
              <p class="text-[13px] text-muted-foreground">{{ t("sites.legacy") }}</p>
              <button
                type="button"
                class="h-8 shrink-0 rounded-md border border-border px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                :disabled="siteBusy"
                @click="onRemoveLegacy"
              >
                {{ t("sites.removeLegacy") }}
              </button>
            </div>
            <p v-if="siteNote" class="border-t border-border px-5 py-4 text-[13px] text-muted-foreground">
              {{ siteNote }}
            </p>
            <p v-if="siteError" class="border-t border-border px-5 py-3 text-[13px] text-gi-danger">{{ siteError }}</p>
          </section>

          <section v-else class="overflow-hidden rounded-xl border border-border bg-gi-panel">
            <div class="flex items-center justify-between gap-4 px-5 py-4">
              <div class="min-w-0">
                <p class="text-[15px] font-semibold">{{ t("sites.title") }}</p>
                <p class="mt-1 text-[13px] text-muted-foreground">{{ t("sites.leadSingle") }}</p>
              </div>
              <button
                type="button"
                class="h-9 shrink-0 whitespace-nowrap rounded-md border border-[var(--gi-danger-border)] px-3.5 text-[13px] font-medium text-gi-danger transition-colors hover:bg-[var(--gi-danger-bg)] disabled:opacity-40"
                :disabled="!sites.length || siteBusy"
                @click="onClearSite(null)"
              >
                {{ t("sites.clearAll") }}
              </button>
            </div>
            <div
              v-for="entry in sites"
              :key="entry.site"
              class="flex items-center gap-3 border-t border-border px-5 py-3"
            >
              <SiteBadge :host="entry.site" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-[14px]">{{ entry.site }}</p>
                <p class="text-[12px] text-gi-subtle">{{ siteDetail(entry) }}</p>
              </div>
              <button
                type="button"
                class="h-8 shrink-0 rounded-md border border-border px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                :aria-label="t('sites.clearOne', { site: entry.site })"
                :disabled="siteBusy"
                @click="onClearSite(entry.site)"
              >
                {{ t("sites.clear") }}
              </button>
            </div>
            <p v-if="siteNote" class="border-t border-border px-5 py-4 text-[13px] text-muted-foreground">
              {{ siteNote }}
            </p>
            <p v-if="siteError" class="border-t border-border px-5 py-3 text-[13px] text-gi-danger">{{ siteError }}</p>
          </section>

          <div class="overflow-hidden rounded-xl border border-border bg-gi-panel">
            <div class="flex items-center justify-between gap-4 px-5 py-4">
              <div class="min-w-0">
                <p class="text-[15px] font-semibold">{{ t("history.title") }}</p>
                <p class="mt-1 text-[13px] text-muted-foreground">{{ t("history.lead") }}</p>
              </div>
              <button
                type="button"
                class="h-9 shrink-0 whitespace-nowrap rounded-md border border-[var(--gi-danger-border)] px-3.5 text-[13px] font-medium text-gi-danger transition-colors hover:bg-[var(--gi-danger-bg)] disabled:opacity-40"
                :disabled="!history.length"
                @click="onClearHistory"
              >
                {{ t("sites.clearAll") }}
              </button>
            </div>
            <div
              v-for="entry in history"
              :key="entry.name"
              class="flex items-center gap-3 border-t border-border px-5 py-3"
            >
              <SiteBadge :host="entry.name" />
              <!-- On a phone the time goes under the name, which leaves the name room for a whole host. -->
              <div class="min-w-0 flex-1">
                <p class="truncate text-[14px]">{{ entry.name }}</p>
                <p class="font-mono text-[12px] text-gi-subtle sm:hidden">{{ relativeTime(entry.t) }}</p>
              </div>
              <span class="hidden shrink-0 font-mono text-[12px] text-gi-subtle sm:inline">{{
                relativeTime(entry.t)
              }}</span>
              <button
                type="button"
                class="h-8 shrink-0 rounded-md border border-border px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                @click="openEntry(entry.name)"
              >
                {{ t("history.open") }}
              </button>
              <button
                type="button"
                class="grid h-8 shrink-0 place-items-center rounded-md px-2 text-[13px] font-medium text-gi-subtle transition-colors hover:text-gi-danger sm:px-2.5"
                :aria-label="t('history.removeOne', { name: entry.name })"
                @click="removeEntry(entry.name)"
              >
                <X class="size-4 sm:hidden" aria-hidden="true" />
                <span class="hidden sm:inline">{{ t("history.remove") }}</span>
              </button>
            </div>
            <p v-if="!history.length" class="border-t border-border px-5 py-4 text-[13px] text-muted-foreground">
              {{ t("history.empty") }}
            </p>
          </div>
        </div>

        <div v-if="authed" id="admin" class="flex scroll-mt-24 flex-col gap-5">
          <div>
            <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t("admin.title") }}</h2>
            <p class="mt-1 text-[14px] text-muted-foreground">{{ t("admin.lead") }}</p>
          </div>
          <div v-if="authed" class="rounded-xl border border-border bg-gi-panel">
            <div class="px-5 pt-5">
              <label class="flex flex-col gap-2 text-[14px] font-medium">
                {{ t("account.currentPassword") }}
                <Input v-model="adminPassword" type="password" autocomplete="current-password" />
              </label>
              <p class="mt-2 text-[13px] text-muted-foreground">{{ t("admin.passwordHelp") }}</p>
            </div>
            <div class="mt-4 flex items-center justify-between gap-4 border-t border-border px-5 py-[18px]">
              <div>
                <p class="text-[14px] font-medium">{{ t("admin.public") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("admin.publicHelp") }}</p>
                <p v-if="publicError" class="mt-1 text-[13px] text-gi-danger">{{ publicError }}</p>
              </div>
              <Switch
                :model-value="publicAccess"
                :aria-label="t('admin.public')"
                @update:model-value="onTogglePublic"
              />
            </div>
            <div class="flex items-center justify-between gap-4 border-t border-border px-5 py-[18px]">
              <div>
                <p class="text-[14px] font-medium">{{ t("admin.seal") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("admin.sealHelp") }}</p>
                <p v-if="instanceSealError" class="mt-1 text-[13px] text-gi-danger">{{ instanceSealError }}</p>
              </div>
              <Switch
                :model-value="instanceSeal"
                :aria-label="t('admin.seal')"
                @update:model-value="onToggleInstanceSeal"
              />
            </div>
            <div
              v-for="row in SWITCH_ROWS"
              :key="row.name"
              class="flex items-center justify-between gap-4 border-t border-border px-5 py-[18px]"
            >
              <div>
                <p class="text-[14px] font-medium">{{ t(row.label) }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t(row.help) }}</p>
                <p v-if="instanceSwitchErrors[row.name]" class="mt-1 text-[13px] text-gi-danger">
                  {{ instanceSwitchErrors[row.name] }}
                </p>
              </div>
              <Switch
                :model-value="instanceSwitches[row.name]"
                :aria-label="t(row.label)"
                @update:model-value="(on: boolean) => onToggleInstanceSwitch(row.name, on)"
              />
            </div>
            <div class="flex flex-col gap-3 border-t border-border px-5 py-[18px]">
              <div>
                <p class="text-[14px] font-medium">{{ t("admin.instance") }}</p>
                <p class="text-[13px] text-muted-foreground">{{ t("admin.instanceHelp") }}</p>
              </div>
              <label class="flex flex-col gap-2 text-[14px] font-medium">
                {{ t("admin.instanceName") }}
                <Input v-model="instanceName" type="text" maxlength="40" :placeholder="DEFAULT_BRAND_NAME" />
              </label>
              <div class="flex flex-col gap-2">
                <label for="instance-logo" class="text-[14px] font-medium">{{ t("admin.logo") }}</label>
                <input
                  id="instance-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  class="text-[13px]"
                  @change="onPickLogo"
                />
                <p class="text-[13px] text-muted-foreground">{{ t("admin.logoHelp") }}</p>
                <div v-if="logoPreview" class="flex items-center gap-3">
                  <img
                    :src="logoPreview"
                    class="h-9 w-9 rounded-md border border-border object-contain"
                    :alt="t('admin.logoPreview')"
                  />
                  <Button type="button" size="sm" variant="outline" @click="pendingLogo = null">{{
                    t("admin.removeLogo")
                  }}</Button>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <Button type="button" size="sm" :disabled="savingInstance" @click="onSaveInstance">{{
                  t("admin.saveInstance")
                }}</Button>
                <span v-if="instanceStatus" class="text-[13px] text-gi-success">{{ instanceStatus }}</span>
                <span v-if="instanceError" class="text-[13px] text-gi-danger">{{ instanceError }}</span>
              </div>
            </div>
            <div class="flex flex-col gap-3 border-t border-border px-5 py-[18px]">
              <div>
                <label for="blocked-hosts" class="text-[14px] font-medium">{{ t("admin.blocked") }}</label>
                <p class="text-[13px] text-muted-foreground">{{ t("admin.blockedHelp") }}</p>
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
                {{ t("admin.blockedByEnv", { list: envBlocked.join(", ") }) }}
              </p>
              <div class="flex items-center gap-3">
                <Button type="button" size="sm" :disabled="savingBlocked" @click="onSaveBlocked">{{
                  t("admin.save")
                }}</Button>
                <span v-if="blockedStatus" class="text-[13px] text-gi-success">{{ blockedStatus }}</span>
                <span v-if="blockedError" class="text-[13px] text-gi-danger">{{ blockedError }}</span>
              </div>
            </div>
          </div>

          <StatusPanel />
        </div>
      </div>
    </div>
  </div>
</template>
