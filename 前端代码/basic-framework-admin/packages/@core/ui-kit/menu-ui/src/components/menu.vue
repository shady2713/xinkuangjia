<script lang="ts" setup>
/**
 * 菜单容器：持有激活项、展开项与菜单项登记表，并向下提供菜单上下文。
 * 负责手风琴互斥、水平模式溢出裁剪成「更多」子菜单，以及滚动到激活项。
 * 菜单数据、路由跳转与选中落点由调用方决定，本组件只派发 open/select。
 */
import type { UseResizeObserverReturn } from '@vueuse/core';

import type { SetupContext, VNodeArrayChildren } from 'vue';

import type {
  MenuItemClicked,
  MenuItemRegistered,
  MenuProps,
  MenuProvider,
} from '../types';

import {
  computed,
  nextTick,
  reactive,
  ref,
  toRef,
  useSlots,
  watch,
  watchEffect,
} from 'vue';

import { useNamespace } from '@vben-core/composables';
import { Ellipsis } from '@vben-core/icons';

import { useResizeObserver } from '@vueuse/core';

import {
  createMenuContext,
  createSubMenuContext,
  useMenuStyle,
} from '../hooks';
import { useMenuScroll } from '../hooks/use-menu-scroll';
import { flattedChildren } from '../utils';
import SubMenu from './sub-menu.vue';

/** 菜单容器的属性契约别名：直接复用菜单属性，不额外声明成员。 */
type Props = MenuProps;

defineOptions({ name: 'Menu' });

const props = withDefaults(defineProps<Props>(), {
  accordion: true,
  collapse: false,
  mode: 'vertical',
  rounded: true,
  theme: 'dark',
  scrollToActive: false,
});

const emit = defineEmits<{
  close: [string, string[]];
  open: [string, string[]];
  select: [string, string[]];
}>();

const { b, is } = useNamespace('menu');
const menuStyle = useMenuStyle();
const slots: SetupContext['slots'] = useSlots();
const menu = ref<HTMLUListElement>();
const sliceIndex = ref(-1);
const openedMenus = ref<MenuProvider['openedMenus']>(
  props.defaultOpeneds && !props.collapse ? [...props.defaultOpeneds] : [],
);
const activePath = ref<MenuProvider['activePath']>(props.defaultActive);
const items = ref<MenuProvider['items']>({});
const subMenus = ref<MenuProvider['subMenus']>({});
const mouseInChild = ref(false);

/** 水平模式或垂直折叠态下子菜单改用悬浮卡承载内容，此时为 true。 */
const isMenuPopup = computed<MenuProvider['isMenuPopup']>(() => {
  return (
    props.mode === 'horizontal' || (props.mode === 'vertical' && props.collapse)
  );
});

/**
 * 按 sliceIndex 把摊平后的插槽节点切成主区与溢出区：-1 表示全部留在主区且不渲染「更多」入口。
 */
const getSlot = computed(() => {
  // 更新插槽内容
  const defaultSlots: VNodeArrayChildren = slots.default?.() ?? [];

  const originalSlot = flattedChildren(defaultSlots) as VNodeArrayChildren;
  const slotDefault =
    sliceIndex.value === -1
      ? originalSlot
      : originalSlot.slice(0, sliceIndex.value);

  const slotMore =
    sliceIndex.value === -1 ? [] : originalSlot.slice(sliceIndex.value);

  return { showSlotMore: slotMore.length > 0, slotDefault, slotMore };
});

watch(
  () => props.collapse,
  (value) => {
    if (value) openedMenus.value = [];
  },
);

watch(items.value, initMenu);

watch(
  () => props.defaultActive,
  (currentActive = '') => {
    if (!items.value[currentActive]) {
      activePath.value = '';
    }
    updateActiveName(currentActive);
  },
);

let resizeStopper: UseResizeObserverReturn['stop'];
watchEffect(() => {
  if (props.mode === 'horizontal') {
    resizeStopper = useResizeObserver(menu, handleResize).stop;
  } else {
    resizeStopper?.();
  }
});

