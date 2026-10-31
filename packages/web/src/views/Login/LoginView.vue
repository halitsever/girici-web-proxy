<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/layout/BrandMark.vue";
import SourceLink from "@/components/layout/SourceLink.vue";
import { Input } from "@/components/ui/input";
import { getAuthState, login } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { toProxyPath } from "@/lib/target";

const route = useRoute();
const router = useRouter();
const username = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);
const publicAccess = ref(false);

onMounted(async () => {
  publicAccess.value = (await getAuthState().catch(() => null))?.public ?? false;
});

async function onSubmit() {
  error.value = "";
  busy.value = true;
  try {
    await login(username.value, password.value);
    goNext();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Sign-in failed.";
    busy.value = false;
  }
}

/**
 * ?next is either a Girici page the router guard sent here, such as /account, or the real target of a proxied
 * navigation the SW sent here, which reopens through the proxy.
 */
function goNext() {
  const next = typeof route.query.next === "string" ? route.query.next : "";
  // "//host" and "/\host" would leave Girici, so only a single leading slash counts as one of our pages.
  if (/^\/(?![/\\])/.test(next)) {
    void router.replace(next);
    return;
  }
  const proxied = next ? toProxyPath(next) : null;
  if (proxied) window.location.assign(proxied);
  else void router.replace("/");
}
</script>

<template>
  <div class="grid min-h-screen place-items-center px-4 py-10">
    <form class="flex w-full max-w-[400px] flex-col gap-6" @submit.prevent="onSubmit">
      <div class="flex flex-col items-center gap-3 text-center">
        <BrandMark size="lg" :show-name="false" />
        <div>
          <h1 class="text-[22px] font-semibold tracking-[-0.03em]">Sign in to {{ brand.name }}</h1>
          <p class="mt-1 text-[14px] text-muted-foreground">This proxy is private. Sign in to keep browsing.</p>
        </div>
      </div>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div class="flex flex-col gap-4">
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          Username
          <Input v-model="username" type="text" autocomplete="username" required />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          Password
          <Input v-model="password" type="password" autocomplete="current-password" required />
        </label>
      </div>

      <Button type="submit" :disabled="busy">{{ busy ? "Signing in…" : "Sign in" }}</Button>

      <RouterLink
        v-if="publicAccess"
        to="/"
        class="text-center text-[13px] text-muted-foreground no-underline transition-colors hover:text-foreground"
      >
        Continue without signing in
      </RouterLink>

      <p class="text-center text-[13px]"><SourceLink /></p>
    </form>
  </div>
</template>
