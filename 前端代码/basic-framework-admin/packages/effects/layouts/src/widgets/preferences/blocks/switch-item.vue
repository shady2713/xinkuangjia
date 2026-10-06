<script setup lang="ts">
/**
 * 偏好抽屉的开关行原语：整行可点击切换，行尾开关用 click.stop 避免重复触发。
 * 标题后可挂提示气泡，行尾可挂快捷键说明；被切换偏好的含义与本组件无关。
 */
import { useSlots } from 'vue';

import { CircleHelp } from '@vben/icons';

import { Switch, VbenTooltip } from '@vben-core/shadcn-ui';

defineOptions({
  name: 'PreferenceSwitchItem',
});

withDefaults(defineProps<{ disabled?: boolean; tip?: string }>(), {
  disabled: false,
  tip: '',
});

const checked = defineModel<boolean>();

const slots = useSlots();

/** 点击整行时翻转开关值；行尾开关自身已阻止冒泡，不会重复触发。 */
function handleClick() {
  checked.value = !checked.value;
}
</script>

<template>
  <div
    :class="{
      'pointer-events-none opacity-50': disabled,
    }"
    class="hover:bg-accent my-1 flex w-full items-center justify-between rounded-md px-2 py-2.5"
    @click="handleClick"
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
    <span v-if="$slots.shortcut" class="ml-auto mr-2 text-xs opacity-60">
      <slot name="shortcut"></slot>
    </span>
    <Switch v-model="checked" @click.stop />
  </div>
</template>
