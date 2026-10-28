<script setup lang="ts">
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    class="inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    :class="model ? 'bg-gi-brand' : 'bg-[#3f3f46]'"
    @click="model = !model"
  >
    <span
      class="block h-5 w-5 rounded-full bg-[#fafafa] shadow transition-transform"
      :class="model ? 'translate-x-5' : 'translate-x-0'"
    />
  </button>
</template>
