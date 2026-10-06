<script setup lang="ts">
/**
 * 偏好抽屉的分段选择行原语：左侧标题加右侧单选按钮组。
 * 与 select-item 的分工是选项少且需平铺展示，选项文案由调用方翻译后传入。
 */
import type { SelectOption } from '@vben/types';

import { ToggleGroup, ToggleGroupItem } from '@vben-core/shadcn-ui';

defineOptions({
  name: 'PreferenceToggleItem',
});

withDefaults(defineProps<{ disabled?: boolean; items?: SelectOption[] }>(), {
  disabled: false,
  items: () => [],
});

const modelValue = defineModel<string>();
</script>

<template>
  <div
    :class="{
      'pointer-events-none opacity-50': disabled,
    }"
    class="hover:bg-accent flex w-full items-center justify-between rounded-md px-2 py-2"
    disabled
  >
    <span class="text-sm">
      <slot></slot>
    </span>
    <ToggleGroup
      v-model="modelValue"
      class="gap-2"
      size="sm"
      type="single"
      variant="outline"
    >
      <template v-for="item in items" :key="item.value">
        <ToggleGroupItem
          :value="item.value"
          class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-7 rounded-sm"
        >
          {{ item.label }}
        </ToggleGroupItem>
      </template>
    </ToggleGroup>
  </div>
</template>
