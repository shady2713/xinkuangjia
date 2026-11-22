<script setup lang="ts">
import { computed } from 'vue';

import type { MenuRouteItem } from '@/api/auth';
import MenuIcon from '@/components/MenuIcon.vue';

defineOptions({ name: 'SidebarMenuItem' });

const props = defineProps<{
  item: MenuRouteItem;
  parentPath?: string;
}>();

const fullPath = computed(() => {
  const cur = props.item.path || '';
  if (cur.startsWith('/')) return cur;
  const base = (props.parentPath || '').replace(/\/$/, '');
  return `${base}/${cur}`.replace(/\/+/g, '/');
});

const visibleChildren = computed(() =>
  (props.item.children ?? []).filter((child) => child.visible !== false),
);
</script>

<template>
  <template v-if="item.visible !== false">
    <el-sub-menu v-if="visibleChildren.length > 0" :index="fullPath">
      <template #title>
        <MenuIcon :name="item.icon" />
        <span>{{ item.name }}</span>
      </template>
      <SidebarMenuItem
        v-for="child in visibleChildren"
        :key="child.id"
        :item="child"
        :parent-path="fullPath"
      />
    </el-sub-menu>
    <el-menu-item v-else :index="fullPath">
      <MenuIcon :name="item.icon" />
      <template #title>
        <span>{{ item.name }}</span>
      </template>
    </el-menu-item>
  </template>
</template>
