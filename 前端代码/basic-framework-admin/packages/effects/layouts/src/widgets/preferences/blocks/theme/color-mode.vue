<script setup lang="ts">
/**
 * 无障碍配色偏好：弱色模式与灰度模式两个开关。
 * 只写回开关值，实际效果由偏好层在根节点切换 invert-mode 等类名实现。
 */
import { $t } from '@vben/locales';

import SwitchItem from '../switch-item.vue';

defineOptions({
  name: 'PreferenceColorMode',
});

const appColorWeakMode = defineModel<boolean>('appColorWeakMode', {
  default: false,
});

const appColorGrayMode = defineModel<boolean>('appColorGrayMode', {
  default: false,
});
</script>

<template>
  <SwitchItem v-model="appColorWeakMode">
    {{ $t('preferences.theme.weakMode') }}
  </SwitchItem>
  <SwitchItem v-model="appColorGrayMode">
    {{ $t('preferences.theme.grayMode') }}
  </SwitchItem>
</template>
