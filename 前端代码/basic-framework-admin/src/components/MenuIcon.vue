<script setup lang="ts">
/**
 * 统一菜单与导航图标映射（使用官方 @lucide/vue 细线条图标，1:1 对齐原版 Vben 5 视觉风格）。
 */
import {
  BookOpen,
  Building2,
  Compass,
  FileClock,
  FileText,
  FolderOpen,
  Grid2x2,
  KeyRound,
  LayoutDashboard,
  Menu as MenuLucide,
  Monitor,
  Plug,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  Wrench,
} from '@lucide/vue';
import { computed, type Component } from 'vue';

const props = defineProps<{
  name?: string;
}>();

const ICON_MAP: Record<string, Component> = {
  'ep:tools': Wrench,
  'ep:monitor': Monitor,
  'ep:avatar': ShieldCheck,
  'ep:user': UserRound,
  'ep:menu': MenuLucide,
  'ep:collection': BookOpen,
  'ep:document': FileText,
  'ep:document-copy': FileClock,
  'ep:folder': FolderOpen,
  'ep:folder-opened': FolderOpen,
  'ep:position': Compass,
  'ep:promotion': Send,
  'ep:key': KeyRound,
  'ep:connection': Plug,
  'ep:grid': Grid2x2,
  'ep:odometer': LayoutDashboard,
  'ep:setting': Settings,
  'fa:address-card': Building2,
};

const resolvedIcon = computed<Component>(() => {
  const key = (props.name || '').trim().toLowerCase();
  return ICON_MAP[key] || MenuLucide;
});
</script>

<template>
  <el-icon class="bf-lucide-icon">
    <component :is="resolvedIcon" :stroke-width="1.75" />
  </el-icon>
</template>
