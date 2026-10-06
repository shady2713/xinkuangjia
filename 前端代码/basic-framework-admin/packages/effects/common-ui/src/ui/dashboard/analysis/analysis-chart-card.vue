<script setup lang="ts">
/**
 * 分析页图表卡片的标题外壳：标题由 title 传入，图表本体经默认插槽填充。
 * 只负责卡片边框与标题排版，图表数据与绘制由使用方自行提供。
 */
import { Card, CardContent, CardHeader, CardTitle } from '@vben-core/shadcn-ui';

/** 图表卡片属性：卡片标题。 */
interface Props {
  title: string;
}

defineOptions({
  name: 'AnalysisChartCard',
});

withDefaults(defineProps<Props>(), {});
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-xl">{{ title }}</CardTitle>
    </CardHeader>
    <CardContent>
      <slot></slot>
    </CardContent>
  </Card>
</template>
