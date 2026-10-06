<script setup lang="ts">
/**
 * 偏好抽屉的数字行原语：左侧标题加右侧步进器，标题后可挂提示气泡。
 *
 * 与 select-item、switch-item 同级，供 sidebar、tabbar、font-size 等分组复用；
 * 取值范围与步长不在此声明，由调用方经透传属性交给底层 NumberField。
 */
import type { SelectOption } from '@vben/types';

import { useSlots } from 'vue';

import { CircleHelp } from '@vben/icons';

import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
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
    tip?: string;
  }>(),
  {
    disabled: false,
    placeholder: '',
    tip: '',
    /** 选项属性的默认值：空数组；本数字行不读取该属性，仅与其它偏好行保持一致的签名。 */
    items: () => [],
  },
);

const inputValue = defineModel<number>();

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

      <VbenTooltip v-if="slots.tip || tip" side="bottom">
        <template #trigger>
          <CircleHelp class="ml-1 size-3 cursor-help" />
        </template>
        <slot name="tip">
          <template v-if="tip">
            <p v-for="(line, index) in tip.split('\n')" :key="index">
              {{ line }}
            </p>
          </template>
        </slot>
      </VbenTooltip>
    </span>

    <NumberField v-model="inputValue" v-bind="$attrs" class="w-[165px]">
      <NumberFieldContent>
        <NumberFieldDecrement />
        <NumberFieldInput />
        <NumberFieldIncrement />
      </NumberFieldContent>
    </NumberField>
  </div>
</template>
