<script setup lang="ts">
/**
 * 右键菜单容器：把 menus 回调产出的菜单项渲染成浮层，点击后把数据透传给宿主。
 * 标签页等使用方按自己的实体决定菜单项，组件不解释 handlerData 的结构，
 * 也不判定菜单项该不该出现；权限与业务语义由使用方的 menus 回调负责。
 */
import type {
  ContextMenuContentProps,
  ContextMenuRootEmits,
  ContextMenuRootProps,
} from 'reka-ui';

import type { ClassType } from '@vben-core/typings';

import type { ContextMenuHandlerData, IContextMenuItem } from './interface';

import { computed } from 'vue';

import { useForwardPropsEmits } from 'reka-ui';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '../../ui/context-menu';

const props = withDefaults(
  defineProps<
    {
      class?: ClassType;
      contentClass?: ClassType;
      contentProps?: ContextMenuContentProps;
      /**
       * 宿主传入的数据包，菜单构建与点击回调都只做透传。
       * 用空对象兜底，保证两个消费点拿到的始终是对象。
       */
      handlerData?: ContextMenuHandlerData;
      itemClass?: ClassType;
      /**
       * 菜单构建函数：按触发菜单的实体产出菜单项。
       * 用方法语法声明，使使用方可以只声明自己关心的实体类型。
       * @param data 宿主传入的数据包，即触发菜单的实体。
       * @returns 该实体对应的菜单项列表。
       */
      menus(data: ContextMenuHandlerData): IContextMenuItem[];
    } & ContextMenuRootProps
  >(),
  {
    /** 宿主未传数据包时以空对象兜底，保证消费点拿到的始终是对象 */
    handlerData: () => ({}),
  },
);

const emits = defineEmits<ContextMenuRootEmits>();

const delegatedProps = computed(
  /**
   * 汇总需要透传给底层 ContextMenu 的属性，排除只由本组件消费的样式与内容类。
   * @returns 透传给底层根组件的属性集合。
   */
  () => {
    const {
      class: _cls,
      contentClass: _,
      contentProps: _cProps,
      itemClass: _iCls,
      ...delegated
    } = props;

    return delegated;
  },
);

const forwarded = useForwardPropsEmits(delegatedProps, emits);

/**
 * 调用 menus 回调取得当前实体的菜单项列表。
 * 结果不做缓存与过滤，hidden、disabled 等渲染判断都交给模板逐项处理；
 * menus 是必填项，但这里仍用可选链兜住未提供的情况。
 */
const menusView = computed(() => {
  return props.menus?.(props.handlerData);
});

/**
 * 点击某个菜单项时的分发逻辑。
 * 禁用项直接返回，item 自身没挂 handler 时也不做任何事，避免弹出空操作；
 * 正常情况下把 handlerData 原样交给 handler，菜单项内部的业务动作由使用方定义。
 * @param menu 被点击的菜单项，结构见 IContextMenuItem。
 */
function handleClick(menu: IContextMenuItem) {
  if (menu.disabled) {
    return;
  }
  menu?.handler?.(props.handlerData);
}
</script>

<template>
  <ContextMenu v-bind="forwarded">
    <ContextMenuTrigger as-child>
      <slot></slot>
    </ContextMenuTrigger>
    <ContextMenuContent
      :class="contentClass"
      v-bind="contentProps"
      class="side-content z-popup"
    >
      <template v-for="menu in menusView" :key="menu.key">
        <ContextMenuItem
          v-if="!menu.hidden"
          :class="itemClass"
          :disabled="menu.disabled"
          :inset="menu.inset || !menu.icon"
          class="cursor-pointer"
          @click="handleClick(menu)"
        >
          <component
            :is="menu.icon"
            v-if="menu.icon"
            class="mr-2 size-4 text-lg"
          />

          {{ menu.text }}
          <ContextMenuShortcut v-if="menu.shortcut">
            {{ menu.shortcut }}
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator v-if="menu.separator" />
      </template>
    </ContextMenuContent>
  </ContextMenu>
</template>
