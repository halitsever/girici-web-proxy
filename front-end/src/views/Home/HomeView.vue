<script setup lang="ts">
import { type Ref, ref } from 'vue';
import { getRandomPlaceholder } from './util/place-holder';
import { isValidUrl } from './util/url-checker';
import WarningMessage from '@/components/WarningMessage.vue';
const targetUrl: Ref<string | null> = ref(null);
const errorMessage: Ref<string | null> = ref(null);

const handleFormTextInputClick = () => {
  targetUrl.value = 'https://';
};

const handleFormButtonInputClick = () => {
  if (isValidUrl(targetUrl.value)) {
    window.location.href = `/proxy/${targetUrl.value}`
  } else {
    errorMessage.value = 'Please enter a valid URL'
  }
}
</script>

<template>
  <main class="container-fluid mt-64">

    <div class="flex justify-center flex-col items-center  ">
      <WarningMessage class="w-2/5" @click="errorMessage = null" v-if="errorMessage" :message="errorMessage" />

      <input type="text" v-model="targetUrl" @click="handleFormTextInputClick" :placeholder="getRandomPlaceholder()"
        class="input input-bordered w-2/5" />
      <button class="btn btn-primary w-2/5 tooltip mt-3" @click="handleFormButtonInputClick"
        data-tip="Go to website via proxy">Unblock</button>
    </div>

  </main>
</template>
