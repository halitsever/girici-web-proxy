<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

/** Faint routes with packets travelling along them, behind the page: the proxy at work. */
const canvas = ref<HTMLCanvasElement | null>(null);
let frame = 0;
let stop: (() => void) | undefined;

interface Lane {
  y: number;
  speed: number;
  packets: number[];
  alpha: number;
}

onMounted(() => {
  const element = canvas.value;
  if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const context = element.getContext("2d");
  if (!context) return;

  let width = 0;
  let height = 0;
  let lanes: Lane[] = [];
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  const layout = () => {
    width = element.clientWidth;
    height = element.clientHeight;
    element.width = width * ratio;
    element.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.max(6, Math.round(height / 90));
    lanes = Array.from({ length: count }, (_, index) => ({
      y: ((index + 0.5) / count) * height + (Math.random() - 0.5) * 30,
      speed: 0.25 + Math.random() * 0.6,
      packets: Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => Math.random() * width),
      alpha: 0.05 + Math.random() * 0.07,
    }));
  };

  const draw = () => {
    context.clearRect(0, 0, width, height);
    for (const lane of lanes) {
      context.fillStyle = `rgba(61, 107, 255, ${lane.alpha * 0.5})`;
      context.fillRect(0, lane.y, width, 1);
      for (let index = 0; index < lane.packets.length; index++) {
        // Packets run right to left, into the door, as on the landing page.
        let x = (lane.packets[index] ?? 0) - lane.speed;
        if (x < -160) x = width + Math.random() * 200;
        lane.packets[index] = x;
        const gradient = context.createLinearGradient(x, 0, x + 140, 0);
        gradient.addColorStop(0, `rgba(110, 144, 255, ${lane.alpha * 6})`);
        gradient.addColorStop(1, "rgba(110, 144, 255, 0)");
        context.fillStyle = gradient;
        context.fillRect(x, lane.y - 1, 140, 3);
      }
    }
    frame = requestAnimationFrame(draw);
  };

  // Hidden tabs keep no animation running.
  const onVisibility = () => {
    cancelAnimationFrame(frame);
    if (!document.hidden) frame = requestAnimationFrame(draw);
  };

  layout();
  frame = requestAnimationFrame(draw);
  window.addEventListener("resize", layout);
  document.addEventListener("visibilitychange", onVisibility);
  stop = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", layout);
    document.removeEventListener("visibilitychange", onVisibility);
  };
});

onBeforeUnmount(() => stop?.());
</script>

<template>
  <canvas ref="canvas" class="pointer-events-none fixed inset-0 -z-10 h-full w-full" aria-hidden="true" />
</template>
