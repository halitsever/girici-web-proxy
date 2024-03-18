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
            </div>
        </div>
    </div>
</template>