// 注入上下文
createMenuContext(
  reactive({
    activePath,
    addMenuItem,
    addSubMenu,
    closeMenu,
    handleMenuItemClick,
    handleSubMenuClick,
    isMenuPopup,
    openedMenus,
    openMenu,
    props,
    removeMenuItem,
    removeSubMenu,
    subMenus,
    theme: toRef(props, 'theme'),
    items,
  }),
);

createSubMenuContext({
  addSubMenu,
  level: 1,
  mouseInChild,
  removeSubMenu,
});

/**
 * 量出单个菜单项的占位宽度，把左右外边距也算进去。
 * @param menuItem 待测量的菜单项 DOM 元素。
 * @returns 含左右外边距的总宽度；解析结果非正时按 0 处理。
 */
function calcMenuItemWidth(menuItem: HTMLElement) {
  const computedStyle = getComputedStyle(menuItem);
  const marginLeft = Number.parseInt(computedStyle.marginLeft, 10);
  const marginRight = Number.parseInt(computedStyle.marginRight, 10);
  return menuItem.offsetWidth + marginLeft + marginRight || 0;
}

/**
 * 逐个累加菜单项宽度，算出水平菜单还能放下多少项，剩余项收进「更多」子菜单。
 * 判定时预留 46 像素给「更多」入口本身。
 * @returns 溢出起点下标；-1 表示全部放得下，或菜单元素尚未挂载取不到宽度。
 */
function calcSliceIndex() {
  if (!menu.value) {
    return -1;
  }
  /**
   * 取出菜单容器下参与测量的元素子节点：注释节点直接丢弃，纯空白文本节点一并过滤。
   */
  const items = [...(menu.value?.childNodes ?? [])].filter(
    (item) =>
      // remove comment type node #12634
      item.nodeName !== '#comment' &&
      (item.nodeName !== '#text' || item.nodeValue),
  ) as HTMLElement[];

  const moreItemWidth = 46;
  const computedMenuStyle = getComputedStyle(menu?.value);

  const paddingLeft = Number.parseInt(computedMenuStyle.paddingLeft, 10);
  const paddingRight = Number.parseInt(computedMenuStyle.paddingRight, 10);
  const menuWidth = menu.value?.clientWidth - paddingLeft - paddingRight;

  let calcWidth = 0;
  let sliceIndex = 0;
  items.forEach((item, index) => {
    calcWidth += calcMenuItemWidth(item);
    if (calcWidth <= menuWidth - moreItemWidth) {
      sliceIndex = index + 1;
    }
  });
  return sliceIndex === items.length ? -1 : sliceIndex;
}

/**
 * 尾沿节流：每次调用重置计时器，只在最后一次调用后 wait 毫秒才真正执行 fn。
 * @param fn 需要节流执行的动作。
 * @param wait 静默间隔毫秒数，缺省约两帧半。
 * @returns 触发节流动作的函数，重复调用只保留最后一次。
 */
function debounce(fn: /** 待节流的无参动作 */ () => void, wait = 33.34) {
  let timer: null | ReturnType<typeof setTimeout>;
  return () => {
    timer && clearTimeout(timer);
    timer = setTimeout(() => {
      fn();
    }, wait);
  };
}

let isFirstTimeRender = true;
/**
 * 水平菜单宽度变化时重算溢出起点：结果与当前一致则什么都不做，避免无谓的重排抖动。
 * 首次触发会同步执行一次重算，之后的连续变化都走节流。
 */
function handleResize() {
  if (sliceIndex.value === calcSliceIndex()) {
    return;
  }
  /** 先复位再在下一帧重算，让插槽有机会按完整宽度重新渲染。 */
  const callback = () => {
    sliceIndex.value = -1;
    nextTick(() => {
      sliceIndex.value = calcSliceIndex();
    });
  };
  callback();
  // // execute callback directly when first time resize to avoid shaking
  isFirstTimeRender ? callback() : debounce(callback)();
  isFirstTimeRender = false;
}

/** 仅在开启自动滚动、垂直排列且未折叠时启用，避免横向菜单或折叠态去找不存在的滚动容器。 */
const enableScroll = computed(
  () => props.scrollToActive && props.mode === 'vertical' && !props.collapse,
);

