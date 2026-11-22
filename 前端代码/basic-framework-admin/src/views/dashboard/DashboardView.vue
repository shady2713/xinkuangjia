<script setup lang="ts">
/**
 * 首页概览：1:1 复刻原欢迎渐变头卡 + 当前用户 / 项目信息 / 快捷入口三栏布局。
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import { useUserStore } from '@/stores/user';
import { flattenTree } from '@/utils/tree';

defineOptions({ name: 'DashboardView' });

const router = useRouter();
const userStore = useUserStore();

const userInfo = computed(() => userStore.userInfo);
const userRoles = computed(() => userStore.roles);

const availablePaths = computed(() => {
  const flat = flattenTree(userStore.menus as any[]);
  return new Set(flat.map((m: any) => String(m.path || '')));
});

const quickLinks = computed(() =>
  [
    { title: '用户管理', path: '/system/user', key: 'user', description: '管理系统用户账号' },
    { title: '角色管理', path: '/system/role', key: 'role', description: '配置角色与权限' },
    { title: '部门管理', path: '/system/dept', key: 'dept', description: '组织架构与部门管理' },
    { title: '字典管理', path: '/system/dict', key: 'dict', description: '维护系统字典数据' },
  ].filter((link) => availablePaths.value.has(link.key) || availablePaths.value.has(link.path)),
);

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <el-card shadow="never" class="bf-welcome-card">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="m-0 mb-2 text-2xl font-semibold text-white">
            {{ getGreeting() }}，{{ userInfo?.nickname || userInfo?.username || '用户' }}
          </h1>
          <p class="m-0 text-sm text-white/85">欢迎回到管理系统后台</p>
        </div>
        <img
          v-if="userInfo?.avatar"
          :src="userInfo.avatar"
          alt="avatar"
          class="h-16 w-16 rounded-full border-[3px] border-white/50 object-cover"
        />
      </div>
    </el-card>

    <el-row :gutter="16">
      <el-col :xs="24" :md="8" class="mb-4 md:mb-0">
        <el-card shadow="never">
          <template #header>
            <span class="text-[15px] font-semibold">当前用户</span>
          </template>
          <div class="flex flex-col gap-3 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-[#64748b]">用户名</span>
              <span>{{ userInfo?.username || '-' }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#64748b]">昵称</span>
              <span>{{ userInfo?.nickname || '-' }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#64748b]">邮箱</span>
              <span>{{ userInfo?.email || '-' }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#64748b]">角色</span>
              <div class="flex flex-wrap justify-end gap-1">
                <el-tag v-for="role in userRoles" :key="role" size="small">
                  {{ role }}
                </el-tag>
                <span v-if="userRoles.length === 0">-</span>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="8" class="mb-4 md:mb-0">
        <el-card shadow="never">
          <template #header>
            <span class="text-[15px] font-semibold">项目信息</span>
          </template>
          <div class="flex flex-col gap-3 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-[#64748b]">项目名称</span>
              <span>Basic Framework Admin</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#64748b]">后端架构</span>
              <span>Spring Boot 3.5 (3 模块)</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#64748b]">前端框架</span>
              <span>Vue 3 + TypeScript (单包)</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#64748b]">UI 组件库</span>
              <span>Element Plus</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#64748b]">构建工具</span>
              <span>Vite</span>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="8">
        <el-card shadow="never">
          <template #header>
            <span class="text-[15px] font-semibold">快捷入口</span>
          </template>
          <div v-if="quickLinks.length > 0" class="flex flex-col gap-2">
            <div
              v-for="link in quickLinks"
              :key="link.path"
              class="cursor-pointer rounded-md px-3 py-2.5 transition hover:bg-[#f4f4f5]"
              @click="router.push(link.path)"
            >
              <div class="text-sm font-medium text-[#1f2937]">{{ link.title }}</div>
              <div class="mt-0.5 text-xs text-[#64748b]">{{ link.description }}</div>
            </div>
          </div>
          <el-empty v-else :image-size="60" description="暂无可用快捷入口" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.bf-welcome-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

.bf-welcome-card :deep(.el-card__body) {
  padding: 24px 32px;
}
</style>
