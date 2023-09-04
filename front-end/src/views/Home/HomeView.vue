<script setup lang="ts">
import { reactive, ref, type Reactive, type Ref, onMounted } from 'vue'
import { getRandomInternetFact, IRandomInternetFacts } from './data/internetFacts'
import { getRandomPlaceholder, type textPlaceholder } from './data/inputPlaceholders'

import IProxyForm from '@/interfaces/IProxyForm'
const proxyFormData: Reactive<IProxyForm> = reactive({ url: '' })
const textPlaceholder: Ref<textPlaceholder> = ref('')
const error: Ref<string | null> = ref(null)

const randomFactAboutInternet: Reactive<IRandomInternetFacts> = reactive({
    text: '',
    source: ''
})

const handleFormTextInputClick = () => {
    proxyFormData.url = 'https://'
}

const handleFormButtonInputClick = () => {
    if (isValidUrl(proxyFormData.url)) {
        window.location.href = `/proxy/${proxyFormData.url}`
    } else {
        error.value = 'Please enter a valid URL'
    }
}

const isValidUrl = (url: string) => {
    const pattern = new RegExp(
        '^(https?:\\/\\/)?' + // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
        '(\\#[-a-z\\d_]*)?$', // fragment locator
        'i'
    )
    return pattern.test(url)
}

onMounted(() => {
    const { text: randomFactText, source: randomFactTextSource } = getRandomInternetFact()
    randomFactAboutInternet.text = randomFactText
    randomFactAboutInternet.source = randomFactTextSource

    const randomPlaceholder = getRandomPlaceholder()
    textPlaceholder.value = randomPlaceholder
})
</script>

<template>
    <div class="px-5 py-5 p-lg-0 bg-surface-secondary">
        <div class="d-flex justify-content-center">
            <div
                class="col-lg-5 col-xl-4 p-12 p-xl-20 position-fixed start-0 top-0 h-screen overflow-y-hidden bg-primary d-none d-lg-flex flex-column">
                <a class="d-block" href="#">
                    <img src="@/assets/images/logo.png" class="h-12" alt="Girici Web Proxy Logo" />
                </a>
                <div class="mt-32 mb-20">
                    <h1 class="ls-tight font-bolder display-6 text-white mb-5">
                        It's nice day for unblock websites
                    </h1>
                    <p class="text-white text-opacity-75">
                        {{ randomFactAboutInternet.text }}
                    </p>

                    <p>
                        <a class="text-white" :href="randomFactAboutInternet.source" target="_blank">Source</a>
                    </p>
                </div>
                <div
                    class="w-56 h-56 bg-orange-500 rounded-circle position-absolute bottom-0 end-20 transform translate-y-1/3">
                </div>
            </div>
            <div
                class="col-12 col-md-9 col-lg-7 offset-lg-5 border-left-lg min-h-lg-screen d-flex flex-column justify-content-center py-lg-16 px-lg-20 position-relative">
                <div class="row">
                    <div class="col-lg-12 col-md-9 col-xl-12 mx-auto ms-xl-0">
                        <div class="mt-10 mt-lg-5 mb-6 d-flex align-items-center d-lg-block">
                            <div v-show="error">
                                <div class="alert alert-danger mb-5" role="alert">
                                    {{ error }}
                                </div>
                            </div>
                            <span class="d-inline-block d-lg-block h1 mb-lg-6 me-3">👋</span>
                            <h1 class="ls-tight font-bolder h2 mb-5">Let's surf on net!</h1>
                            <input type="text" class="form-control" @click="handleFormTextInputClick"
                                :placeholder="textPlaceholder" v-model="proxyFormData.url" />
                            <a @click="handleFormButtonInputClick" class="btn btn-primary mt-5 w-100">Unblock</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