const { scrollToActiveItem } = useMenuScroll(activePath, {
  enable: enableScroll,
  delay: 320,
});

// 监听 activePath 变化，自动滚动到激活项
watch(activePath, () => {
  scrollToActiveItem();
});

// 默认展开菜单
function initMenu() {
  const parentPaths = getActivePaths();

  // 展开该菜单项的路径上所有子菜单
  // expand all subMenus of the menu item
  parentPaths.forEach((path) => {
    const subMenu = subMenus.value[path];
    subMenu && openMenu(path, subMenu.parentPaths);
  });
}

/**
 * 解析出实际要激活的 path：优先命中新值，其次保留当前激活项，最后回退到 props 的默认值，
 * 三者都查不到登记表时按传入值原样写入。
 * @param val 期望激活的菜单项 path。
 */
function updateActiveName(val: string) {
  const itemsInData = items.value;
  const item =
    itemsInData[val] ||
    (activePath.value && itemsInData[activePath.value]) ||
    itemsInData[props.defaultActive || ''];

  activePath.value = item ? item.path : val;
}

/**
 * 处理叶子菜单项点击：水平模式与折叠态下没有常驻展开区，先清空展开集合再外发选中事件。
 * @param data 被点击项的 path 与父级链路；两者任一缺失时只收起子菜单、不派发 select。
 */
function handleMenuItemClick(data: MenuItemClicked) {
  const { collapse, mode } = props;
  if (mode === 'horizontal' || collapse) {
    openedMenus.value = [];
  }
  const { parentPaths, path } = data;
  if (!path || !parentPaths) {
    return;
  }

  emit('select', path, parentPaths);
}

/**
 * 子菜单标题点击的入口：已展开则收起，未展开则展开，展开集合的互斥由 openMenu 处理。
 * @param subMenu 被点击子菜单的 path、父级链路与自身激活态。
 */
function handleSubMenuClick({ parentPaths, path }: MenuItemRegistered) {
  const isOpened = openedMenus.value.includes(path);

  if (isOpened) {
    closeMenu(path, parentPaths);
  } else {
    openMenu(path, parentPaths);
  }
}

/**
 * 从展开集合中移除指定 path。
 * @param path 待收起的子菜单 path；本就不在集合中时不做任何修改。
 */
function close(path: string) {
  const i = openedMenus.value.indexOf(path);

  if (i !== -1) {
    openedMenus.value.splice(i, 1);
  }
}

/**
 * 关闭、折叠菜单
 */
function closeMenu(path: string, parentPaths: string[]) {
  if (props.accordion) {
    openedMenus.value = subMenus.value[path]?.parentPaths ?? [];
  }

  close(path);

  emit('close', path, parentPaths);
}

/**
 * 点击展开菜单
 * @param path 要展开的子菜单 path，已在展开集合中时直接返回，不重复外发 open 事件。
 * @param parentPaths 该子菜单的父级链路；手风琴模式下若当前激活项就在这条链路上，
 * 以激活项的父级链路为准，把同级已展开的兄弟节点收敛掉。
 */
function openMenu(path: string, parentPaths: string[]) {
  if (openedMenus.value.includes(path)) {
    return;
  }
  // 手风琴模式菜单
  if (props.accordion) {
    const activeParentPaths = getActivePaths();
    if (activeParentPaths.includes(path)) {
      parentPaths = activeParentPaths;
    }
    openedMenus.value = openedMenus.value.filter((path: string) =>
      parentPaths.includes(path),
    );
  }
  openedMenus.value.push(path);
  emit('open', path, parentPaths);
}

/** 把一条菜单项登记写入 items 登记表，path 重复时后写入者覆盖前者。 */
function addMenuItem(item: MenuItemRegistered) {
  items.value[item.path] = item;
}

/** 把一条子菜单登记写入 subMenus 登记表，供激活态汇总与手风琴互斥查询父级链路。 */
function addSubMenu(subMenu: MenuItemRegistered) {
  subMenus.value[subMenu.path] = subMenu;
}

/** 从 subMenus 登记表移除该子菜单，使手风琴互斥不再计入它的父级链路。 */
function removeSubMenu(subMenu: MenuItemRegistered) {
  Reflect.deleteProperty(subMenus.value, subMenu.path);
}

