<script setup lang="ts">
import { Search, SlidersHorizontal, User } from "lucide-vue-next";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { t, type TextKey } from "@/lib/i18n";
import BrandMark from "./BrandMark.vue";

const route = useRoute();
const tabs: Array<{ to: string; label: TextKey; icon: typeof Search }> = [
  { to: "/", label: "nav.browse", icon: Search },
  { to: "/settings", label: "nav.settings", icon: SlidersHorizontal },
  { to: "/account", label: "nav.account", icon: User },
];

const nav = ref<HTMLElement | null>(null);
const bar = ref<{ left: number; width: number } | null>(null);

/** The logo's route bar slides under whichever page is open. */
function place() {
  const link = nav.value?.querySelector<HTMLElement>('[aria-current="page"]');
  bar.value = link ? { left: link.offsetLeft + 10, width: link.offsetWidth - 20 } : null;
}

watch(
  () => route.path,
  () => void nextTick(place),
);
onMounted(() => {
  place();
  // Fonts can load after the first measure and change the widths.
  void document.fonts?.ready.then(place);
  window.addEventListener("resize", place);
});
onBeforeUnmount(() => window.removeEventListener("resize", place));
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-[#161b2c] bg-background/80 backdrop-blur-md">
    <div class="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 px-5">
      <RouterLink to="/" class="brand no-underline">
        <BrandMark />
      </RouterLink>
      <nav ref="nav" class="relative flex h-full items-stretch gap-1 sm:gap-2">
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
        </RouterLink>
        <span
          v-if="bar"
          class="pointer-events-none absolute -bottom-px h-[3px] rounded-full bg-gi-brand shadow-[0_0_12px_rgba(61,107,255,0.8)] transition-[left,width] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
          :style="{ left: `${bar.left}px`, width: `${bar.width}px` }"
          aria-hidden="true"
        />
      </nav>
    </div>
  </header>
</template>

<style scoped>
/* The mark turns like a door when you point at it. */
.brand :deep(img) {
  transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.brand:hover :deep(img) {
  transform: rotate(-200deg);
}
@media (prefers-reduced-motion: reduce) {
  .brand :deep(img) {
    transition: none;
  }
}
</style>
