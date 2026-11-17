<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { LockKeyhole } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initials } from "@/lib/account";
import { getAuthState, logout, updateAccount, type AdminInfo } from "@/lib/auth";
import { t } from "@/lib/i18n";

const router = useRouter();
const admin = ref<AdminInfo>({ username: "", name: "", email: "" });
const name = ref("");
const email = ref("");
const password = ref("");
const confirm = ref("");
// Kept in memory only, so it is gone once the page closes.
const currentPassword = ref("");
const savedProfile = ref(false);
const savedPassword = ref(false);
const profileError = ref("");
const passwordError = ref("");

const monogram = computed(() => initials(name.value) || "G");

async function onSaveProfile() {
  profileError.value = "";
  savedProfile.value = false;
  if (!currentPassword.value) {
    profileError.value = t("error.passwordFirst");
    return;
  }
  try {
    admin.value = await updateAccount({ name: name.value, email: email.value, currentPassword: currentPassword.value });
    savedProfile.value = true;
  } catch (e) {
    profileError.value = e instanceof Error ? e.message : t("account.saveFailed");
  }
}

async function onChangePassword() {
  passwordError.value = "";
  savedPassword.value = false;
  if (password.value.length < 8) {
    passwordError.value = t("account.tooShort");
    return;
  }
  if (password.value !== confirm.value) {
    passwordError.value = t("account.mismatch");
    return;
  }
  if (!currentPassword.value) {
    passwordError.value = t("error.passwordFirst");
    return;
  }
  try {
    await updateAccount({
      name: name.value,
      email: email.value,
      password: password.value,
      currentPassword: currentPassword.value,
    });
    // The server now checks the next save against the new password.
    currentPassword.value = password.value;
    password.value = "";
    confirm.value = "";
    savedPassword.value = true;
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : t("account.passwordFailed");
  }
}

async function onSignOut(everywhere = false) {
  await logout(everywhere);
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
  <div class="mx-auto flex w-full max-w-[760px] flex-col gap-12 px-5" style="padding-top: clamp(24px, 6vh, 56px)">
    <div class="flex flex-wrap items-center justify-between gap-6">
      <div class="flex min-w-0 items-center gap-5">
        <!-- The monogram in the logo's ring, its route reaching in. -->
        <span class="badge relative grid h-[72px] w-[72px] shrink-0 place-items-center" aria-hidden="true">
          <span class="badge-ring absolute inset-0 rounded-full border-[6px] border-[#fafafa] border-r-transparent" />
          <span class="badge-route absolute top-1/2 right-[-6px] h-[10px] w-[30px] -translate-y-1/2 bg-gi-brand" />
          <span class="relative -translate-x-2.5 text-[22px] font-semibold">{{ monogram }}</span>
        </span>
        <div class="min-w-0">
          <h1 class="truncate text-[clamp(28px,4vw,40px)] leading-tight font-semibold tracking-[-0.04em]">
            {{ admin.name || t("account.admin") }}
          </h1>
          <p class="truncate font-mono text-[14px] text-muted-foreground">@{{ admin.username }}</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" @click="onSignOut()">{{ t("account.signOut") }}</Button>
        <Button type="button" variant="outline" size="sm" @click="onSignOut(true)">{{
          t("account.signOutEverywhere")
        }}</Button>
      </div>
    </div>

    <div class="flex items-start gap-4 rounded-2xl border border-[#2c3a66] bg-[#0f1733] p-5">
      <span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gi-brand/15 text-[#6e90ff]">
        <LockKeyhole class="h-4 w-4" aria-hidden="true" />
      </span>
      <div class="min-w-0 flex-1">
        <label class="flex flex-col gap-2 text-[14px] font-medium">
          {{ t("account.currentPassword") }}
          <Input v-model="currentPassword" type="password" autocomplete="current-password" />
        </label>
        <p class="mt-2 text-[13px] text-muted-foreground">{{ t("account.currentPasswordHelp") }}</p>
      </div>
    </div>

    <section class="flex flex-col gap-5">
      <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t("account.profile") }}</h2>
      <div class="rounded-2xl border border-border bg-gi-panel p-5">
        <Alert v-if="profileError" variant="destructive" class="mb-4">
          <AlertDescription>{{ profileError }}</AlertDescription>
        </Alert>
        <div class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
          <label class="flex flex-col gap-2 text-[14px] font-medium">
            {{ t("account.name") }}
            <Input v-model="name" type="text" autocomplete="name" />
          </label>
          <label class="flex flex-col gap-2 text-[14px] font-medium">
            {{ t("account.email") }}
            <Input v-model="email" type="email" autocomplete="email" />
          </label>
        </div>
        <div class="mt-5 flex items-center justify-end gap-3">
          <Transition name="note">
            <span v-if="savedProfile" class="text-[13px] text-gi-success">{{ t("account.saved") }}</span>
          </Transition>
          <Button type="button" size="sm" @click="onSaveProfile">{{ t("account.save") }}</Button>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-5">
      <div>
        <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t("account.changePassword") }}</h2>
        <p class="mt-1 text-[14px] text-muted-foreground">{{ t("account.changePasswordHelp") }}</p>
      </div>
      <div class="rounded-2xl border border-border bg-gi-panel p-5">
        <Alert v-if="passwordError" variant="destructive" class="mb-4">
          <AlertDescription>{{ passwordError }}</AlertDescription>
        </Alert>
        <div class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
          <label class="flex flex-col gap-2 text-[14px] font-medium">
            {{ t("account.newPassword") }}
            <Input v-model="password" type="password" autocomplete="new-password" />
          </label>
          <label class="flex flex-col gap-2 text-[14px] font-medium">
            {{ t("account.confirm") }}
            <Input v-model="confirm" type="password" autocomplete="new-password" />
          </label>
        </div>
        <div class="mt-5 flex items-center justify-end gap-3">
          <Transition name="note">
            <span v-if="savedPassword" class="text-[13px] text-gi-success">{{ t("account.passwordChanged") }}</span>
          </Transition>
          <Button type="button" size="sm" @click="onChangePassword">{{ t("account.changePassword") }}</Button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .badge-ring {
    animation: turn-in 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  }
  .badge-route {
    transform-origin: right center;
    animation: extend 0.6s cubic-bezier(0.6, 0, 0.2, 1) 0.35s backwards;
  }
  .note-enter-active {
    transition:
      opacity 0.3s ease,
      transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .note-enter-from {
    opacity: 0;
    transform: translateX(8px);
  }
}
@keyframes turn-in {
  from {
    opacity: 0;
    transform: rotate(-120deg) scale(0.8);
  }
}
@keyframes extend {
  from {
    transform: scaleX(0);
  }
}
</style>
