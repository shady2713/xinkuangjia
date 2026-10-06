<script setup lang="ts">
/**
 * 工作台快捷导航卡片：按 items 排列图标入口，点击项经 click 事件上抛。
 * 只负责入口的展示与索引，目标地址由父级按 url 处理。
 */
import type { WorkbenchQuickNavItem } from '../typing';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VbenIcon,
} from '@vben-core/shadcn-ui';

/** 快捷导航属性：卡片标题与导航条目清单。 */
interface Props {
  items?: WorkbenchQuickNavItem[];
  title: string;
}

defineOptions({
  name: 'WorkbenchQuickNav',
});

withDefaults(defineProps<Props>(), {
  /** 导航清单默认值：空数组，未传入时没有快捷入口。 */
  items: () => [],
});

defineEmits(['click']);
</script>

<template>
  <Card>
    <CardHeader class="py-4">
      <CardTitle class="text-lg">{{ title }}</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-wrap p-0">
      <template v-for="(item, index) in items" :key="item.title">
        <div
          :class="{
            'border-r-0': index % 3 === 2,
            'border-b-0': index < 3,
            'pb-4': index > 2,
            'rounded-bl-xl': index === items.length - 3,
            'rounded-br-xl': index === items.length - 1,
          }"
          class="flex-col-center border-border group w-1/3 cursor-pointer border-r border-t py-8 hover:shadow-xl"
          @click="$emit('click', item)"
        >
          <VbenIcon
            :color="item.color"
            :icon="item.icon"
            class="size-7 transition-all duration-300 group-hover:scale-125"
          />
          <span class="text-md mt-2 truncate">{{ item.title }}</span>
        </div>
      </template>
    </CardContent>
  </Card>
</template>
