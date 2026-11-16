<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { lang, t } from "@/lib/i18n";
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
      title:
        ago === 0
          ? t("status.thisMinute", { size: formatBytes(minute.bytesDown) })
          : t("status.minuteAgo", { count: ago, size: formatBytes(minute.bytesDown) }),
    };
  });
});
const hourLabel = computed(() => t("status.hourLabel", { size: formatBytes(hour.value.bytesDown) }));
// Newest first, the way people read recent activity.
const days = computed(() => [...(report.value?.days ?? [])].reverse());

function count(value: number): string {
  return value.toLocaleString(lang.value);
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    report.value = await fetchStatus();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("error.status");
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
        <h2 id="status-heading" class="text-[15px] font-semibold">{{ t("status.title") }}</h2>
        <p class="mt-1 text-[13px] text-muted-foreground">{{ t("status.lead") }}</p>
      </div>
      <Button type="button" size="sm" variant="outline" :disabled="loading" @click="load">{{
        t("status.refresh")
      }}</Button>
    </div>

    <template v-if="report">
      <div class="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-5 py-3 text-[13px]">
        <p>{{ runningText(report.startedAt) }}</p>
        <p>{{ t("status.sockets", { count: count(report.openSockets) }) }}</p>
      </div>

      <div class="flex flex-col gap-3 border-t border-border px-5 py-[18px]">
        <h3 class="text-[14px] font-medium">{{ t("status.lastHour") }}</h3>
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
          {{
            t("status.hourTotals", {
              requests: count(hour.requests),
              sent: formatBytes(hour.bytesDown),
              refused: count(hour.refused),
            })
          }}
        </p>
      </div>

      <div class="flex flex-col gap-3 border-t border-border px-5 py-[18px]">
        <h3 id="status-days" class="text-[14px] font-medium">{{ t("status.days") }}</h3>
        <div class="overflow-x-auto">
          <table aria-labelledby="status-days" class="w-full whitespace-nowrap text-[13px] tabular-nums">
            <thead class="text-muted-foreground">
              <tr>
                <th scope="col" class="py-1.5 pr-3 text-left font-medium">{{ t("status.day") }}</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">{{ t("status.requests") }}</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">{{ t("status.sent") }}</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">{{ t("status.received") }}</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">{{ t("status.refused") }}</th>
                <th scope="col" class="py-1.5 pl-3 text-right font-medium">{{ t("status.failed") }}</th>
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
                <td colspan="6" class="py-2 text-muted-foreground">{{ t("status.noTraffic") }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-[12px] text-gi-subtle">{{ t("status.utc") }}</p>
      </div>

      <div class="flex flex-col gap-1 border-t border-border px-5 py-[18px] text-[13px]">
        <p>{{ t("status.bandwidth", { value: limitText(report.limits.bandwidthPerMinute, "minute") }) }}</p>
        <p>{{ t("status.quota", { value: limitText(report.limits.dailyQuota, "day") }) }}</p>
        <p>{{ t("status.metrics", { value: t(report.limits.metrics ? "status.on" : "status.off") }) }}</p>
        <p class="mt-1 text-[12px] text-gi-subtle">{{ t("status.env") }}</p>
      </div>
    </template>

    <p v-if="error" class="border-t border-border px-5 py-3 text-[13px] text-gi-danger">{{ error }}</p>
  </section>
</template>