/** 从 items 登记表移除该菜单项，避免已卸载的项继续参与激活态回退查找。 */
function removeMenuItem(item: MenuItemRegistered) {
  Reflect.deleteProperty(items.value, item.path);
}

/**
 * 取当前激活项的父级链路，用于初始化时展开沿途子菜单与手风琴互斥。
 * @returns 父级 path 数组；无激活项、水平模式或折叠态下返回空数组。
 */
function getActivePaths() {
  const activeItem = activePath.value && items.value[activePath.value];

  if (!activeItem || props.mode === 'horizontal' || props.collapse) {
    return [];
  }

  return activeItem.parentPaths;
}
</script>
<template>
  <ul
    ref="menu"
    :class="[
      theme,
      b(),
      is(mode, true),
      is(theme, true),
      is('rounded', rounded),
      is('collapse', collapse),
      is('menu-align', mode === 'horizontal'),
    ]"
    :style="menuStyle"
    role="menu"
  >
    <template v-if="mode === 'horizontal' && getSlot.showSlotMore">
      <template v-for="(item, index) in getSlot.slotDefault" :key="index">
        <component :is="item" />
      </template>
      <SubMenu is-sub-menu-more path="sub-menu-more">
        <template #title>
          <Ellipsis class="size-4" />
        </template>
        <template v-for="(item, index) in getSlot.slotMore" :key="index">
          <component :is="item" />
        </template>
      </SubMenu>
    </template>
    <template v-else>
      <slot></slot>
    </template>
  </ul>
</template>

<style lang="scss">
$namespace: vben;

@mixin menu-item-active {
  color: var(--menu-item-active-color);
  text-decoration: none;
  cursor: pointer;
  background: var(--menu-item-active-background-color);
}

@mixin menu-item {
  position: relative;
  display: flex;
  // gap: 12px;
  align-items: center;
  height: var(--menu-item-height);
  padding: var(--menu-item-padding-y) var(--menu-item-padding-x);
  margin: 0 var(--menu-item-margin-x) var(--menu-item-margin-y)
    var(--menu-item-margin-x);
  font-size: var(--menu-font-size) !important;
  color: var(--menu-item-color);
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  list-style: none;
  background: var(--menu-item-background-color);
  border: none;
  border-radius: var(--menu-item-radius);
  transition:
    background 0.15s ease,
    color 0.15s ease,
    padding 0.15s ease,
    border-color 0.15s ease;

  &.is-disabled {
    cursor: not-allowed;
    background: none !important;
    opacity: 0.25;
  }

  .#{$namespace}-menu__icon {
    transition: transform 0.25s;
  }

  &:hover {
    .#{$namespace}-menu__icon {
      transform: scale(1.2);
    }
  }

  &:hover,
  &:focus {
    outline: none;
  }

  * {
    vertical-align: bottom;
  }
}

@mixin menu-title {
  display: inline-block;
  flex: 1 1 auto;
  min-width: 0;
  max-width: var(--menu-title-width);
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--menu-font-size) !important;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 1;
}

.is-menu-align {
  justify-content: var(--menu-align, start);
}

