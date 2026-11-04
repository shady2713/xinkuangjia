import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

/** 首次改密页面组件，按需加载。 */
const ChangePasswordPage = () =>
  import('#/views/_core/profile/change-password.vue');

const routes: RouteRecordRaw[] = [
  {
    path: '/analytics',
    redirect: '/dashboard',
    meta: { hideInMenu: true },
  } as any,
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
  {
    name: 'ChangePassword',
    path: '/change-password',
    component: ChangePasswordPage,
    meta: {
      hideInMenu: true,
      hideInTab: true,
      title: '修改密码',
    },
  },
];

export default routes;
