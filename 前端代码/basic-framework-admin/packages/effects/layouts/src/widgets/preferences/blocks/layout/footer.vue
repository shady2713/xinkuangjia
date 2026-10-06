<script setup lang="ts">
/**
 * 偏好设置「页脚」分组：控制全局页脚是否显示，以及是否固定在底部。
 * 固定开关依赖显示开关，页脚关闭时不允许单独开启固定；
 * 这里只回写偏好字段，页脚里的版权内容由相邻分组各自维护。
 */
import { $t } from '@vben/locales';

import SwitchItem from '../switch-item.vue';

const footerEnable = defineModel<boolean>('footerEnable');
const footerFixed = defineModel<boolean>('footerFixed');
</script>

<template>
  <SwitchItem v-model="footerEnable">
    {{ $t('preferences.footer.visible') }}
  </SwitchItem>
  <SwitchItem v-model="footerFixed" :disabled="!footerEnable">
    {{ $t('preferences.footer.fixed') }}
  </SwitchItem>
</template>
