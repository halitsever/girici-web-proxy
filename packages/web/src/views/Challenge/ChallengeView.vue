<script setup lang="ts">
import { CHALLENGE_PATH } from "@girici/engine/shared";
import { LoaderCircle } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/layout/BrandMark.vue";
import SourceLink from "@/components/layout/SourceLink.vue";
import { resolveNext } from "@/lib/next";
import { fetchChallenge, solveInWorker, submitSolution } from "@/lib/pow";

const route = useRoute();
const router = useRouter();
const error = ref("");
const busy = ref(false);

onMounted(run);

async function run() {
  error.value = "";
  busy.value = true;
  try {
    const challenge = await fetchChallenge();
    const nonce = await solveInWorker(challenge);
    await submitSolution({ challenge: challenge.challenge, nonce });
    goNext();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "The check did not go through. Reload the page to try again.";
    busy.value = false;
  }
}

/** Replaces this entry, so Back from the page skips the check instead of running it again. */
function goNext() {
  const next = resolveNext(typeof route.query.next === "string" ? route.query.next : "");
  if (next.kind === "proxy") {
    window.location.replace(next.path);
    return;
  }
  const own = next.kind === "route" && new URL(next.path, window.location.origin).pathname !== CHALLENGE_PATH;
  void router.replace(own ? next.path : "/");
}
</script>

<template>
  <div class="grid min-h-screen place-items-center px-4 py-10">
    <div class="flex w-full max-w-[400px] flex-col gap-6">
      <div class="flex flex-col items-center gap-3 text-center">
        <BrandMark size="lg" :show-name="false" />
        <div>
          <h1 class="text-[22px] font-semibold tracking-[-0.03em]">Checking your browser</h1>
          <p class="mt-1 text-[14px] text-muted-foreground">This takes a few seconds and happens about once a day.</p>
        </div>
      </div>

      <div v-if="busy" class="flex justify-center text-muted-foreground" role="status" aria-label="Checking">
        <LoaderCircle class="size-6 animate-spin" aria-hidden="true" />
      </div>

      <template v-if="error">
        <Alert variant="destructive">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <Button @click="run">Try again</Button>
      </template>

      <p class="text-center text-[13px]"><SourceLink /></p>
    </div>
  </div>
</template>