.#{$namespace}-menu__popup-container,
.#{$namespace}-menu {
  --menu-title-width: 140px;
  --menu-item-icon-size: var(--font-size-base, 16px);
  // 偏好设置允许放大基础字号，菜单项高度同步增长，避免文字行盒挤压相邻导航。
  --menu-item-height: max(38px, calc(var(--font-size-base, 16px) * 2.25));
  --menu-item-padding-y: max(
    21px,
    calc(var(--font-size-base, 16px) * 1.125 + 3px)
  );
  --menu-item-padding-x: 12px;
  --menu-item-popup-padding-y: 20px;
  --menu-item-popup-padding-x: 12px;
  --menu-item-margin-y: 2px;
  --menu-item-margin-x: 0px;
  --menu-item-collapse-padding-y: max(
    23.5px,
    calc(var(--font-size-base, 16px) * 1.125 + 5.5px)
  );
  --menu-item-collapse-padding-x: 0px;
  --menu-item-collapse-margin-y: 4px;
  --menu-item-collapse-margin-x: 0px;
  --menu-item-radius: 0px;
  --menu-item-indent: 16px;

  &.is-dark {
    --menu-background-color: hsl(var(--menu));
    // --menu-submenu-opened-background-color: hsl(var(--menu-opened-dark));
    --menu-item-color: hsl(var(--foreground) / 80%);
    --menu-item-background-color: var(--menu-background-color);
    --menu-item-hover-color: hsl(var(--accent-foreground));
    --menu-item-hover-background-color: hsl(var(--accent));
    --menu-item-active-color: hsl(var(--accent-foreground));
    --menu-item-active-background-color: hsl(var(--accent));
    --menu-submenu-background-color: var(--menu-background-color);
    --menu-submenu-hover-color: hsl(var(--accent-foreground));
    --menu-submenu-hover-background-color: hsl(var(--accent));
    --menu-submenu-active-color: hsl(var(--accent-foreground));
    --menu-submenu-active-background-color: transparent;
  }

  &.is-light {
    --menu-background-color: hsl(var(--menu));
    // --menu-submenu-opened-background-color: hsl(var(--menu-opened));
    --menu-item-color: hsl(var(--accent-foreground));
    --menu-item-background-color: var(--menu-background-color);
    --menu-item-hover-color: var(--menu-item-color);
    --menu-item-hover-background-color: hsl(var(--accent));
    --menu-item-active-color: hsl(var(--primary));
    --menu-item-active-background-color: hsl(var(--primary) / 15%);
    --menu-submenu-background-color: var(--menu-background-color);
    --menu-submenu-hover-color: hsl(var(--primary));
    --menu-submenu-hover-background-color: hsl(var(--accent));
    --menu-submenu-active-color: hsl(var(--primary));
    --menu-submenu-active-background-color: transparent;
  }

  &.is-rounded {
    --menu-item-margin-x: 8px;
    --menu-item-collapse-margin-x: 6px;
    --menu-item-radius: 8px;
  }

  &.is-horizontal:not(.is-rounded) {
    --menu-item-height: 40px;
    --menu-item-radius: 6px;
  }

  &.is-horizontal.is-rounded {
    --menu-item-height: 40px;
    --menu-item-radius: 6px;
    --menu-item-padding-x: 12px;
  }

  &.is-horizontal {
    --menu-item-padding-y: 0px;
    --menu-item-padding-x: 10px;
    --menu-item-margin-y: 0px;
    --menu-item-margin-x: 1px;
    --menu-background-color: transparent;

    &.is-dark {
      --menu-background-color: hsl(var(--menu));
      --menu-item-color: hsl(var(--foreground) / 80%);
      --menu-item-background-color: var(--menu-background-color);
      --menu-item-hover-color: hsl(var(--accent-foreground));
      --menu-item-hover-background-color: hsl(var(--accent));
      --menu-item-active-color: hsl(var(--accent-foreground));
      --menu-item-active-background-color: hsl(var(--accent));
      --menu-submenu-background-color: var(--menu-background-color);
      --menu-submenu-hover-color: hsl(var(--accent-foreground));
      --menu-submenu-hover-background-color: hsl(var(--accent));
      --menu-submenu-active-color: hsl(var(--accent-foreground));
      --menu-submenu-active-background-color: hsl(var(--accent));
    }

    &.is-light {
      --menu-background-color: hsl(var(--menu));
      --menu-item-color: hsl(var(--accent-foreground));
      --menu-item-background-color: var(--menu-background-color);
      --menu-item-hover-color: hsl(var(--menu-item-color));
      --menu-item-hover-background-color: hsl(var(--accent));
      --menu-item-active-color: hsl(var(--primary));
      --menu-item-active-background-color: hsl(var(--primary) / 15%);
      --menu-submenu-background-color: var(--menu-background-color);
      --menu-submenu-hover-color: hsl(var(--primary));
      --menu-submenu-hover-background-color: hsl(var(--accent));
      --menu-submenu-active-color: hsl(var(--primary));
      --menu-submenu-active-background-color: hsl(var(--primary) / 15%);
    }
  }
}

