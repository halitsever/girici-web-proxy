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
  <header class="sticky top-0 z-20 border-b border-[#161b2c] bg-background/85 backdrop-blur-md">
    <div class="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 px-5">
      <RouterLink to="/" class="no-underline">
        <BrandMark />
      </RouterLink>
      <nav class="flex h-full items-stretch gap-1 sm:gap-2">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="relative inline-flex items-center gap-2 px-2.5 text-[14px] font-medium no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-6px] focus-visible:outline-ring"
          :class="route.path === tab.to ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          :aria-current="route.path === tab.to ? 'page' : undefined"
        >
          <component :is="tab.icon" class="hidden h-4 w-4 sm:block" />
          {{ t(tab.label) }}
          <!-- The logo's route bar marks where you are. -->
          <span
            v-if="route.path === tab.to"
            class="absolute inset-x-2.5 -bottom-px h-[3px] rounded-full bg-gi-brand"
            aria-hidden="true"
          />
        </RouterLink>
      </nav>
    </div>
  </header>
</template>
