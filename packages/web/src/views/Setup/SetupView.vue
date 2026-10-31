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
    error.value = e instanceof Error ? e.message : "Setup failed.";
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
          <h1 class="text-[22px] font-semibold tracking-[-0.03em]">Set up {{ brand.name }}</h1>
          <p class="mt-1 text-[14px] text-muted-foreground">Create the admin account that controls this proxy.</p>
        </div>
      </div>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label class="flex flex-col gap-2 text-[14px] font-medium">
            Setup code
            <Input v-model="setupToken" type="text" autocomplete="off" spellcheck="false" required />
          </label>
          <p class="text-[13px] text-muted-foreground">
            Girici prints it in the server log at startup. With Docker, run docker logs on the container.
          </p>
        </div>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          Username
          <Input v-model="username" type="text" autocomplete="username" required />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          Name
          <Input v-model="name" type="text" autocomplete="name" required />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          Email
          <Input v-model="email" type="email" autocomplete="email" required />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          Password
          <Input v-model="password" type="password" autocomplete="new-password" minlength="8" required />
        </label>
      </div>

      <Button type="submit" :disabled="busy">{{ busy ? "Creating…" : "Create admin" }}</Button>

      <p class="text-center text-[13px]"><SourceLink /></p>
    </form>
  </div>
</template>
