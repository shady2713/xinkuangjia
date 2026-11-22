<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-[#f1f3f6] p-6">
    <div class="text-6xl font-bold text-[#006be6]">403</div>
    <p class="mt-3 text-base text-[#475569]">抱歉，您没有访问该页面的权限</p>
    <el-button type="primary" class="mt-5" @click="router.replace('/dashboard')">
      返回首页
    </el-button>
  </div>
</template>
