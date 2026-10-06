<script lang="ts" setup>
/**
 * 子菜单：递归承载菜单树，汇总子级激活态并在弹出模式下用悬浮卡展示下一级。
 * 通过子菜单上下文向下一层传递层级与鼠标移入标记，管理悬浮展开的延时与收回。
 * 叶子菜单项由 menu-item 渲染，展开项集合仍由根菜单统一持有。
 */
import type { HoverCardContentProps } from '@vben-core/shadcn-ui';

import type { MenuItemRegistered, MenuProvider, SubMenuProps } from '../types';

import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import { useNamespace } from '@vben-core/composables';
import { VbenHoverCard } from '@vben-core/shadcn-ui';

import {
  createSubMenuContext,
  useMenu,
  useMenuContext,
  useMenuStyle,
  useSubMenuContext,
} from '../hooks';
import CollapseTransition from './collapse-transition.vue';
import SubMenuContent from './sub-menu-content.vue';

/**
 * 子菜单属性：在子菜单字段之上补充溢出「更多」标记，标识这是水平菜单裁剪出来的汇总入口。
 */
interface Props extends SubMenuProps {
  isSubMenuMore?: boolean;
}

defineOptions({ name: 'SubMenu' });

/** 注册子菜单属性，禁用开关与更多标记缺省为 false。 */
const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  isSubMenuMore: false,
});

const { parentMenu, parentPaths } = useMenu();
const { b, is } = useNamespace('sub-menu');
const nsMenu = useNamespace('menu');
const rootMenu = useMenuContext();
const subMenu = useSubMenuContext();
const subMenuStyle = useMenuStyle(subMenu);

const mouseInChild = ref(false);

// 子菜单只登记子级菜单项（subMenus）；菜单项本身由顶层 menu.vue 统一登记，此处不持有 items。
const subMenus = ref<MenuProvider['subMenus']>({});
const timer = ref<null | ReturnType<typeof setTimeout>>(null);

createSubMenuContext({
  addSubMenu,
  handleMouseleave,
  level: (subMenu?.level ?? 0) + 1,
  mouseInChild,
  removeSubMenu,
});

/** 本子菜单是否已展开，由根菜单的展开集合按 path 判定。 */
const opened = computed(() => {
  return rootMenu?.openedMenus.includes(props.path);
});
/** 直属父级是根 Menu 时为 true，用于区分一级子菜单与嵌套子菜单的样式差异。 */
const isTopLevelMenuSubmenu = computed(
  () => parentMenu.value?.type.name === 'Menu',
);
/** 跟随根菜单的排列模式，取不到上下文时按垂直菜单处理。 */
const mode = computed(() => rootMenu?.props.mode ?? 'vertical');
/** 跟随根菜单的圆润风格开关，决定子菜单容器是否加圆角类名。 */
const rounded = computed(() => rootMenu?.props.rounded);
/** 本层子菜单所处的层级，取自向上取到的子菜单上下文，缺省为 0。 */
const currentLevel = computed(() => subMenu?.level ?? 0);
/** 层级为 1 即根菜单下的直接子菜单，悬浮卡弹出方向与折叠态标题取舍都以此为界。 */
const isFirstLevel = computed(() => {
  return currentLevel.value === 1;
});

/** 悬浮卡弹出参数：水平一级菜单向下弹出，其余向右弹出，并留出固定的顶部避让距离。 */
const contentProps = computed((): HoverCardContentProps => {
  const isHorizontal = mode.value === 'horizontal';
  const side = isHorizontal && isFirstLevel.value ? 'bottom' : 'right';
  return {
    collisionPadding: { top: 20 },
    side,
    sideOffset: isHorizontal ? 5 : 10,
  };
});

const active = computed(
  /**
   * 汇总子级菜单的激活态，供菜单项高亮使用。
   * @returns 任一子级菜单处于激活态时为 true。
   */
  () => {
    let isActive = false;

    Object.values(subMenus.value).forEach(
      /**
       * 命中任一激活的子级菜单即视为激活。
       * @param subItem 子级菜单登记项。
       */
      (subItem) => {
        if (subItem.active) {
          isActive = true;
        }
      },
    );
    return isActive;
  },
);

/**
 * 登记一个子级菜单，供激活态汇总与父子联动使用。
 * @param subMenu 子级菜单的登记信息。
 */
function addSubMenu(subMenu: MenuItemRegistered) {
  subMenus.value[subMenu.path] = subMenu;
}

/**
 * 注销一个下级子菜单；卸载时由组件生命周期调用，使本层不再汇总它的激活态。
 * @param subMenu 待注销的子菜单登记信息。
 */
function removeSubMenu(subMenu: MenuItemRegistered) {
  Reflect.deleteProperty(subMenus.value, subMenu.path);
}

/**
 * 点击submenu展开/关闭
 */
function handleClick() {
  const mode = rootMenu?.props.mode;
  if (
    // 当前菜单禁用时，不展开
    props.disabled ||
    (rootMenu?.props.collapse && mode === 'vertical') ||
    // 水平模式下不展开
    mode === 'horizontal'
  ) {
    return;
  }

  rootMenu?.handleSubMenuClick({
    active: active.value,
    parentPaths: parentPaths.value,
    path: props.path,
  });
}

