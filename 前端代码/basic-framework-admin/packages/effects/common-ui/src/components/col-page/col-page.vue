<script lang="ts" setup>
/**
 * 左右分栏页面：外层套用 Page 承载页头，内部用可拖拽面板切出左窄右宽两栏。
 * 左栏插槽额外获得 expand/collapse，leftWidth 被拦截后不再向下透传，
 * 其余 Page 属性与其他插槽原样转发，页头与操作区仍由 Page 渲染。
 */
import type { ColPageProps } from './types';

import { computed, ref, useSlots } from 'vue';

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@vben-core/shadcn-ui';

import Page from '../page/page.vue';

defineOptions({
  name: 'ColPage',
  inheritAttrs: false,
});

const props = withDefaults(defineProps<ColPageProps>(), {
  leftWidth: 30,
  rightWidth: 70,
  resizable: true,
});

/** 透传给 Page 的属性：剔除仅用于左侧面板的 leftWidth，其余原样下发。 */
const delegatedProps = computed(() => {
  const { leftWidth: _, ...delegated } = props;
  return delegated;
});

const slots = useSlots();

/** 需要继续透传给 Page 的插槽名：排除由本组件接管的默认插槽与 left 插槽。 */
const delegatedSlots = computed(() => {
  const resultSlots: string[] = [];

  for (const key of Object.keys(slots)) {
    if (!['default', 'left'].includes(key)) {
      resultSlots.push(key);
    }
  }
  return resultSlots;
});

const leftPanelRef = ref<InstanceType<typeof ResizablePanel>>();

/** 展开左侧面板；面板尚未就绪时静默跳过。 */
function expandLeft() {
  leftPanelRef.value?.expand();
}

/** 收起左侧面板；面板尚未就绪时静默跳过。 */
function collapseLeft() {
  leftPanelRef.value?.collapse();
}

defineExpose({
  expandLeft,
  collapseLeft,
});
</script>
<template>
  <Page v-bind="delegatedProps">
    <!-- 继承默认的slot -->
    <template
      v-for="slotName in delegatedSlots"
      :key="slotName"
      #[slotName]="slotProps"
    >
      <slot :name="slotName" v-bind="slotProps"></slot>
    </template>

    <ResizablePanelGroup class="w-full" direction="horizontal">
      <ResizablePanel
        ref="leftPanelRef"
        :collapsed-size="leftCollapsedWidth"
        :collapsible="leftCollapsible"
        :default-size="leftWidth"
        :max-size="leftMaxWidth"
        :min-size="leftMinWidth"
      >
        <template #default="slotProps">
          <slot
            name="left"
            v-bind="{
              ...slotProps,
              expand: expandLeft,
              collapse: collapseLeft,
            }"
          ></slot>
        </template>
      </ResizablePanel>
      <ResizableHandle
        v-if="resizable"
        :style="{ backgroundColor: splitLine ? undefined : 'transparent' }"
        :with-handle="splitHandle"
      />
      <ResizablePanel
        :collapsed-size="rightCollapsedWidth"
        :collapsible="rightCollapsible"
        :default-size="rightWidth"
        :max-size="rightMaxWidth"
        :min-size="rightMinWidth"
      >
        <template #default>
          <slot></slot>
        </template>
      </ResizablePanel>
    </ResizablePanelGroup>
  </Page>
</template>
