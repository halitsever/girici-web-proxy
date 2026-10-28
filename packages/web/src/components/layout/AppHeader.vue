<script setup lang="ts">
import { Search, SlidersHorizontal, User } from "lucide-vue-next";
import { RouterLink, useRoute } from "vue-router";

const route = useRoute();
const tabs = [
  { to: "/", label: "Browse", icon: Search },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal },
  { to: "/account", label: "Account", icon: User },
];
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-[#18181b] bg-background/85 backdrop-blur-md">
    <div class="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-3 py-3">
      <RouterLink to="/" class="inline-flex items-center gap-2 no-underline">
        <img src="@/assets/brand/girici-icon-dark.svg" class="h-6 w-6" alt="" />
        <span class="text-[18px] font-bold tracking-[-0.03em] text-foreground">Girici</span>
      </RouterLink>
      <nav class="flex items-center gap-0.5 rounded-[10px] border border-border bg-card p-[3px]">
        <RouterLink
          v-for="t in tabs"
          :key="t.to"
          :to="t.to"
          class="inline-flex h-8 items-center gap-[7px] rounded-[7px] px-3 text-[13px] font-medium no-underline transition-colors"
          :class="route.path === t.to ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'"
        >
          <component :is="t.icon" class="h-3.5 w-3.5" />
          {{ t.label }}
        </RouterLink>
      </nav>
    </div>
  </header>
</template>
