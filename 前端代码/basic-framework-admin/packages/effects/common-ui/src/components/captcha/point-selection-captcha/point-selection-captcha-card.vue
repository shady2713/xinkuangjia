<script setup lang="ts">
/**
 * 点选验证码卡片外壳：按传入尺寸换算出根内边距与图片大小，
 * 提供标题、附加操作、图片区与底部提示四个插槽位，
 * 图片上的原生点击事件原样上抛，不采集点位也不判断越界。
 */
import type { PointSelectionCaptchaCardProps } from '../types';

import { computed } from 'vue';

import { $t } from '@vben/locales';

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@vben-core/shadcn-ui';

const props = withDefaults(defineProps<PointSelectionCaptchaCardProps>(), {
  height: '220px',
  paddingX: '12px',
  paddingY: '16px',
  title: '',
  width: '300px',
});

const emit = defineEmits<{
  click: [MouseEvent];
}>();

/**
 * 把尺寸配置解析为像素数值。
 * @param value 数字或带单位字符串（如 '300px'）。
 * @returns 解析后的数值；字符串无法解析为数字时返回 0。
 */
const parseValue = (value: number | string) => {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** 根卡片样式：由内边距与图片宽度算出卡片总宽度。 */
const rootStyles = computed(() => ({
  padding: `${parseValue(props.paddingY)}px ${parseValue(props.paddingX)}px`,
  width: `${parseValue(props.width) + parseValue(props.paddingX) * 2}px`,
}));

/** 图片样式：按配置直接给出宽高像素值。 */
const captchaStyles = computed(() => {
  return {
    height: `${parseValue(props.height)}px`,
    width: `${parseValue(props.width)}px`,
  };
});

/** 把图片上的点击事件原样上抛，不做坐标换算。 */
function handleClick(e: MouseEvent) {
  emit('click', e);
}
</script>
<template>
  <Card :style="rootStyles" aria-labelledby="captcha-title" role="region">
    <CardHeader class="p-0">
      <CardTitle id="captcha-title" class="flex items-center justify-between">
        <template v-if="$slots.title">
          <slot name="title">{{ $t('ui.captcha.title') }}</slot>
        </template>
        <template v-else>
          <span>{{ title }}</span>
        </template>
        <div class="flex items-center justify-end">
          <slot name="extra"></slot>
        </div>
      </CardTitle>
    </CardHeader>
    <CardContent class="relative mt-2 flex w-full overflow-hidden rounded p-0">
      <img
        v-show="captchaImage"
        :alt="$t('ui.captcha.alt')"
        :src="captchaImage"
        :style="captchaStyles"
        class="relative z-10"
        @click="handleClick"
      />
      <div class="absolute inset-0">
        <slot></slot>
      </div>
    </CardContent>
    <CardFooter class="mt-2 flex justify-between p-0">
      <slot name="footer"></slot>
    </CardFooter>
  </Card>
</template>
