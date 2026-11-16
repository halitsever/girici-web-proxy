<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/layout/BrandMark.vue";
import SourceLink from "@/components/layout/SourceLink.vue";
import { Input } from "@/components/ui/input";
import { setupAdmin } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { t } from "@/lib/i18n";

const router = useRouter();
const setupToken = ref("");
const username = ref("");
const name = ref("");
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function onSubmit() {
  error.value = "";
  busy.value = true;
  try {
    await setupAdmin({
      setupToken: setupToken.value,
      username: username.value,
      name: name.value,
      email: email.value,
      password: password.value,
    });
    await router.replace("/");
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("setup.failed");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-screen place-items-center px-4 py-10">
    <form class="flex w-full max-w-[400px] flex-col gap-6" @submit.prevent="onSubmit">
      <div class="flex flex-col items-center gap-3 text-center">
        <BrandMark size="lg" :show-name="false" />
        <div>
          <h1 class="text-[22px] font-semibold tracking-[-0.03em]">{{ t("setup.title", { brand: brand.name }) }}</h1>
          <p class="mt-1 text-[14px] text-muted-foreground">{{ t("setup.lead") }}</p>
        </div>
      </div>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label class="flex flex-col gap-2 text-[14px] font-medium">
            {{ t("setup.code") }}
            <Input v-model="setupToken" type="text" autocomplete="off" spellcheck="false" required />
          </label>
          <p class="text-[13px] text-muted-foreground">{{ t("setup.codeHelp") }}</p>
        </div>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          {{ t("login.username") }}
          <Input v-model="username" type="text" autocomplete="username" required />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          {{ t("setup.name") }}
          <Input v-model="name" type="text" autocomplete="name" required />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          {{ t("setup.email") }}
          <Input v-model="email" type="email" autocomplete="email" required />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          {{ t("login.password") }}
          <Input v-model="password" type="password" autocomplete="new-password" minlength="8" required />
        </label>
      </div>

      <Button type="submit" :disabled="busy">{{ busy ? t("setup.busy") : t("setup.submit") }}</Button>

      <p class="text-center text-[13px]"><SourceLink /></p>
    </form>
  </div>
</template>
