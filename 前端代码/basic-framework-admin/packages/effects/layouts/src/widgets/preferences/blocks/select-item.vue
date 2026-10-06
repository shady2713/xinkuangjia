<script setup lang="ts">
/**
 * 偏好抽屉的下拉行原语：左侧标题加右侧下拉框，可选配提示气泡。
 * 选项以 SelectOption 数组由调用方传入并自行完成文案翻译；
 * 本组件只透传选中值，不校验取值是否在选项之内。
 */
import type { SelectOption } from '@vben/types';

import { useSlots } from 'vue';

import { CircleHelp } from '@vben/icons';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VbenTooltip,
} from '@vben-core/shadcn-ui';

defineOptions({
  name: 'PreferenceSelectItem',
});

withDefaults(
  defineProps<{
    disabled?: boolean;
    items?: SelectOption[];
    placeholder?: string;
  }>(),
  {
    disabled: false,
    placeholder: '',
    /** 可选项的默认值：空数组，未传入时下拉列表中没有可选项。 */
    items: () => [],
  },
);

const selectValue = defineModel<string>();

const slots = useSlots();
</script>

<template>
  <div
    :class="{
      'hover:bg-accent': !slots.tip,
      'pointer-events-none opacity-50': disabled,
    }"
    class="my-1 flex w-full items-center justify-between rounded-md px-2 py-1"
  >
    <span class="flex items-center text-sm">
      <slot></slot>

      <VbenTooltip v-if="slots.tip" side="bottom">
        <template #trigger>
          <CircleHelp class="ml-1 size-3 cursor-help" />
        </template>
        <slot name="tip"></slot>
      </VbenTooltip>
    </span>
    <Select v-model="selectValue">
      <SelectTrigger class="h-8 w-[165px]">
        <SelectValue :placeholder="placeholder" />
      </SelectTrigger>
      <SelectContent>
        <template v-for="item in items" :key="item.value">
          <SelectItem :value="item.value"> {{ item.label }} </SelectItem>
        </template>
      </SelectContent>
    </Select>
  </div>
</template>
