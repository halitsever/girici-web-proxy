<script setup lang="ts">
import defaultIcon from "@/assets/brand/girici-icon-dark.svg";
import { brand } from "@/lib/brand";

withDefaults(defineProps<{ size?: "sm" | "lg"; showName?: boolean }>(), { size: "sm", showName: true });
</script>

<template>
  <span class="inline-flex items-center gap-2">
    <img
      :src="brand.logo ?? defaultIcon"
      :class="size === 'lg' ? 'h-9 w-9' : 'h-6 w-6'"
      class="object-contain"
      alt=""
    />
    <span v-if="showName" class="text-[18px] font-bold tracking-[-0.03em] text-foreground">{{ brand.name }}</span>
  </span>
</template>
