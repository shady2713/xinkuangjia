<script lang="ts" setup>
/**
 * 菜单叶子项：渲染图标与标题，折叠态下改用悬浮卡承载标题。
 * 挂载时把自身登记到所属菜单与子菜单，点击后交由根菜单派发选中事件。
 * 展开与手风琴状态由 sub-menu、menu 持有，本组件只读取上下文。
 */
import type { MenuItemProps, MenuItemRegistered } from '../types';

import { computed, onBeforeUnmount, onMounted, reactive, useSlots } from 'vue';

import { useNamespace } from '@vben-core/composables';
import { VbenIcon, VbenTooltip } from '@vben-core/shadcn-ui';

import { MenuBadge } from '../components';
import { useMenu, useMenuContext, useSubMenuContext } from '../hooks';

/** 菜单项的属性契约别名：直接复用菜单项属性，不额外声明成员。 */
type Props = MenuItemProps;

defineOptions({ name: 'MenuItem' });

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});

const emit = defineEmits<{ click: [MenuItemRegistered] }>();

const slots = useSlots();
const { b, e, is } = useNamespace('menu-item');
const nsMenu = useNamespace('menu');
const rootMenu = useMenuContext();
const subMenu = useSubMenuContext();
const { parentMenu, parentPaths } = useMenu();

/** 菜单项的 path 与根菜单当前激活路径一致时为 true，用于高亮当前所在菜单。 */
const active = computed(() => props.path === rootMenu?.activePath);
/** 激活时优先用激活图标，未激活时用普通图标；两者都未传时为 undefined，图标组件走 fallback。 */
const menuIcon = computed(() =>
  active.value ? props.activeIcon || props.icon : props.icon,
);

/** 直属父级是根 Menu（而非 SubMenu）时为 true，用于区分一级项与嵌套项的展示差异。 */
const isTopLevelMenuItem = computed(
  () => parentMenu.value?.type.name === 'Menu',
);

/** 折叠态下且菜单开启 collapseShowTitle 时为 true，一级项在折叠时仍以小字显示名称。 */
const collapseShowTitle = computed(
  () =>
    rootMenu.props?.collapseShowTitle &&
    isTopLevelMenuItem.value &&
    rootMenu.props.collapse,
);

/**
 * 垂直且折叠态下的一级菜单项改用悬浮卡展示标题，避免文字挤压只剩图标。
 * 未提供 title 插槽时无需悬浮提示，保持 false。
 */
const showTooltip = computed(
  () =>
    rootMenu.props.mode === 'vertical' &&
    isTopLevelMenuItem.value &&
    rootMenu.props?.collapse &&
    slots.title,
);

const item: MenuItemRegistered = reactive({
  active,
  parentPaths: parentPaths.value,
  path: props.path || '',
});

/**
 * 菜单项点击事件
 */
function handleClick() {
  if (props.disabled) {
    return;
  }
  rootMenu?.handleMenuItemClick?.({
    parentPaths: parentPaths.value,
    path: props.path,
  });
  emit('click', item);
}

onMounted(() => {
  subMenu?.addSubMenu?.(item);
  rootMenu?.addMenuItem?.(item);
});

onBeforeUnmount(() => {
  subMenu?.removeSubMenu?.(item);
  rootMenu?.removeMenuItem?.(item);
});
</script>
<template>
  <li
    :class="[
      rootMenu.theme,
      b(),
      is('active', active),
      is('disabled', disabled),
      is('collapse-show-title', collapseShowTitle),
    ]"
    role="menuitem"
    @click.stop="handleClick"
  >
    <VbenTooltip
      v-if="showTooltip"
      :content-class="[rootMenu.theme]"
      side="right"
    >
      <template #trigger>
        <div :class="[nsMenu.be('tooltip', 'trigger')]">
          <VbenIcon :class="nsMenu.e('icon')" :icon="menuIcon" fallback />
          <slot></slot>
          <span v-if="collapseShowTitle" :class="nsMenu.e('name')">
            <slot name="title"></slot>
          </span>
        </div>
      </template>
      <slot name="title"></slot>
    </VbenTooltip>
    <div v-show="!showTooltip" :class="[e('content')]">
      <MenuBadge
        v-if="rootMenu.props.mode !== 'horizontal'"
        class="right-2"
        v-bind="props"
      />
      <VbenIcon :class="nsMenu.e('icon')" :icon="menuIcon" />
      <slot></slot>
      <slot name="title"></slot>
    </div>
  </li>
</template>
