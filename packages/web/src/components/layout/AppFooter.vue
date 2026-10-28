<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getRandomInternetFact, type InternetFact } from "@/data/internetFacts";

const fact = ref<InternetFact>({ text: "", source: "" });

onMounted(() => {
  fact.value = getRandomInternetFact();
});
</script>

<template>
  <footer class="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5 text-[13px] text-gi-subtle">
    <p class="min-w-0">
      {{ fact.text }}
      <a
        v-if="fact.source"
        :href="fact.source"
        target="_blank"
        rel="noopener noreferrer"
        class="ml-1 text-[#d4d4d8] underline-offset-2 hover:text-foreground"
      >
        Source
      </a>
    </p>
    <a href="/_g/source" class="text-muted-foreground no-underline hover:text-foreground"> Source code · AGPL-3.0 </a>
  </footer>
</template>
