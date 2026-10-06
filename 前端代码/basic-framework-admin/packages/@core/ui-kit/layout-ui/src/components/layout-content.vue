<script setup lang="ts">
/**
 * 布局内容区：承载页面主体，按定宽模式与四边内边距属性生成内联样式。
 *
 * 同时渲染 overlay 插槽并把 DOM 引用交给内容区尺寸统计；
 * 滚动阴影、页脚吸底与隐藏逻辑由外壳负责。
 */
import type { CSSProperties } from 'vue';

import type { ContentCompactType } from '@vben-core/typings';

import { computed } from 'vue';

import { useLayoutContentStyle } from '@vben-core/composables';
import { Slot } from '@vben-core/shadcn-ui';

/**
 * 内容区的属性契约：contentCompact 决定是否定宽，为 compact 时内容水平居中并按 contentCompactWidth 定死宽度；
 * padding 是四边内边距的基值，paddingTop、paddingRight、paddingBottom、paddingLeft 逐边覆盖，取值单位均为像素。
 */
interface Props {
  /**
   * 内容区域定宽
   */
  contentCompact: ContentCompactType;
  /**
   * 定宽布局宽度
   */
  contentCompactWidth: number;
  padding: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
}

const props = withDefaults(defineProps<Props>(), {});

// @ts-expect-error unused
const { contentElement, overlayStyle } = useLayoutContentStyle();

/**
 * 内容区的内联样式：定宽模式为 compact 时附加水平居中与固定宽度，其余模式不加宽度限制；
 * flex 为 1 让内容区吃掉父级剩余高度。内边距先写 padding 基值，再由四个方向各自的属性逐边覆盖。
 */
const style = computed((): CSSProperties => {
  const {
    contentCompact,
    padding,
    paddingBottom,
    paddingLeft,
    paddingRight,
    paddingTop,
  } = props;

  const compactStyle: CSSProperties =
    contentCompact === 'compact'
      ? { margin: '0 auto', width: `${props.contentCompactWidth}px` }
      : {};
  return {
    ...compactStyle,
    flex: 1,
    padding: `${padding}px`,
    paddingBottom: `${paddingBottom}px`,
    paddingLeft: `${paddingLeft}px`,
    paddingRight: `${paddingRight}px`,
    paddingTop: `${paddingTop}px`,
  };
});
</script>

<template>
  <main ref="contentElement" :style="style" class="relative bg-background-deep">
    <Slot :style="overlayStyle">
      <slot name="overlay"></slot>
    </Slot>
    <slot></slot>
  </main>
</template>
