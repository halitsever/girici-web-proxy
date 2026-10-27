<script setup lang="ts">
import { onMounted, ref } from "vue";
import { openProxied, serviceWorkerSupport } from "@/lib/proxy";
import { resolveInput } from "@/lib/target";
import { getRandomInternetFact, type InternetFact } from "./data/internetFacts";
import { getRandomPlaceholder } from "./data/inputPlaceholders";
import "./home.css";

const url = ref("");
const placeholder = ref("");
const error = ref<string | null>(null);
const fact = ref<InternetFact>({ text: "", source: "" });

async function onSubmit() {
  const path = resolveInput(url.value);
  if (!path) {
    error.value = "Please enter a valid URL";
    return;
  }
  const support = serviceWorkerSupport({
    isSecureContext: window.isSecureContext,
    hasServiceWorker: "serviceWorker" in navigator,
  });
  if (support === "insecure") {
    error.value = "Girici needs HTTPS (or localhost) to run in this browser.";
    return;
  }
  if (support === "unsupported") {
    error.value = "This browser does not support service workers, which Girici needs.";
    return;
  }
  error.value = null;
  try {
    await openProxied(path);
  } catch (cause) {
    error.value = `Could not start the proxy engine: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

onMounted(() => {
  fact.value = getRandomInternetFact();
  placeholder.value = getRandomPlaceholder();
});
</script>

<template>
  <div class="home">
    <div class="d-flex justify-content-center">
      <aside
        class="home-aside col-lg-5 col-xl-4 position-fixed start-0 top-0 overflow-y-hidden d-none d-lg-flex flex-column"
      >
        <a class="home-brand" href="/">
          <img src="@/assets/brand/girici-icon-dark.svg" class="home-brand__icon" alt="" />
          <span class="home-brand__wordmark">Girici</span>
        </a>
        <div class="home-aside__content">
          <h1 class="home-aside__title">It's nice day for unblock websites</h1>
          <p class="home-aside__fact">{{ fact.text }}</p>
          <p><a class="home-aside__source" :href="fact.source" target="_blank" rel="noopener noreferrer">Source</a></p>
        </div>
      </aside>
      <main
        class="home-main col-12 col-md-9 col-lg-7 offset-lg-5 d-flex flex-column justify-content-center position-relative"
      >
        <div class="row">
          <div class="col-lg-12 col-md-9 col-xl-12 mx-auto ms-xl-0">
            <div class="home-panel">
              <a class="home-brand home-brand--light d-lg-none" href="/">
                <img src="@/assets/brand/girici-icon.svg" class="home-brand__icon" alt="" />
                <span class="home-brand__wordmark">Girici</span>
              </a>
              <div v-if="error" class="alert alert-danger home-alert" role="alert">{{ error }}</div>
              <div class="d-flex align-items-center d-lg-block">
                <span class="home-wave" aria-hidden="true">👋</span>
                <h1 class="home-title">Let's surf on net!</h1>
              </div>
              <form @submit.prevent="onSubmit">
                <input
                  v-model="url"
                  type="text"
                  name="url"
                  class="form-control home-input"
                  inputmode="url"
                  autocomplete="url"
                  autocapitalize="off"
                  spellcheck="false"
                  :placeholder="placeholder"
                  aria-label="Website address"
                />
                <button type="submit" class="btn btn-primary home-submit">Unblock</button>
              </form>
              <p class="home-footer"><a href="/_g/source">Source code (AGPL-3.0)</a></p>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
