<script setup lang="ts">
/**
 * 首页概览（通用企业级统计工作台基座）：
 * - 基于 `src/components/stats/`（StatCard / ChartCard / BaseChart / ActivityListCard）构建
 * - 数据全部来自真实后端聚合接口 `/system/dashboard/summary`
 * - 后续业务统计模块可直接复用同一套统计组件与布局规范
 */
import {
  Activity as Document,
  Building2 as OfficeBuilding,
  RotateCw as Refresh,
  ShieldCheck as Key,
  Users as User,
} from '@lucide/vue';
import type { ECBasicOption } from 'echarts/types/dist/shared';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  type DashboardSummaryRespVO,
  getDashboardSummaryApi,
} from '@/api/dashboard';
import {
  ActivityListCard,
  BaseChart,
  ChartCard,
  StatCard,
} from '@/components/stats';
import { useUserStore } from '@/stores/user';
import { formatDateTime } from '@/utils/format';
import { flattenTree } from '@/utils/tree';

defineOptions({ name: 'DashboardView' });

const router = useRouter();
const userStore = useUserStore();

const loading = ref(false);
const summary = ref<DashboardSummaryRespVO | null>(null);

const userInfo = computed(() => userStore.userInfo);
const userRoles = computed(() => userStore.roles);

const availablePaths = computed(() => {
  const flat = flattenTree(userStore.menus as unknown as { id: number | string; path?: string; children?: { id: number | string; path?: string }[] }[]);
  return new Set(flat.map((m) => String((m as { path?: string }).path || '')));
});

const quickLinks = computed(() =>
  [
    { title: '用户管理', path: '/system/user', key: 'user' },
    { title: '角色管理', path: '/system/role', key: 'role' },
    { title: '部门管理', path: '/system/dept', key: 'dept' },
    { title: '字典管理', path: '/system/dict', key: 'dict' },
    { title: '文件管理', path: '/system/file', key: 'file' },
  ].filter(
    (link) => availablePaths.value.has(link.key) || availablePaths.value.has(link.path),
  ),
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

const loginSuccessRate = computed(() => {
  const total = Number(summary.value?.sevenDayLoginCount ?? 0);
  const ok = Number(summary.value?.sevenDayLoginSuccessCount ?? 0);
  if (total <= 0) return '100%';
  return `${Math.round((ok / total) * 100)}%`;
});

const trendChartOption = computed<ECBasicOption>(() => {
  const trend = summary.value?.dailyTrend ?? [];
  const dates = trend.map((item) => item.date ?? '');
  const loginCounts = trend.map((item) => Number(item.loginCount ?? 0));
  const operateCounts = trend.map((item) => Number(item.operateCount ?? 0));

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#ffffff',
      borderColor: '#e4e4e7',
      borderWidth: 1,
      textStyle: { color: '#1f2937', fontSize: 13 },
    },
    legend: {
      top: 0,
      right: 4,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: '#64748b', fontSize: 12 },
    },
    grid: {
      left: 12,
      right: 16,
      top: 36,
      bottom: 10,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: true,
      data: dates,
      axisLine: { lineStyle: { color: '#e4e4e7' } },
      axisTick: { show: false },
      axisLabel: { color: '#64748b', fontSize: 12 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#f1f5f9', type: 'dashed' } },
      axisLabel: { color: '#94a3b8', fontSize: 12 },
    },
    series: [
      {
        name: '登录次数',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        itemStyle: { color: '#006be6' },
        lineStyle: { width: 2.5, color: '#006be6' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 107, 230, 0.22)' },
              { offset: 1, color: 'rgba(0, 107, 230, 0.01)' },
            ],
          },
        },
        data: loginCounts,
      },
      {
        name: '操作审计',
        type: 'bar',
        barMaxWidth: 22,
        itemStyle: {
          color: '#38bdf8',
          borderRadius: [4, 4, 0, 0],
        },
        data: operateCounts,
      },
    ],
  };
});

