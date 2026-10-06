<script setup lang="ts">
/**
 * 数据驱动的菜单视图：按菜单树数据逐项渲染子菜单节点，其余属性透传给菜单容器。
 * 供布局侧边栏等调用方直接传入路由菜单数据，自身不持有展开与激活状态。
 */
import type { MenuRecordRaw } from '@vben-core/typings';

import type { MenuProps } from './types';

import { useForwardProps } from '@vben-core/composables';

import { Menu } from './components';
import SubMenu from './sub-menu.vue';

/**
 * 数据驱动菜单属性：在菜单容器字段之上补充待渲染的菜单树数据，其余行为开关由容器自行决定。
 */
interface Props extends MenuProps {
  menus: MenuRecordRaw[];
}

defineOptions({
  name: 'MenuView',
});

/** 注册菜单树数据，折叠开关缺省为 false，其余容器字段沿用菜单容器契约。 */
const props = withDefaults(defineProps<Props>(), {
  collapse: false,
});

const forward = useForwardProps(props);
</script>

<template>
  <Menu v-bind="forward">
    <template v-for="menu in menus" :key="menu.path">
      <SubMenu :menu="menu" />
    </template>
  </Menu>
</template>
