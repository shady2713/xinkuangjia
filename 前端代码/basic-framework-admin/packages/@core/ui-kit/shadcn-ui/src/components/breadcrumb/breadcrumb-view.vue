<script lang="ts" setup>
/** 面包屑渲染视图：按 styleType 在普通面包屑与带背景样式之间切换，并把选中项事件向上抛出。 */
import type { ClassValue } from '@vben-core/shared/utils';

import type { BreadcrumbProps } from './types';

import { useForwardPropsEmits } from 'reka-ui';

import BreadcrumbBackground from './breadcrumb-background.vue';
import Breadcrumb from './breadcrumb.vue';

/**
 * 视图层入参：在面包屑契约上补一个 class，
 * 由 Vue 的属性透传合并到实际渲染的样式组件根节点，便于外部定制外观。
 */
interface Props extends BreadcrumbProps {
  /** 透传给当前样式组件根节点的类名。 */
  class?: ClassValue;
}

const props = withDefaults(defineProps<Props>(), {});

const emit = defineEmits<{ select: [string] }>();

const forward = useForwardPropsEmits(props, emit);
</script>
<template>
  <Breadcrumb
    v-if="styleType === 'normal'"
    v-bind="forward"
    class="vben-breadcrumb"
  />
  <BreadcrumbBackground
    v-if="styleType === 'background'"
    v-bind="forward"
    class="vben-breadcrumb"
  />
</template>
<style lang="scss" scoped>
/** 修复全局引入Antd时，ol和ul的默认样式会被修改的问题 */
.vben-breadcrumb {
  :deep(ol),
  :deep(ul) {
    margin-bottom: 0;
  }
}
</style>
