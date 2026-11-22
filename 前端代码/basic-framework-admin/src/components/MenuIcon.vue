<script setup lang="ts">
import {
  Avatar,
  Collection,
  Connection,
  Document,
  DocumentCopy,
  Grid,
  Key,
  Menu as MenuIconEl,
  Monitor,
  Odometer,
  OfficeBuilding,
  Position,
  Promotion,
  Setting,
  Tools,
  User,
} from '@element-plus/icons-vue';
import { computed, type Component } from 'vue';

const props = defineProps<{
  name?: string;
}>();

const ICON_MAP: Record<string, Component> = {
  'ep:tools': Tools,
  'ep:monitor': Monitor,
  'ep:avatar': Avatar,
  'ep:user': User,
  'ep:menu': MenuIconEl,
  'ep:collection': Collection,
  'ep:document': Document,
  'ep:document-copy': DocumentCopy,
  'ep:position': Position,
  'ep:promotion': Promotion,
  'ep:key': Key,
  'ep:connection': Connection,
  'ep:grid': Grid,
  'ep:odometer': Odometer,
  'ep:setting': Setting,
  'fa:address-card': OfficeBuilding,
};

const resolvedIcon = computed<Component>(() => {
  const key = (props.name || '').trim().toLowerCase();
  return ICON_MAP[key] || MenuIconEl;
});
</script>

<template>
  <el-icon><component :is="resolvedIcon" /></el-icon>
</template>
