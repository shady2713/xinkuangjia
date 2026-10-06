<script lang="ts" setup>
/**
 * 加载指示组件：包裹内容区并叠加 VbenSpinner 转圈遮罩，
 * 由 spinning 控制显隐，minLoadingTime 决定最短停留时长。
 * 与 loading.vue 的分工是不带文字提示；请求发起与错误
 * 处理同样不在本组件职责内。
 */
import { VbenSpinner } from '@vben-core/shadcn-ui';
import { cn } from '@vben-core/shared/utils';

/** 转圈指示属性：最小停留时长、加载状态与附加类名。 */
interface SpinnerProps {
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
}
defineOptions({ name: 'Spinner' });
const props = defineProps<SpinnerProps>();
</script>
<template>
  <div :class="cn('relative min-h-20', props.class)">
    <slot></slot>
    <VbenSpinner
      :min-loading-time="props.minLoadingTime"
      :spinning="props.spinning"
    />
  </div>
</template>
