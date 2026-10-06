<script lang="ts" setup>
/**
 * 布局菜单容器：把菜单数据、模式和折叠等偏好透传给菜单内核渲染。
 * 只把内核抛出的选中、展开事件转成 select/open 交给父级，
 * 菜单取数、鉴权与路由跳转由布局和 use-navigation 承担。
 */
import type { MenuRecordRaw } from '@vben/types';

import type { MenuProps } from '@vben-core/menu-ui';

import { Menu } from '@vben-core/menu-ui';

/** 菜单容器属性：在菜单内核属性上补充菜单树。 */
interface Props extends MenuProps {
  menus?: MenuRecordRaw[];
}

const props = withDefaults(defineProps<Props>(), {
  accordion: true,
  /** 菜单树的默认值：空数组，未传入时不渲染菜单项。 */
  menus: () => [],
});

const emit = defineEmits<{
  open: [string, string[]];
  select: [string, string?];
}>();

/** 菜单选中回调：把选中键与当前菜单模式一并抛给父级。 */
function handleMenuSelect(key: string) {
  emit('select', key, props.mode);
}

/** 菜单展开回调：把展开的键与完整路径链抛给父级。 */
function handleMenuOpen(key: string, path: string[]) {
  emit('open', key, path);
}
</script>

<template>
  <Menu
    :accordion="accordion"
    :collapse="collapse"
    :collapse-show-title="collapseShowTitle"
    :default-active="defaultActive"
    :menus="menus"
    :mode="mode"
    :rounded="rounded"
    scroll-to-active
    :theme="theme"
    @open="handleMenuOpen"
    @select="handleMenuSelect"
  />
</template>
