<script setup lang="ts">
/**
 * 分段控件：按 tabs 生成等宽选项，选中项加粗并显示滑动指示器。
 * 用 v-model 双向绑定当前值，defaultValue 缺省时取首项。
 * 内容区由与选项同名的具名插槽承载，指示器滑动动画单独封装。
 */
import type { SegmentedItem } from './types';

import { computed } from 'vue';

import { TabsTrigger } from 'reka-ui';

import { Tabs, TabsContent, TabsList } from '../../ui';
import TabsIndicator from './tabs-indicator.vue';

/**
 * 分段控件的入参。
 * tabs 给出全部选项，其 value 既是 Tabs 的取值，也决定内容区使用哪个同名具名插槽；
 * defaultValue 只在首次渲染、v-model 为空时兜底，未传时取首项的 value。
 */
interface Props {
  defaultValue?: string;
  tabs?: SegmentedItem[];
}

const props = withDefaults(defineProps<Props>(), {
  defaultValue: '',
  /** 未传 tabs 时用空数组兜底，使下面的列数计算与循环都不必再判空 */
  tabs: () => [],
});

const activeTab = defineModel<string>();

/**
 * 未通过 v-model 指定初始选中项时使用的兜底值。
 * 优先用 defaultValue，没配或配了空串则退到首个选项的 value；两者都没有时结果为 undefined。
 */
const getDefaultValue = computed(() => {
  return props.defaultValue || props.tabs[0]?.value;
});

/**
 * 用等分栅格把选项列表撑满整行，使各段宽度一致，不受 label 文字长短影响。
 * 列数由 tabs.length 决定，tabs 为空时列数为 0，样式随之失效。
 */
const tabsStyle = computed(() => {
  return {
    'grid-template-columns': `repeat(${props.tabs.length}, minmax(0, 1fr))`,
  };
});

/**
 * 指示器的宽度百分比，与栅格列宽保持一致，指示器才能正好覆盖一整段。
 * 用 toFixed(0) 取整百分数，段数无法整除 100 时允许存在极小的取整误差。
 */
const tabsIndicatorStyle = computed(() => {
  return {
    width: `${(100 / props.tabs.length).toFixed(0)}%`,
  };
});

/**
 * 判断某一项是否选中，并给出选中态才加的类名。
 * 未选中返回空数组，因此模板里可以无条件绑定 class，无需写 v-if。
 * @param tab 待判断选项的取值。
 * @returns 选中时为加粗与主色两个类名，否则为空数组。
 */
function activeClass(tab: string): string[] {
  return tab === activeTab.value ? ['!font-bold', 'text-primary'] : [];
}
</script>

<template>
  <Tabs v-model="activeTab" :default-value="getDefaultValue">
    <TabsList
      :style="tabsStyle"
      class="relative grid w-full bg-accent !outline !outline-2 !outline-heavy"
    >
      <TabsIndicator :style="tabsIndicatorStyle" />
      <template v-for="tab in tabs" :key="tab.value">
        <TabsTrigger
          :value="tab.value"
          :class="activeClass(tab.value)"
          class="z-20 inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium hover:text-primary disabled:pointer-events-none disabled:opacity-50"
        >
          {{ tab.label }}
        </TabsTrigger>
      </template>
    </TabsList>
    <template v-for="tab in tabs" :key="tab.value">
      <TabsContent :value="tab.value">
        <slot :name="tab.value"></slot>
      </TabsContent>
    </template>
  </Tabs>
</template>
