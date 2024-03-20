<script setup lang="ts">
import WarningMessage from '@/components/WarningMessage.vue';
</script>
<template>
    <div class="container-fluid">

        <div class="flex justify-center">

            <div class="form-control">
                <WarningMessage message="Setting feature not implemented yet" />

                <label class="label cursor-pointer">
                    <input type="checkbox" class="toggle disable" disabled />
                    <span class="label-text pl-5">URL Encryption</span>
                </label>
                <p>If its enabled, its gonna encrypt urls for browser tracking</p>
            </div>
        </div>
    </div>
</template>