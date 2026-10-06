<script setup lang="ts">
/**
 * 头像组件：在 reka-ui 头像原语上补尺寸、填充方式
 * 与右下角状态圆点，图片缺失时用 alt 末两位字母兜底。
 * 不负责上传、裁剪，也不判断在线状态。
 */
import type {
  AvatarFallbackProps,
  AvatarImageProps,
  AvatarRootProps,
} from 'reka-ui';

import type { CSSProperties } from 'vue';

import type { ClassType } from '@vben-core/typings';

import { computed } from 'vue';

import { Avatar, AvatarFallback, AvatarImage } from '../../ui';

/**
 * 头像入参：在 reka-ui 头像三个原语的属性之上补充本组件独有的展示控制。
 * size 用像素正方形约束外框，fit 决定图片填充方式，dot 开关右下角状态点，
 * alt 既是图片的替代文本，也是图片加载失败时兜底文字的取字来源。
 */
interface Props extends AvatarFallbackProps, AvatarImageProps, AvatarRootProps {
  alt?: string;
  class?: ClassType;
  dot?: boolean;
  dotClass?: ClassType;
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  size?: number;
}

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(defineProps<Props>(), {
  alt: 'avatar',
  as: 'button',
  dot: false,
  dotClass: 'bg-green-500',
  fit: 'cover',
});

/**
 * 把 fit 映射为图片容器的 object-fit 样式；fit 为空或未设置时返回空对象，
 * 让图片沿用 AvatarImage 自带的默认填充方式。
 */
const imageStyle = computed<CSSProperties>(() => {
  const { fit } = props;
  if (fit) {
    return { objectFit: fit };
  }
  return {};
});

/**
 * 图片加载失败时展示的兜底文字，取 alt 末两位并转大写，
 * 目的是在无头像图时仍能看出这个头像属于谁。alt 短于两位时按实际长度截取。
 */
const text = computed(() => {
  return props.alt.slice(-2).toUpperCase();
});

/**
 * 由 size 生成外框的正方形像素尺寸；size 未设置或非正数时返回空对象，
 * 此时外框宽度由容器与 Avatar 自身的 size-full 决定。
 */
const rootStyle = computed(() => {
  return props.size !== undefined && props.size > 0
    ? {
        height: `${props.size}px`,
        width: `${props.size}px`,
      }
    : {};
});
</script>

<template>
  <div
    :class="props.class"
    :style="rootStyle"
    class="relative flex flex-shrink-0 items-center"
  >
    <Avatar :class="props.class" class="size-full">
      <AvatarImage :alt="alt" :src="src" :style="imageStyle" />
      <AvatarFallback>{{ text }}</AvatarFallback>
    </Avatar>
    <span
      v-if="dot"
      :class="dotClass"
      class="absolute bottom-0 right-0 size-3 rounded-full border-2 border-background"
    >
    </span>
  </div>
</template>
