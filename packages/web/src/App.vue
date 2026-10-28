<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppFooter from "@/components/layout/AppFooter.vue";
import AppHeader from "@/components/layout/AppHeader.vue";

const route = useRoute();
const chromeless = computed(() => route.meta.chromeless === true);
</script>

<template>
  <div v-if="chromeless">
    <RouterView />
  </div>
  <div v-else class="flex min-h-screen flex-col">
    <AppHeader />
    <main class="flex-1 py-10">
      <RouterView />
    </main>
    <AppFooter />
  </div>
</template>
