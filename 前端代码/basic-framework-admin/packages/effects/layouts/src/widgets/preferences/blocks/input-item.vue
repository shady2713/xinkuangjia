<script setup lang="ts">
/**
 * 偏好设置输入行：左侧标签与提示气泡，右侧窄输入框带一键清空图标。
 * 供偏好抽屉中文本类配置复用，如水印文案与版权公司名、备案号等；
 * 只回传输入值，不做格式校验、也不负责保存。
 */
import type { SelectOption } from '@vben/types';

import { useSlots } from 'vue';

import { CircleHelp, CircleX } from '@vben/icons';

import { Input, VbenTooltip } from '@vben-core/shadcn-ui';

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
    /** 选项属性的默认值：空数组；本输入行不读取该属性，仅与选择行保持一致的签名。 */
    items: () => [],
  },
);

const inputValue = defineModel<string>();

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
    <div class="relative">
      <Input
        v-model="inputValue"
        class="h-8 w-[165px]"
        :placeholder="placeholder"
      />
      <CircleX
        v-if="inputValue"
        class="hover:text-foreground text-foreground/60 absolute right-2 top-1/2 size-3 -translate-y-1/2 transform cursor-pointer"
        @click="() => (inputValue = '')"
      />
    </div>
  </div>
</template>
