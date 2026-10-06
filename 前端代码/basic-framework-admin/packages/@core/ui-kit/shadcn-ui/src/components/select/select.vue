<script lang="ts" setup>
/** 通用选择器：把选项数组渲染成下拉选择，并提供可清空的占位与清除行为。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { CircleX } from '@vben-core/icons';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui';

/**
 * 选择器的入参。
 * options 是唯一的数据来源，label 只用于显示、value 作为选中值，两者在模板里一一对应；
 * allowClear 为真且已有选中值时才渲染清除按钮；placeholder 在无选中值时占位；
 * class 作用于触发按钮本身，便于按场景调整宽度。
 */
interface Props {
  allowClear?: boolean;
  class?: ClassValue;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
  allowClear: false,
});

const modelValue = defineModel<string>();

/**
 * 清除当前选中值，把 v-model 置为 undefined 让触发按钮回到 placeholder 占位。
 * 不额外派发事件，调用方通过 v-model 的变更感知清空。
 */
function handleClear() {
  modelValue.value = undefined;
}
</script>
<template>
  <Select v-model="modelValue">
    <SelectTrigger :class="props.class" class="flex w-full items-center">
      <SelectValue class="flex-auto text-left" :placeholder="placeholder" />
      <CircleX
        @pointerdown.stop
        @click.stop.prevent="handleClear"
        v-if="allowClear && modelValue"
        data-clear-button
        class="mr-1 size-4 cursor-pointer opacity-50 hover:opacity-100"
      />
    </SelectTrigger>
    <SelectContent>
      <template v-for="item in options" :key="item.value">
        <SelectItem :value="item.value"> {{ item.label }} </SelectItem>
      </template>
    </SelectContent>
  </Select>
</template>

<style lang="scss" scoped>
button[role='combobox'][data-placeholder] {
  color: hsl(var(--muted-foreground));
}

button {
  --ring: var(--primary);
}
</style>
