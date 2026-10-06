<script setup lang="ts">
/**
 * 工作台待办卡片：列出 items 的标题、摘要与日期，已完成项显示勾选并置灰。
 * 勾选状态双向写回传入数组元素，落库请求由使用方监听后自行提交。
 */
import type { WorkbenchTodoItem } from '../typing';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VbenCheckbox,
} from '@vben-core/shadcn-ui';

/** 待办卡片属性：卡片标题与待办条目清单。 */
interface Props {
  items?: WorkbenchTodoItem[];
  title: string;
}

defineOptions({
  name: 'WorkbenchTodo',
});

withDefaults(defineProps<Props>(), {
  /** 待办清单默认值：空数组，未传入时卡片内没有待办项。 */
  items: () => [],
});
</script>

<template>
  <Card>
    <CardHeader class="py-4">
      <CardTitle class="text-lg">{{ title }}</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-wrap p-5 pt-0">
      <ul class="divide-border w-full divide-y" role="list">
        <li
          v-for="item in items"
          :key="item.title"
          :class="{
            'select-none line-through opacity-60': item.completed,
          }"
          class="flex cursor-pointer justify-between gap-x-6 py-5"
        >
          <div class="flex min-w-0 items-center gap-x-4">
            <VbenCheckbox v-model="item.completed" name="completed" />
            <div class="min-w-0 flex-auto">
              <p class="text-foreground text-sm font-semibold leading-6">
                {{ item.title }}
              </p>
              <p class="text-foreground/80 mt-1 truncate text-xs leading-5">
                {{ item.content }}
              </p>
            </div>
          </div>
          <div class="hidden h-full shrink-0 sm:flex sm:flex-col sm:items-end">
            <span class="text-foreground/80 mt-6 text-xs leading-6">
              {{ item.date }}
            </span>
          </div>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
