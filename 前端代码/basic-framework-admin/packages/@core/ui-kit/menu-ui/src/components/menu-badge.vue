<script setup lang="ts">
/**
 * 菜单徽标：按 badgeType 渲染圆点或文字角标，并把变体映射成具体颜色。
 *
 * 颜色来自 variantsMap 或调用方色值，徽标内容由菜单项数据提供。
 */
import type { MenuRecordBadgeRaw } from '@vben-core/typings';

import { computed } from 'vue';

import { isValidColor } from '@vben-core/shared/color';

import BadgeDot from './menu-badge-dot.vue';

/**
 * 菜单徽标属性：在菜单项公共徽标字段之上补充「是否为更多入口」标记，用于区分水平菜单溢出项。
 */
interface Props extends MenuRecordBadgeRaw {
  hasChildren?: boolean;
}

/** 注册菜单徽标属性，全部徽标字段沿用菜单项契约，此处不额外设置默认值。 */
const props = withDefaults(defineProps<Props>(), {});

const variantsMap: Record<string, string> = {
  default: 'bg-green-500',
  destructive: 'bg-destructive',
  primary: 'bg-primary',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
};

/** 徽标类型为 dot 时改渲染扩散圆点，否则渲染带文字的圆角角标。 */
const isDot = computed(() => props.badgeType === 'dot');

/** 把变体名映射成预置底色类名；变体为空时用默认色，变体不在映射表内时按原样当作自定义类名或色值。 */
const badgeClass = computed(() => {
  const { badgeVariants } = props;

  if (!badgeVariants) {
    return variantsMap.default;
  }

  return variantsMap[badgeVariants] || badgeVariants;
});

/** 类名不是合法颜色值时返回空对象，让底色继续由 badgeClass 的类名生效。 */
const badgeStyle = computed(() => {
  if (badgeClass.value && isValidColor(badgeClass.value)) {
    return {
      backgroundColor: badgeClass.value,
    };
  }
  return {};
});
</script>
<template>
  <span v-if="isDot || badge" :class="$attrs.class" class="absolute">
    <BadgeDot v-if="isDot" :dot-class="badgeClass" :dot-style="badgeStyle" />
    <div
      v-else
      :class="badgeClass"
      :style="badgeStyle"
      class="flex-center rounded-xl px-1.5 py-0.5 text-[10px] text-primary-foreground"
    >
      {{ badge }}
    </div>
  </span>
</template>
