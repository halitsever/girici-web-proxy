<script setup lang="ts">
import { brand } from "@/lib/brand";
import BrandMark from "./BrandMark.vue";
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <!-- The logo's ring and route, large: the door every visitor passes. A custom logo replaces it. -->
    <div
      class="relative hidden overflow-hidden border-r border-[#161b2c] bg-[#070b17] lg:flex lg:flex-col lg:justify-between lg:p-12"
      aria-hidden="true"
    >
      <BrandMark />
      <div v-if="!brand.logo" class="relative mx-auto aspect-square w-[min(72%,440px)]">
        <span class="door-route absolute top-[40.6%] left-[37.5%] h-[12.5%] w-[200%] overflow-hidden bg-gi-brand">
          <span v-for="index in 4" :key="index" class="packet" :style="{ '--i': index - 1 }" />
        </span>
        <svg viewBox="0 0 64 64" class="door-ring absolute inset-0 h-full w-full">
          <path fill="#fafafa" d="M30 6A26 26 0 1 0 55.3 38H44.83A16 16 0 1 1 30 16Z" />
        </svg>
      </div>
      <img v-else :src="brand.logo" alt="" class="mx-auto max-h-[45%] w-[min(60%,360px)] object-contain" />
      <span />
    </div>
    <div class="grid place-items-center px-5 py-10">
      <div class="flex w-full max-w-[400px] flex-col">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.door-ring {
  filter: drop-shadow(0 30px 80px rgba(61, 107, 255, 0.2));
}
@media (prefers-reduced-motion: no-preference) {
  .door-ring {
    animation: turn-in 1s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .door-route {
    transform-origin: left center;
    animation: extend 0.8s cubic-bezier(0.6, 0, 0.2, 1) 0.3s both;
  }
}
/* Light runs along the route into the door, as addresses do. */
.packet {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 18%;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0));
  opacity: 0;
}
@media (prefers-reduced-motion: no-preference) {
  .packet {
    animation: travel 6s linear infinite;
    animation-delay: calc(1.1s + var(--i) * 1.5s);
  }
}
@keyframes travel {
  0% {
    opacity: 0;
    transform: translateX(560%);
  }
  8%,
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateX(-20%);
  }
}
@keyframes turn-in {
  from {
    opacity: 0;
    transform: rotate(-30deg) scale(0.94);
  }
}
@keyframes extend {
  from {
    transform: scaleX(0);
  }
}
</style>
