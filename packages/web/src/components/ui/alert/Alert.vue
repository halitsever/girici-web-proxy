<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";
import { type AlertVariants, alertVariants } from ".";

const { variant, class: propClass } = defineProps<{
  variant?: AlertVariants["variant"];
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <div role="alert" :class="cn(alertVariants({ variant }), propClass)">
    <slot />
  </div>
</template>
