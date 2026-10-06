<script lang="ts" setup>
/**
 * 子菜单标题行：渲染图标、标题插槽与展开箭头，并按状态决定箭头的朝向。
 * 折叠与水平模式下依据层级隐藏标题或旋转箭头，占位宽度由调用方样式约束。
 * 不处理点击与展开状态，事件绑定和展开项集合由 sub-menu 与根菜单负责。
 */
import type { MenuItemProps } from '../types';

import { computed } from 'vue';

import { useNamespace } from '@vben-core/composables';
import { ChevronDown, ChevronRight } from '@vben-core/icons';
import { VbenIcon } from '@vben-core/shadcn-ui';

import { useMenuContext } from '../hooks';

/**
 * 子菜单标题行属性：在菜单项字段之上补充溢出「更多」标记、是否为一级子菜单与所在层级。
 * level 决定标题与箭头在折叠态下的显隐规则。
 */
interface Props extends MenuItemProps {
  isMenuMore?: boolean;
  isTopLevelMenuSubmenu: boolean;
  level?: number;
}

defineOptions({ name: 'SubMenuContent' });

/** 注册子菜单标题行属性，isMenuMore 与 level 缺省分别为 false 与 0。 */
const props = withDefaults(defineProps<Props>(), {
  isMenuMore: false,
  level: 0,
});

const rootMenu = useMenuContext();
const { b, e, is } = useNamespace('sub-menu-content');
const nsMenu = useNamespace('menu');

/** 本子菜单是否处于展开状态，取决于它的 path 是否落在根菜单的展开集合里。 */
const opened = computed(() => {
  return rootMenu?.openedMenus.includes(props.path);
});

/** 根菜单是否处于折叠态，是隐藏标题与旋转箭头判断的前提。 */
const collapse = computed(() => {
  return rootMenu.props.collapse;
});

/** 层级为 1 即根菜单下的直接子菜单，只有这层在折叠时需要做标题与箭头的取舍。 */
const isFirstLevel = computed(() => {
  return props.level === 1;
});

/** 折叠态下且菜单开启 collapseShowTitle 时为 true，一级子菜单在折叠时以小字显示名称。 */
const getCollapseShowTitle = computed(() => {
  return (
    rootMenu.props.collapseShowTitle && isFirstLevel.value && collapse.value
  );
});

/** 跟随根菜单的排列模式，缺省由菜单容器提供，未取到上下文时为 undefined。 */
const mode = computed(() => {
  return rootMenu?.props.mode;
});

/** 水平模式或非「一级折叠」情形下才显示展开箭头，其余情况隐藏箭头只留图标。 */
const showArrowIcon = computed(() => {
  return mode.value === 'horizontal' || !(isFirstLevel.value && collapse.value);
});

/** 垂直且折叠态的一级子菜单在未开启 collapseShowTitle 时隐藏标题，只保留图标。 */
const hiddenTitle = computed(() => {
  return (
    mode.value === 'vertical' &&
    isFirstLevel.value &&
    collapse.value &&
    !getCollapseShowTitle.value
  );
});

/** 水平模式的深层子菜单与垂直折叠态用朝右箭头表示「可继续展开」，其余用朝下箭头。 */
const iconComp = computed(() => {
  return (mode.value === 'horizontal' && !isFirstLevel.value) ||
    (mode.value === 'vertical' && collapse.value)
    ? ChevronRight
    : ChevronDown;
});

/** 已展开时把箭头旋转 180 度，未展开时不设 transform，交给样式表的默认朝向。 */
const iconArrowStyle = computed(() => {
  return opened.value ? { transform: `rotate(180deg)` } : {};
});
</script>
<template>
  <div
    :class="[
      b(),
      is('collapse-show-title', getCollapseShowTitle),
      is('more', isMenuMore),
    ]"
  >
    <slot></slot>

    <VbenIcon
      v-if="!isMenuMore"
      :class="nsMenu.e('icon')"
      :icon="icon"
      fallback
    />

    <div v-if="!hiddenTitle" :class="[e('title')]">
      <slot name="title"></slot>
    </div>

    <component
      :is="iconComp"
      v-if="!isMenuMore"
      v-show="showArrowIcon"
      :class="[e('icon-arrow')]"
      :style="iconArrowStyle"
      class="size-4"
    />
  </div>
</template>
