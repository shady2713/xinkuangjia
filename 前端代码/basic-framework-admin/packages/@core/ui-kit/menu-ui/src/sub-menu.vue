<script setup lang="ts">
/**
 * 菜单树节点：按单条菜单数据递归渲染，无子节点时输出叶子菜单项，
 * 有子节点时输出可展开的子菜单并把徽标放进内容插槽。
 * 展开、悬浮等交互沿用底层菜单组件，本层只负责数据到组件的映射。
 */
import type { MenuRecordRaw } from '@vben-core/typings';

import { computed } from 'vue';

import { MenuBadge, MenuItem, SubMenu as SubMenuComp } from './components';
// eslint-disable-next-line import/no-self-import
import SubMenu from './sub-menu.vue';

/**
 * 菜单树递归节点属性：只接收单条菜单数据，由本层判断它是叶子项还是可展开的子菜单。
 */
interface Props {
  /**
   * 菜单项
   */
  menu: MenuRecordRaw;
}

defineOptions({
  name: 'SubMenuUi',
});

/** 注册单条菜单数据，本层没有需要兜底的默认字段。 */
const props = withDefaults(defineProps<Props>(), {});

/**
 * 判断是否有子节点，动态渲染 menu-item/sub-menu-item
 */
const hasChildren = computed(() => {
  const { menu } = props;
  return (
    Reflect.has(menu, 'children') && !!menu.children && menu.children.length > 0
  );
});
</script>

<template>
  <MenuItem
    v-if="!hasChildren"
    :key="menu.path"
    :active-icon="menu.activeIcon"
    :badge="menu.badge"
    :badge-type="menu.badgeType"
    :badge-variants="menu.badgeVariants"
    :icon="menu.icon"
    :path="menu.path"
  >
    <template #title>
      <span>{{ menu.name }}</span>
    </template>
  </MenuItem>
  <SubMenuComp
    v-else
    :key="`${menu.path}_sub`"
    :active-icon="menu.activeIcon"
    :icon="menu.icon"
    :path="menu.path"
  >
    <template #content>
      <MenuBadge
        :badge="menu.badge"
        :badge-type="menu.badgeType"
        :badge-variants="menu.badgeVariants"
        class="right-6"
      />
    </template>
    <template #title>
      <span>{{ menu.name }}</span>
    </template>
    <template v-for="childItem in menu.children || []" :key="childItem.path">
      <SubMenu :menu="childItem" />
    </template>
  </SubMenuComp>
</template>
