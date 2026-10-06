<script lang="ts" setup>
/**
 * 标签栏「更多」按钮：网格图标触发 VbenDropdownMenu。
 * 菜单项由 menus 传入，组件不实现任何菜单项动作；
 * 属性沿用 DropdownMenuProps，只做展示与菜单渲染。
 */
import type { DropdownMenuProps } from '@vben-core/shadcn-ui';

import { LayoutGrid } from '@vben-core/icons';
import { VbenDropdownMenu } from '@vben-core/shadcn-ui';

defineProps<DropdownMenuProps>();
</script>

<template>
  <VbenDropdownMenu :menus="menus" :modal="false">
    <div
      class="flex-center h-full cursor-pointer border-l border-border px-2 text-lg font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <LayoutGrid class="size-4" />
    </div>
  </VbenDropdownMenu>
</template>
