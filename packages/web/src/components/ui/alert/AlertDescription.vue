<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const { class: propClass } = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div :class="cn('text-sm leading-relaxed', propClass)">
    <slot />
  </div>
</template>
