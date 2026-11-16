<script setup lang="ts">
import { Search, SlidersHorizontal, User } from "lucide-vue-next";
import { RouterLink, useRoute } from "vue-router";
import { t, type TextKey } from "@/lib/i18n";
import BrandMark from "./BrandMark.vue";

const route = useRoute();
const tabs: Array<{ to: string; label: TextKey; icon: typeof Search }> = [
  { to: "/", label: "nav.browse", icon: Search },
  { to: "/settings", label: "nav.settings", icon: SlidersHorizontal },
  { to: "/account", label: "nav.account", icon: User },
];
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-[#18181b] bg-background/85 backdrop-blur-md">
    <div class="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-3 py-3">
      <RouterLink to="/" class="no-underline">
        <BrandMark />
      </RouterLink>
      <nav class="flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-[3px]">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="inline-flex h-8 items-center gap-[7px] rounded-[7px] px-3 text-[13px] font-medium no-underline transition-colors"
          :class="route.path === tab.to ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'"
        >
          <component :is="tab.icon" class="h-3.5 w-3.5" />
          {{ t(tab.label) }}
        </RouterLink>
      </nav>
    </div>
  </header>
</template>
