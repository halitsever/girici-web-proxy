<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppFooter from "@/components/layout/AppFooter.vue";
import AppHeader from "@/components/layout/AppHeader.vue";
import RouteField from "@/components/layout/RouteField.vue";

const route = useRoute();
const chromeless = computed(() => route.meta.chromeless === true);
</script>

<template>
  <RouteField />
  <div v-if="chromeless">
    <RouterView />
  </div>
  <div v-else class="flex min-h-screen flex-col">
    <AppHeader />
    <main class="flex-1 py-10">
      <RouterView v-slot="{ Component, route: current }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="current.path" />
        </Transition>
      </RouterView>
    </main>
    <AppFooter />
  </div>
</template>

<style>
.page-enter-active {
  transition:
    opacity 0.28s ease,
    transform 0.36s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.page-leave-active {
  transition: opacity 0.14s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.page-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: none;
  }
}
</style>