/**
 * 鼠标或焦点移入本层时的处理：垂直非折叠菜单靠点击展开，只标记父层鼠标已移入；
 * 折叠态与水平模式则延时自动展开，并向上补发一次 mouseenter 让外层弹层保持可见。
 * @param event 触发事件，focus 事件直接返回，只处理鼠标移入。
 * @param showTimeout 自动展开前的等待毫秒数，弹层内容区用更短的 100 毫秒以衔接移动。
 */
function handleMouseenter(event: FocusEvent | MouseEvent, showTimeout = 300) {
  if (event.type === 'focus') {
    return;
  }

  if (
    (!rootMenu?.props.collapse && rootMenu?.props.mode === 'vertical') ||
    props.disabled
  ) {
    if (subMenu) {
      subMenu.mouseInChild.value = true;
    }
    return;
  }
  if (subMenu) {
    subMenu.mouseInChild.value = true;
  }

  timer.value && window.clearTimeout(timer.value);
  timer.value = setTimeout(() => {
    rootMenu?.openMenu(props.path, parentPaths.value);
  }, showTimeout);
  parentMenu.value?.vnode.el?.dispatchEvent(new MouseEvent('mouseenter'));
}

/**
 * 鼠标移出本层时的处理：垂直非折叠菜单只清除父层鼠标标记，不做延时收回；
 * 折叠态与水平模式先取消未触发的展开定时器，再延时 300 毫秒收回，期间若鼠标进入下级子菜单则放弃收回。
 * @param deepDispatch 为真时继续把收回意图向父层逐级传递，避免嵌套弹层被提前关闭。
 */
function handleMouseleave(deepDispatch = false) {
  if (
    !rootMenu?.props.collapse &&
    rootMenu?.props.mode === 'vertical' &&
    subMenu
  ) {
    subMenu.mouseInChild.value = false;
    return;
  }

  timer.value && window.clearTimeout(timer.value);

  if (subMenu) {
    subMenu.mouseInChild.value = false;
  }
  timer.value = setTimeout(() => {
    !mouseInChild.value && rootMenu?.closeMenu(props.path, parentPaths.value);
  }, 300);

  if (deepDispatch) {
    subMenu?.handleMouseleave?.(true);
  }
}

/** 激活时优先用激活图标，未激活时用普通图标；两者都未传时为 undefined，图标组件走 fallback。 */
const menuIcon = computed(() =>
  active.value ? props.activeIcon || props.icon : props.icon,
);

const item = reactive({
  active,
  parentPaths,
  path: props.path,
});

onMounted(() => {
  subMenu?.addSubMenu?.(item);
  rootMenu?.addSubMenu?.(item);
});

onBeforeUnmount(() => {
  subMenu?.removeSubMenu?.(item);
  rootMenu?.removeSubMenu?.(item);
});
</script>
<template>
  <li
    :class="[
      b(),
      is('opened', opened),
      is('active', active),
      is('disabled', disabled),
    ]"
    @focus="handleMouseenter"
    @mouseenter="handleMouseenter"
    @mouseleave="() => handleMouseleave()"
  >
    <template v-if="rootMenu.isMenuPopup">
      <VbenHoverCard
        :content-class="[
          rootMenu.theme,
          nsMenu.e('popup-container'),
          is(rootMenu.theme, true),
          opened ? '' : 'hidden',
          'overflow-auto',
          'max-h-[calc(var(--reka-hover-card-content-available-height)-20px)]',
          mode === 'horizontal' ? 'is-horizontal' : '',
        ]"
        :content-props="contentProps"
        :open="true"
        :open-delay="0"
      >
        <template #trigger>
          <SubMenuContent
            :class="is('active', active)"
            :icon="menuIcon"
            :is-menu-more="isSubMenuMore"
            :is-top-level-menu-submenu="isTopLevelMenuSubmenu"
            :level="currentLevel"
            :path="path"
            @click.stop="handleClick"
          >
            <template #title>
              <slot name="title"></slot>
            </template>
          </SubMenuContent>
        </template>
        <div
          :class="[nsMenu.is(mode, true), nsMenu.e('popup')]"
          @focus="(e) => handleMouseenter(e, 100)"
          @mouseenter="(e) => handleMouseenter(e, 100)"
          @mouseleave="() => handleMouseleave(true)"
        >
          <ul
            :class="[nsMenu.b(), is('rounded', rounded)]"
            :style="subMenuStyle"
          >
            <slot></slot>
          </ul>
        </div>
      </VbenHoverCard>
    </template>

    <template v-else>
      <SubMenuContent
        :class="is('active', active)"
        :icon="menuIcon"
        :is-menu-more="isSubMenuMore"
        :is-top-level-menu-submenu="isTopLevelMenuSubmenu"
        :level="currentLevel"
        :path="path"
        @click.stop="handleClick"
      >
        <slot name="content"></slot>
        <template #title>
          <slot name="title"></slot>
        </template>
      </SubMenuContent>
      <CollapseTransition>
        <ul
          v-show="opened"
          :class="[nsMenu.b(), is('rounded', rounded)]"
          :style="subMenuStyle"
        >
          <slot></slot>
        </ul>
      </CollapseTransition>
    </template>
  </li>
</template>
