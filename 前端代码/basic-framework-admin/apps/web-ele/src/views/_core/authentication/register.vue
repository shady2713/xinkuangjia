<script lang="ts" setup>
/** 管理端默认关闭开放注册，旧书签仅展示说明，不发起注册或验证码请求。 */
import { RouterLink } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';

defineOptions({ name: 'Register' });
</script>

<template>
  <section aria-labelledby="registration-unavailable-title" class="space-y-4">
    <h1 id="registration-unavailable-title" class="text-2xl font-semibold">
      暂未开放注册
    </h1>
    <p class="text-muted-foreground">
      请联系管理员获取账号，然后使用登录页进入系统。
    </p>
    <RouterLink :to="LOGIN_PATH" class="vben-link inline-block">
      返回登录
    </RouterLink>
  </section>
</template>