const loginDistOption = computed<ECBasicOption>(() => {
  const success = Number(summary.value?.sevenDayLoginSuccessCount ?? 0);
  const fail = Number(summary.value?.sevenDayLoginFailCount ?? 0);
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: '#ffffff',
      borderColor: '#e4e4e7',
      borderWidth: 1,
      textStyle: { color: '#1f2937', fontSize: 13 },
    },
    legend: {
      bottom: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: '#64748b', fontSize: 12 },
    },
    series: [
      {
        name: '登录状态',
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#ffffff',
          borderWidth: 2,
        },
        label: {
          show: true,
          formatter: '{b}: {c}',
          color: '#475569',
          fontSize: 12,
        },
        data: [
          { value: success, name: '登录成功', itemStyle: { color: '#006be6' } },
          { value: fail, name: '登录失败', itemStyle: { color: '#f59e0b' } },
        ],
      },
    ],
  };
});

async function loadSummary() {
  loading.value = true;
  try {
    summary.value = await getDashboardSummaryApi();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadSummary();
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- 顶部简洁工作台欢迎条（对齐 Vben 5 卡片视觉） -->
    <el-card shadow="never" :body-style="{ padding: '18px 22px' }">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3.5">
          <el-avatar
            :size="48"
            :src="userInfo?.avatar || undefined"
            class="shrink-0 !bg-[#006be6] text-lg font-semibold text-white"
          >
            {{ (userInfo?.nickname || userInfo?.username || 'A').slice(0, 1).toUpperCase() }}
          </el-avatar>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="m-0 text-[18px] font-semibold text-[#18181b]">
                {{ getGreeting() }}，{{ userInfo?.nickname || userInfo?.username || '管理员' }}
              </h1>
              <el-tag
                v-for="role in userRoles"
                :key="role"
                size="small"
                effect="plain"
                type="primary"
              >
                {{ role }}
              </el-tag>
            </div>
            <p class="m-0 mt-1 text-[13px] text-[#64748b]">
              欢迎回到企业级中后台 · 实时掌握账号权限、登录活跃与系统审计态势
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <el-button
            v-for="link in quickLinks"
            :key="link.path"
            size="small"
            plain
            @click="router.push(link.path)"
          >
            {{ link.title }}
          </el-button>
          <el-button
            :icon="Refresh"
            size="small"
            type="primary"
            plain
            :loading="loading"
            @click="loadSummary"
          >
            刷新统计
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 四栏核心统计 KPI 卡片（通用 StatCard 基座） -->
    <el-row :gutter="16">
      <el-col :xs="24" :sm="12" :lg="6" class="mb-4 lg:mb-0">
        <StatCard
          title="平台用户总数"
          :value="summary?.userTotal ?? 0"
          unit="人"
          subtitle="当前平台隔离边界内账号规模"
          footer-label="启用状态账号"
          :footer-value="`${summary?.userEnabledCount ?? 0} 人`"
          :icon="User"
          tone="primary"
          :loading="loading"
        />
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6" class="mb-4 lg:mb-0">
        <StatCard
          title="部门与角色规模"
          :value="summary?.deptTotal ?? 0"
          unit="个部门"
          subtitle="组织架构与 RBAC 权限角色配置"
          footer-label="已配置角色"
          :footer-value="`${summary?.roleTotal ?? 0} 个`"
          :icon="OfficeBuilding"
          tone="success"
          :loading="loading"
        />
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6" class="mb-4 sm:mb-0">
        <StatCard
          title="近 7 日登录次数"
          :value="summary?.sevenDayLoginCount ?? 0"
          unit="次"
          subtitle="统计周期内全平台认证记录"
          footer-label="今日登录 / 成功率"
          :footer-value="`${summary?.todayLoginCount ?? 0} 次 · ${loginSuccessRate}`"
          :icon="Key"
          tone="warning"
          :loading="loading"
        />
      </el-col>
      <el-col :xs="24" :sm="12" :lg="6">
        <StatCard
          title="近 7 日操作审计"
          :value="summary?.sevenDayOperateCount ?? 0"
          unit="条"
          subtitle="关键管理写操作审计留痕"
          footer-label="今日审计 / 字典类型"
          :footer-value="`${summary?.todayOperateCount ?? 0} 条 · ${summary?.dictTypeTotal ?? 0} 项`"
          :icon="Document"
          tone="info"
          :loading="loading"
        />
      </el-col>
    </el-row>

    <!-- 中部可视化统计区（通用 ChartCard + BaseChart 基座） -->
    <el-row :gutter="16">
      <el-col :xs="24" :lg="16" class="mb-4 lg:mb-0">
        <ChartCard
          title="近 7 日系统活跃趋势"
          subtitle="每日登录频次与操作审计趋势统计"
          :loading="loading"
          :empty="(summary?.dailyTrend?.length ?? 0) === 0"
        >
          <BaseChart :option="trendChartOption" height="280px" />
        </ChartCard>
      </el-col>
      <el-col :xs="24" :lg="8">
        <ChartCard
          title="近 7 日登录结果分布"
          subtitle="认证成功与异常失败占比"
          :loading="loading"
          :empty="Number(summary?.sevenDayLoginCount ?? 0) === 0"
          empty-text="近 7 日暂无登录记录"
        >
          <BaseChart :option="loginDistOption" height="280px" />
        </ChartCard>
      </el-col>
    </el-row>

    <!-- 底部实时动态区（通用 ActivityListCard 基座） -->
    <el-row :gutter="16">
      <el-col :xs="24" :lg="12" class="mb-4 lg:mb-0">
        <ActivityListCard
          title="最近登录记录"
          subtitle="最新 6 条管理后台认证日志"
          :more-text="availablePaths.has('/system/log/login-log') ? '查看全部' : ''"
          :loading="loading"
          :empty="(summary?.recentLogins?.length ?? 0) === 0"
          empty-text="暂无登录记录"
          @more="router.push('/system/log/login-log')"
        >
          <div class="divide-y divide-[#f1f2f5]">
            <div
              v-for="item in summary?.recentLogins ?? []"
              :key="item.id"
              class="flex items-center justify-between gap-3 py-2.5 text-sm"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate font-medium text-[#1f2937]">
                    {{ item.username || '-' }}
                  </span>
                  <el-tag
                    size="small"
                    :type="item.result === 0 ? 'success' : 'danger'"
                  >
                    {{ item.result === 0 ? '成功' : '失败' }}
                  </el-tag>
                </div>
                <div class="mt-0.5 truncate text-xs text-[#94a3b8]">
                  IP：{{ item.userIp || '-' }}
                </div>
              </div>
              <span class="shrink-0 text-xs text-[#64748b] tabular-nums">
                {{ formatDateTime(item.createTime) }}
              </span>
            </div>
          </div>
        </ActivityListCard>
      </el-col>

      <el-col :xs="24" :lg="12">
        <ActivityListCard
          title="最近操作审计"
          subtitle="最新 6 条关键写操作留痕"
          :more-text="availablePaths.has('/system/log/operate-log') ? '查看全部' : ''"
          :loading="loading"
          :empty="(summary?.recentOperates?.length ?? 0) === 0"
          empty-text="近 7 日暂无操作审计记录"
          @more="router.push('/system/log/operate-log')"
        >
          <div class="divide-y divide-[#f1f2f5]">
            <div
              v-for="item in summary?.recentOperates ?? []"
              :key="item.id"
              class="flex items-center justify-between gap-3 py-2.5 text-sm"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <el-tag size="small" type="info" effect="plain">
                    {{ item.type || '系统' }}
                  </el-tag>
                  <span class="truncate font-medium text-[#1f2937]">
                    {{ item.subType || '-' }}
                  </span>
                </div>
                <div class="mt-0.5 truncate text-xs text-[#64748b]">
                  {{ item.action || '-' }}
                </div>
              </div>
              <span class="shrink-0 text-xs text-[#64748b] tabular-nums">
                {{ formatDateTime(item.createTime) }}
              </span>
            </div>
          </div>
        </ActivityListCard>
      </el-col>
    </el-row>
  </div>
</template>
