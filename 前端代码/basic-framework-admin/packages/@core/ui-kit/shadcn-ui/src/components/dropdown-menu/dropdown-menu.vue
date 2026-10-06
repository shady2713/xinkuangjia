<script lang="ts" setup>
/**
 * 下拉菜单：按 menus 渲染条目，点击非禁用项把整个 props 交给条目的 handler。
 * 标签页工具栏等触发按钮使用；只做渲染与透传，条目的业务含义由使用方决定。
 */
import type {
  DropdownMenuProps,
  VbenDropdownMenuItem as IDropdownMenuItem,
} from './interface';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui';

/** 下拉菜单的属性契约别名：直接复用菜单属性，不额外声明成员。 */
type Props = DropdownMenuProps;

defineOptions({ name: 'DropdownMenu' });
const props = withDefaults(defineProps<Props>(), {});

/**
 * 点击菜单条目后的分发逻辑。
 * 禁用项直接返回，条目没挂 handler 时也不做任何事；
 * 正常情况下把组件收到的整个 props 交给 handler，条目里的业务动作由使用方定义。
 * @param menu 被点击的条目，value 用于 key，handler 决定点击效果。
 */
function handleItemClick(menu: IDropdownMenuItem) {
  if (menu.disabled) {
    return;
  }
  menu?.handler?.(props);
}
</script>
<template>
  <DropdownMenu>
    <DropdownMenuTrigger class="flex h-full items-center gap-1">
      <slot></slot>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuGroup>
        <template v-for="menu in menus" :key="menu.value">
          <DropdownMenuItem
            :disabled="menu.disabled"
            class="mb-1 cursor-pointer text-foreground/80 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
            @click="handleItemClick(menu)"
          >
            <component :is="menu.icon" v-if="menu.icon" class="mr-2 size-4" />
            {{ menu.label }}
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="menu.separator" class="bg-border" />
        </template>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
