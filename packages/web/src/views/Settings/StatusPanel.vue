<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import {
  barHeights,
  fetchStatus,
  formatBytes,
  limitText,
  runningText,
  sumTotals,
  type StatusReport,
} from "@/lib/status";

const report = ref<StatusReport | null>(null);
const error = ref("");
const loading = ref(false);

const hour = computed(() => sumTotals(report.value?.lastHour ?? []));
const bars = computed(() => {
  const minutes = report.value?.lastHour ?? [];
  const heights = barHeights(minutes.map((minute) => minute.bytesDown));
  return minutes.map((minute, index) => {
    const ago = minutes.length - 1 - index;
    return {
      height: heights[index] ?? 0,
      title: `${ago === 0 ? "This minute" : `${ago}m ago`}: ${formatBytes(minute.bytesDown)}`,
    };
  });
});
const hourLabel = computed(
  () => `Data sent in the last hour, minute by minute: ${formatBytes(hour.value.bytesDown)} in all`,
);
// Newest first, the way people read recent activity.
const days = computed(() => [...(report.value?.days ?? [])].reverse());

function count(value: number): string {
  return value.toLocaleString("en-US");
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    report.value = await fetchStatus();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not load the status.";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border bg-gi-panel" aria-labelledby="status-heading">
    <div class="flex items-center justify-between gap-4 px-5 py-4">
      <div>
        <h2 id="status-heading" class="text-[15px] font-semibold">Status</h2>
        <p class="mt-1 text-[13px] text-muted-foreground">
          Traffic through this proxy. Only counts are kept, never sites or visitor addresses.
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" :disabled="loading" @click="load">Refresh</Button>
    </div>

    <template v-if="report">
      <div class="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-5 py-3 text-[13px]">
        <p>{{ runningText(report.startedAt) }}</p>
        <p>Open WebSockets: {{ count(report.openSockets) }}</p>
      </div>

      <div class="flex flex-col gap-3 border-t border-border px-5 py-[18px]">
        <h3 class="text-[14px] font-medium">Last hour</h3>
        <div role="img" :aria-label="hourLabel" class="flex h-16 items-end gap-px">
          <div
            v-for="(bar, index) in bars"
            :key="index"
            :title="bar.title"
            class="flex-1 rounded-t-[2px]"
            :class="bar.height > 0 ? 'bg-primary' : 'bg-border'"
            :style="{ height: bar.height > 0 ? `${bar.height}%` : '2px' }"
          />
        </div>
        <p class="text-[13px] text-muted-foreground">
          {{ count(hour.requests) }} requests · {{ formatBytes(hour.bytesDown) }} sent ·
          {{ count(hour.refused) }} refused
        </p>
      </div>

      <div class="flex flex-col gap-3 border-t border-border px-5 py-[18px]">
        <h3 id="status-days" class="text-[14px] font-medium">Last 30 days</h3>
        <div class="overflow-x-auto">
          <table aria-labelledby="status-days" class="w-full whitespace-nowrap text-[13px] tabular-nums">
            <thead class="text-muted-foreground">
              <tr>
                <th scope="col" class="py-1.5 pr-3 text-left font-medium">Day</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Requests</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Sent</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Received</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Refused</th>
                <th scope="col" class="py-1.5 pl-3 text-right font-medium">Failed</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="day in days" :key="day.day" class="border-t border-border">
                <td class="py-1.5 pr-3 font-mono text-[12px]">{{ day.day }}</td>
                <td class="px-3 py-1.5 text-right">{{ count(day.requests) }}</td>
                <td class="px-3 py-1.5 text-right">{{ formatBytes(day.bytesDown) }}</td>
                <td class="px-3 py-1.5 text-right">{{ formatBytes(day.bytesUp) }}</td>
                <td class="px-3 py-1.5 text-right">{{ count(day.refused) }}</td>
                <td class="py-1.5 pl-3 text-right">{{ count(day.failed) }}</td>
              </tr>
              <tr v-if="!days.length" class="border-t border-border">
                <td colspan="6" class="py-2 text-muted-foreground">No traffic yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-[12px] text-gi-subtle">Days are in UTC. Sent goes to browsers, received comes from them.</p>
      </div>

      <div class="flex flex-col gap-1 border-t border-border px-5 py-[18px] text-[13px]">
        <p>{{ `Bandwidth limit: ${limitText(report.limits.bandwidthPerMinute, "minute")}` }}</p>
        <p>{{ `Daily quota: ${limitText(report.limits.dailyQuota, "day")}` }}</p>
        <p>{{ `Metrics endpoint: ${report.limits.metrics ? "On" : "Off"}` }}</p>
        <p class="mt-1 text-[12px] text-gi-subtle">Set with environment variables on the server.</p>
      </div>
    </template>

    <p v-if="error" class="border-t border-border px-5 py-3 text-[13px] text-gi-danger">{{ error }}</p>
  </section>
</template>
