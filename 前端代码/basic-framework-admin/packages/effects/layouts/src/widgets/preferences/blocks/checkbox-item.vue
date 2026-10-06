<script setup lang="ts">
/**
 * 偏好设置按钮组行：左侧标签与悬浮提示，右侧一排可点选的按钮。
 * 供偏好抽屉中在少量枚举值之间单选或多选（multiple）的配置项复用；
 * 选中结果通过 v-model 回传数组，组件自身不校验取值也不写入 preferences。
 */
import type { SelectOption } from '@vben/types';

import { useSlots } from 'vue';

import { CircleHelp } from '@vben/icons';

import { VbenCheckButtonGroup, VbenTooltip } from '@vben-core/shadcn-ui';

defineOptions({
  name: 'PreferenceCheckboxItem',
});

withDefaults(
  defineProps<{
    disabled?: boolean;
    items?: SelectOption[];
    multiple?: boolean;
    /** 点击按钮时的回调；不传时点击只更新 v-model，不做额外处理。 */
    onBtnClick?: (value: string) => void;
    placeholder?: string;
  }>(),
  {
    disabled: false,
    placeholder: '',
    /** 可选项的默认值：空数组，未传入时不渲染任何按钮。 */
    items: () => [],
    /** 点击回调的默认值：空实现，保证按钮点击始终可安全调用。 */
    onBtnClick: () => {},
    multiple: false,
  },
);

const inputValue = defineModel<string[]>();

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
    <VbenCheckButtonGroup
      v-model="inputValue"
      class="min-h-8 w-[165px]"
      :options="items"
      :disabled="disabled"
      :multiple="multiple"
      @btn-click="onBtnClick"
    />
  </div>
</template>
