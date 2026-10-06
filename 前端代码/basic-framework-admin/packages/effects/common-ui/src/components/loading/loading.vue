<script lang="ts" setup>
/**
 * 加载容器组件：包裹内容区并叠加 VbenLoading 遮罩，
 * 由 spinning 控制显隐，minLoadingTime 决定最短停留
 * 时长以避免闪烁，text 自定义提示文案，icon 插槽换图标。
 * 与 spinner.vue 的区别是带文字；不负责请求与错误处理。
 */
import { VbenLoading } from '@vben-core/shadcn-ui';
import { cn } from '@vben-core/shared/utils';

interface LoadingProps {
  class?: string;
  /**
   * @zh_CN 最小加载时间
   * @en_US Minimum loading time
   */
  minLoadingTime?: number;

  /**
   * @zh_CN loading状态开启
   */
  spinning?: boolean;
  /**
   * @zh_CN 文字
   */
  text?: string;
}

defineOptions({ name: 'Loading' });
const props = defineProps<LoadingProps>();
</script>
<template>
  <div :class="cn('relative min-h-20', props.class)">
    <slot></slot>
    <VbenLoading
      :min-loading-time="props.minLoadingTime"
      :spinning="props.spinning"
      :text="props.text"
    >
      <template v-if="$slots.icon" #icon>
        <slot name="icon"></slot>
      </template>
    </VbenLoading>
  </div>
</template>