.#{$namespace}-menu {
  position: relative;
  box-sizing: border-box;
  padding-left: 0;
  margin: 0;
  list-style: none;
  background: hsl(var(--menu-background-color));

  // 垂直菜单
  &.is-vertical {
    &:not(.#{$namespace}-menu.is-collapse) {
      & .#{$namespace}-menu-item,
      & .#{$namespace}-sub-menu-content,
      & .#{$namespace}-menu-item-group__title {
        padding-left: calc(
          var(--menu-item-indent) + var(--menu-level) * var(--menu-item-indent)
        );
        white-space: nowrap;
      }

      & > .#{$namespace}-sub-menu {
        & > .#{$namespace}-menu {
          & > .#{$namespace}-menu-item {
            padding-left: calc(
              0px + var(--menu-item-indent) + var(--menu-level) *
                var(--menu-item-indent)
            );
          }
        }

        & > .#{$namespace}-sub-menu-content {
          padding-left: calc(var(--menu-item-indent) - 8px);
        }
      }
      & > .#{$namespace}-menu-item {
        padding-left: calc(var(--menu-item-indent) - 8px);
      }
    }
  }

  &.is-horizontal {
    display: flex;
    flex-wrap: nowrap;
    max-width: 100%;
    height: var(--height-horizontal-height);
    border-right: none;

    .#{$namespace}-menu-item {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: var(--menu-item-height);
      padding-right: calc(var(--menu-item-padding-x) + 6px);
      margin: 0;
      margin-right: 2px;
      // border-bottom: 2px solid transparent;
      border-radius: var(--menu-item-radius);
    }

    & > .#{$namespace}-sub-menu {
      height: var(--menu-item-height);
      margin-right: 2px;

      &:focus,
      &:hover {
        outline: none;
      }

      & .#{$namespace}-sub-menu-content {
        height: 100%;
        padding-right: 40px;
        // border-bottom: 2px solid transparent;
        border-radius: var(--menu-item-radius);
      }
    }

    & .#{$namespace}-menu-item:not(.is-disabled):hover,
    & .#{$namespace}-menu-item:not(.is-disabled):focus {
      outline: none;
    }

    & > .#{$namespace}-menu-item.is-active {
      color: var(--menu-item-active-color);
    }

    // &.is-light {
    //   & > .#{$namespace}-sub-menu {
    //     &.is-active {
    //       border-bottom: 2px solid var(--menu-item-active-color);
    //     }
    //     &:not(.is-active) .#{$namespace}-sub-menu-content {
    //       &:hover {
    //         border-bottom: 2px solid var(--menu-item-active-color);
    //       }
    //     }
    //   }
    //   & > .#{$namespace}-menu-item.is-active {
    //     border-bottom: 2px solid var(--menu-item-active-color);
    //   }

    //   & .#{$namespace}-menu-item:not(.is-disabled):hover,
    //   & .#{$namespace}-menu-item:not(.is-disabled):focus {
    //     border-bottom: 2px solid var(--menu-item-active-color);
    //   }
    // }
  }
  // 折叠菜单

  &.is-collapse {
    .#{$namespace}-menu__icon {
      margin-right: 0;
    }
    .#{$namespace}-sub-menu__icon-arrow {
      display: none;
    }

    .#{$namespace}-sub-menu-content,
    .#{$namespace}-menu-item {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--menu-item-collapse-padding-y)
        var(--menu-item-collapse-padding-x);
      margin: var(--menu-item-collapse-margin-y)
        var(--menu-item-collapse-margin-x);
      transition: all 0.3s;

      &.is-active {
        background: var(--menu-item-active-background-color) !important;
        border-radius: var(--menu-item-radius);
      }
    }

    &.is-light {
      .#{$namespace}-sub-menu-content,
      .#{$namespace}-menu-item {
        &.is-active {
          // color: hsl(var(--primary-foreground)) !important;
          background: var(--menu-item-active-background-color) !important;
        }
      }
    }

    &.is-rounded {
      .#{$namespace}-sub-menu-content,
      .#{$namespace}-menu-item {
        &.is-collapse-show-title {
          // padding: 32px 0 !important;
          margin: 4px 8px !important;
        }
      }
    }
  }

  &__popup-container {
    max-width: 240px;
    height: unset;
    padding: 0;
    background: var(--menu-background-color);
  }

  &__popup {
    padding: 10px 0;
    border-radius: var(--menu-item-radius);

    .#{$namespace}-sub-menu-content,
    .#{$namespace}-menu-item {
      padding: var(--menu-item-popup-padding-y) var(--menu-item-popup-padding-x);
    }
  }

  &__icon {
    flex-shrink: 0;
    width: var(--menu-item-icon-size);
    height: var(--menu-item-icon-size);
    margin-right: 8px;
    vertical-align: middle;
    text-align: center;
  }
}

