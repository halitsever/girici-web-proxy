<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import AuthShell from "@/components/layout/AuthShell.vue";
import BrandMark from "@/components/layout/BrandMark.vue";
import SourceLink from "@/components/layout/SourceLink.vue";
import { Input } from "@/components/ui/input";
import { getAuthState, login } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { resolveNext } from "@/lib/next";

const route = useRoute();
const router = useRouter();
const username = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);
const publicAccess = ref(false);
const siteDomain = ref<string | null>(null);

onMounted(async () => {
  const state = await getAuthState().catch(() => null);
  publicAccess.value = state?.public ?? false;
  siteDomain.value = state?.siteDomain ?? null;
});

async function onSubmit() {
  error.value = "";
  busy.value = true;
  try {
    const state = await login(username.value, password.value);
    goNext(state.siteDomain ?? siteDomain.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("login.failed");
    busy.value = false;
  }
}

function goNext(domain: string | null) {
  const next = resolveNext(typeof route.query.next === "string" ? route.query.next : "", domain);
  if (next.kind === "proxy") window.location.assign(next.path);
  else if (next.kind === "site") window.location.assign(next.url);
  else void router.replace(next.kind === "route" ? next.path : "/");
}
</script>

<template>
  <AuthShell>
    <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
      <div class="flex flex-col gap-5">
        <BrandMark size="lg" :show-name="false" class="lg:hidden" />
        <div>
          <h1 class="text-[30px] leading-tight font-semibold tracking-[-0.04em]">
            {{ t("login.title", { brand: brand.name }) }}
          </h1>
          <p class="mt-2 text-[15px] text-muted-foreground">{{ t("login.lead") }}</p>
        </div>
      </div>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div class="flex flex-col gap-4">
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          {{ t("login.username") }}
          <Input v-model="username" type="text" autocomplete="username" required />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          {{ t("login.password") }}
          <Input v-model="password" type="password" autocomplete="current-password" required />
        </label>
      </div>

      <Button type="submit" :disabled="busy">{{ busy ? t("login.busy") : t("login.submit") }}</Button>

      <RouterLink
        v-if="publicAccess"
        to="/"
        class="text-[13px] text-muted-foreground no-underline transition-colors hover:text-foreground"
      >
        {{ t("login.skip") }}
      </RouterLink>

      <p class="text-[13px]"><SourceLink /></p>
    </form>
  </AuthShell>
</template>
