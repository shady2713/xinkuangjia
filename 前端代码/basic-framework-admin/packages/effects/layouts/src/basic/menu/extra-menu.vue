<script lang="ts" setup>
/**
 * 侧边次级菜单：双列布局的展开列，以 vertical 模式渲染并按路由 activePath 高亮当前项。
 * 菜单树与折叠态由 BasicLayout 传入，选中后交给 useNavigation 跳转，不自行改写菜单。
 */
import type { MenuRecordRaw } from '@vben/types';

import type { MenuProps } from '@vben-core/menu-ui';

import { useRoute } from 'vue-router';

import { Menu } from '@vben-core/menu-ui';

import { useNavigation } from './use-navigation';

/** 次级菜单属性：在菜单组件属性上补充折叠态与菜单树。 */
interface Props extends MenuProps {
  collapse?: boolean;
  menus?: MenuRecordRaw[];
}

withDefaults(defineProps<Props>(), {
  accordion: true,
  /** 菜单树的默认值：空数组，未传入时不渲染任何菜单项。 */
  menus: () => [],
});

const route = useRoute();
const { navigation } = useNavigation();

/** 菜单选中回调：把选中的菜单键交给导航方法完成跳转。 */
async function handleSelect(key: string) {
  await navigation(key);
}
</script>

<template>
  <Menu
    :accordion="accordion"
    :collapse="collapse"
    :default-active="route.meta?.activePath || route.path"
    :menus="menus"
    :rounded="rounded"
    :theme="theme"
    mode="vertical"
    @select="handleSelect"
  />
</template>
