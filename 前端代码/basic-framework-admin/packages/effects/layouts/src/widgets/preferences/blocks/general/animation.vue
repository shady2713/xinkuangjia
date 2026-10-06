<script setup lang="ts">
/**
 * 偏好设置「动画」分组：控制切换进度条、加载动画与页面转场开关。
 * 由偏好抽屉的通用分组挂载，转场预设只提供 fade 系列四种可选；
 * 动画样式本身由全局样式表定义，这里只负责选择与回写偏好字段。
 */
import { $t } from '@vben/locales';

import SwitchItem from '../switch-item.vue';

defineOptions({
  name: 'PreferenceAnimation',
});

const transitionProgress = defineModel<boolean>('transitionProgress', {
  // 默认值
  default: false,
});
const transitionName = defineModel<string>('transitionName');
const transitionEnable = defineModel<boolean>('transitionEnable');
const transitionLoading = defineModel<boolean>('transitionLoading');

const transitionPreset = ['fade', 'fade-slide', 'fade-up', 'fade-down'];

/** 选中转场预设时把名称写回偏好；取值来自组件内置的四种预设，不做额外校验。 */
function handleClick(value: string) {
  transitionName.value = value;
}
</script>

<template>
  <SwitchItem v-model="transitionProgress">
    {{ $t('preferences.animation.progress') }}
  </SwitchItem>
  <SwitchItem v-model="transitionLoading">
    {{ $t('preferences.animation.loading') }}
  </SwitchItem>
  <SwitchItem v-model="transitionEnable">
    {{ $t('preferences.animation.transition') }}
  </SwitchItem>
  <div
    v-if="transitionEnable"
    class="mb-2 mt-3 flex justify-between gap-3 px-2"
  >
    <div
      v-for="item in transitionPreset"
      :key="item"
      :class="{
        'outline-box-active': transitionName === item,
      }"
      class="outline-box p-2"
      @click="handleClick(item)"
    >
      <div :class="`${item}-slow`" class="bg-accent h-10 w-12 rounded-md"></div>
    </div>
  </div>
</template>