.#{$namespace}-menu-item {
  fill: var(--menu-item-color);

  @include menu-item;

  &.is-active {
    fill: var(--menu-item-active-color);

    @include menu-item-active;
  }

  &__content {
    display: inline-flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    height: var(--menu-item-height);

    span {
      @include menu-title;
    }
  }

  &.is-collapse-show-title {
    padding: 32px 0 !important;
    // margin: 4px 8px !important;
    .#{$namespace}-menu-tooltip__trigger {
      flex-direction: column;
    }
    .#{$namespace}-menu__icon {
      display: block;
      font-size: calc(var(--font-size-base, 16px) * 1.25) !important;
      transition: all 0.25s ease;
    }

    .#{$namespace}-menu__name {
      display: inline-flex;
      margin-top: 8px;
      margin-bottom: 0;
      font-size: calc(var(--font-size-base, 16px) * 0.75);
      font-weight: 400;
      line-height: normal;
      transition: all 0.25s ease;
    }
  }

  &:not(.is-active):hover {
    color: var(--menu-item-hover-color);
    text-decoration: none;
    cursor: pointer;
    background: var(--menu-item-hover-background-color) !important;
  }

  .#{$namespace}-menu-tooltip__trigger {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0 var(--menu-item-padding-x);
    font-size: var(--menu-font-size) !important;
    line-height: var(--menu-item-height);
  }
}

.#{$namespace}-sub-menu {
  padding-left: 0;
  margin: 0;
  list-style: none;
  background: var(--menu-submenu-background-color);
  fill: var(--menu-item-color);

  &.is-active {
    div[data-state='open'] > .#{$namespace}-sub-menu-content,
    > .#{$namespace}-sub-menu-content {
      // font-weight: 500;
      color: var(--menu-submenu-active-color);
      text-decoration: none;
      cursor: pointer;
      background: var(--menu-submenu-active-background-color);
      fill: var(--menu-submenu-active-color);
    }
  }
}

.#{$namespace}-sub-menu-content {
  min-width: 0;
  height: var(--menu-item-height);
  font-size: var(--menu-font-size) !important;

  @include menu-item;

  * {
    font-size: inherit !important;
  }

  &__icon-arrow {
    // 箭头参与 flex 排版并固定在右侧，避免窄侧栏下与标题互相覆盖。
    position: static;
    flex-shrink: 0;
    margin-right: 0;
    margin-left: auto;
    // font-size: 16px;
    font-weight: normal;
    opacity: 1;
    transition: transform 0.25s ease;
  }

  &__title {
    @include menu-title;
  }

  &.is-collapse-show-title {
    flex-direction: column;
    padding: 32px 0 !important;
    // margin: 4px 8px !important;
    .#{$namespace}-menu__icon {
      display: block;
      font-size: 20px !important;
      transition: all 0.25s ease;
    }
    .#{$namespace}-sub-menu-content__title {
      display: inline-flex;
      flex-shrink: 0;
      margin-top: 8px;
      margin-bottom: 0;
      font-size: 12px;
      font-weight: 400;
      line-height: normal;
      transition: all 0.25s ease;
    }
  }

  &.is-more {
    padding-right: 12px !important;
  }

  &:not(.is-active):hover {
    &:hover {
      //color: var(--menu-submenu-hover-color);
      text-decoration: none;
      cursor: pointer;
      background: var(--menu-submenu-hover-background-color) !important;

      // svg {
      //   fill: var(--menu-submenu-hover-color);
      // }
    }
  }
}
</style>
