<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{ host: string }>();

const loaded = ref(false);
watch(
  () => props.host,
  () => (loaded.value = false),
);
const src = computed(() => `/_g/favicon?host=${encodeURIComponent(props.host)}`);
</script>

<template>
  <!-- Light behind a loaded icon, as on Browse, so dark icons stay visible. -->
  <span
    class="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md text-[11px] font-semibold text-[#d4d4d8]"
    :class="loaded ? 'bg-[#f4f4f5]' : 'bg-accent'"
  >
    <img
      :src="src"
      alt=""
      class="h-4 w-4 object-contain"
      :class="loaded ? '' : 'absolute opacity-0'"
      @load="loaded = true"
    />
    <span v-if="!loaded" aria-hidden="true">{{ host.charAt(0).toUpperCase() }}</span>
  </span>
</template>
