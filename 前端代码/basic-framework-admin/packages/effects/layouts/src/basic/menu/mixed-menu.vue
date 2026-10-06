<script lang="ts" setup>
/**
 * 混合布局的次级菜单列：渲染当前顶级菜单下的子菜单，挂在头部导航之下。
 * 挂载时按当前路由反查菜单并抛 defaultSelect，由父级定位激活项；
 * 菜单数据与激活路径全部来自父级，本组件自身不做跳转。
 */
import type { MenuRecordRaw } from '@vben/types';

import type { NormalMenuProps } from '@vben-core/menu-ui';

import { onBeforeMount } from 'vue';
import { useRoute } from 'vue-router';

import { findMenuByPath } from '@vben/utils';

import { NormalMenu } from '@vben-core/menu-ui';

/** 混合菜单的属性契约别名：直接复用菜单属性，不额外声明成员。 */
type Props = NormalMenuProps;

const props = defineProps<Props>();

const emit = defineEmits<{
  defaultSelect: [MenuRecordRaw, MenuRecordRaw?];
  enter: [MenuRecordRaw];
  select: [MenuRecordRaw];
}>();

const route = useRoute();

onBeforeMount(() => {
  const menu = findMenuByPath(props.menus || [], route.path);
  if (menu) {
    const rootMenu = (props.menus || []).find(
      (item) => item.path === menu.parents?.[0],
    );
    emit('defaultSelect', menu, rootMenu);
  }
});
</script>

<template>
  <NormalMenu
    :active-path="activePath"
    :collapse="collapse"
    :menus="menus"
    :rounded="rounded"
    :theme="theme"
    @enter="(menu) => emit('enter', menu)"
    @select="(menu) => emit('select', menu)"
  />
</template>
