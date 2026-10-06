<script setup lang="ts">
/**
 * 分析页图表切换容器：按 tabs 渲染标签头，每个标签内容由同名插槽提供。
 * 默认选中第一个标签，只做标签切换与面板占位，不关心面板内的图表实现。
 */
import type { TabOption } from '@vben/types';

import { computed } from 'vue';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vben-core/shadcn-ui';

interface Props {
  tabs?: TabOption[];
}

defineOptions({
  name: 'AnalysisChartsTabs',
});

const props = withDefaults(defineProps<Props>(), {
  tabs: () => [],
});

const defaultValue = computed(() => {
  return props.tabs?.[0]?.value;
});
</script>

<template>
  <div class="card-box w-full px-4 pb-5 pt-3">
    <Tabs :default-value="defaultValue">
      <TabsList>
        <template v-for="tab in tabs" :key="tab.label">
          <TabsTrigger :value="tab.value"> {{ tab.label }} </TabsTrigger>
        </template>
      </TabsList>
      <template v-for="tab in tabs" :key="tab.label">
        <TabsContent :value="tab.value" class="pt-4">
          <slot :name="tab.value"></slot>
        </TabsContent>
      </template>
    </Tabs>
  </div>
</template>
