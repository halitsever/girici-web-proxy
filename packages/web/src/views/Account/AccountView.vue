<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initials } from "@/lib/account";
import { getAuthState, logout, updateAccount, type AdminInfo } from "@/lib/auth";

const router = useRouter();
const admin = ref<AdminInfo>({ username: "", name: "", email: "" });
const name = ref("");
const email = ref("");
const password = ref("");
const confirm = ref("");
const savedProfile = ref(false);
const savedPassword = ref(false);
const profileError = ref("");
const passwordError = ref("");

const monogram = computed(() => initials(name.value) || "G");

async function onSaveProfile() {
  profileError.value = "";
  savedProfile.value = false;
  try {
    admin.value = await updateAccount({ name: name.value, email: email.value });
    savedProfile.value = true;
  } catch (e) {
    profileError.value = e instanceof Error ? e.message : "Could not save.";
  }
}

async function onChangePassword() {
  passwordError.value = "";
  savedPassword.value = false;
  if (password.value.length < 8) {
    passwordError.value = "The password needs at least 8 characters.";
    return;
  }
  if (password.value !== confirm.value) {
    passwordError.value = "The two passwords do not match.";
    return;
  }
  try {
    await updateAccount({ name: name.value, email: email.value, password: password.value });
    password.value = "";
    confirm.value = "";
    savedPassword.value = true;
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : "Could not change the password.";
  }
}

async function onSignOut() {
  await logout();
  // Let the guard decide: Browse when public, the login page when private.
  await router.replace("/");
}

onMounted(async () => {
  const state = await getAuthState(true);
  if (state.admin) {
    admin.value = state.admin;
    name.value = state.admin.name;
    email.value = state.admin.email;
  }
});
</script>

<template>
  <div class="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-4" style="padding-top: clamp(28px, 6vh, 56px)">
    <div class="flex items-center gap-4">
      <div
        class="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gi-brand text-[20px] font-semibold text-white"
      >
        {{ monogram }}
      </div>
      <div class="min-w-0">
        <p class="truncate text-[22px] font-semibold tracking-[-0.03em]">{{ admin.name || "Admin" }}</p>
        <p class="truncate text-[14px] text-muted-foreground">@{{ admin.username }}</p>
      </div>
    </div>

    <div class="rounded-xl border border-border bg-gi-panel p-5">
      <p class="text-[15px] font-semibold">Profile</p>
      <Alert v-if="profileError" variant="destructive" class="mt-4">
        <AlertDescription>{{ profileError }}</AlertDescription>
      </Alert>
      <div class="mt-4 grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          Name
          <Input v-model="name" type="text" autocomplete="name" />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          Email
          <Input v-model="email" type="email" autocomplete="email" />
        </label>
      </div>
      <div class="mt-4 flex items-center justify-end gap-3">
        <span v-if="savedProfile" class="text-[13px] text-gi-success">Saved</span>
        <Button type="button" size="sm" @click="onSaveProfile">Save changes</Button>
      </div>
    </div>

    <div class="rounded-xl border border-border bg-gi-panel p-5">
      <p class="text-[15px] font-semibold">Change password</p>
      <p class="mt-1 text-[13px] text-muted-foreground">Changing it signs out every other device.</p>
      <Alert v-if="passwordError" variant="destructive" class="mt-4">
        <AlertDescription>{{ passwordError }}</AlertDescription>
      </Alert>
      <div class="mt-4 grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          New password
          <Input v-model="password" type="password" autocomplete="new-password" />
        </label>
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          Confirm
          <Input v-model="confirm" type="password" autocomplete="new-password" />
        </label>
      </div>
      <div class="mt-4 flex items-center justify-end gap-3">
        <span v-if="savedPassword" class="text-[13px] text-gi-success">Password changed</span>
        <Button type="button" size="sm" @click="onChangePassword">Change password</Button>
      </div>
    </div>

    <Button type="button" variant="outline" size="sm" class="self-start" @click="onSignOut">Sign out</Button>
  </div>
</template>
