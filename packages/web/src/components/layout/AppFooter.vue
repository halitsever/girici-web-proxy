<script setup lang="ts">
import { textFor } from "@girici/engine/shared";
import { computed, onMounted, ref } from "vue";
import { getRandomInternetFact, type InternetFact } from "@/data/internetFacts";
import { lang, t } from "@/lib/i18n";
import SourceLink from "./SourceLink.vue";

const fact = ref<InternetFact | null>(null);
const text = computed(() => (fact.value ? textFor(fact.value.text, lang.value) : ""));

onMounted(() => {
  fact.value = getRandomInternetFact();
});
</script>

<template>
  <footer
    class="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5 text-[13px] text-gi-subtle"
  >
    <p class="min-w-0">
      {{ text }}
      <a
        v-if="fact"
        :href="fact.source"
        target="_blank"
        rel="noopener noreferrer"
        class="ml-1 text-[#d4d4d8] underline-offset-2 hover:text-foreground"
      >
        {{ t("footer.source") }}
      </a>
    </p>
    <SourceLink />
  </footer>
</template>
