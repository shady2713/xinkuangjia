/**
 * 动态路由模块：声明仪表盘与个人中心路由，并给出菜单元信息。
 *
 * 由 routes/index.ts 的 glob 自动汇总，无需手工注册；
 * 菜单可见性与 order、icon 由 meta 提供，权限过滤不在这里处理。
 */
import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    path: '/analytics',
    redirect: '/dashboard',
    meta: { hideInMenu: true, title: $t('page.dashboard.title') },
  },
  {
    name: 'Dashboard',
    path: '/dashboard',
    component: () => import('#/views/dashboard/analytics/index.vue'),
    meta: {
      affixTab: true,
      icon: 'lucide:layout-dashboard',
      order: -1,
      title: $t('page.dashboard.title'),
    },
  },
  {
    name: 'Profile',
    path: '/profile',
    component: () => import('#/views/_core/profile/index.vue'),
    meta: {
      icon: 'ant-design:profile-outlined',
      title: $t('ui.widgets.profile'),
      hideInMenu: true,
    },
  },
];

export default routes;
