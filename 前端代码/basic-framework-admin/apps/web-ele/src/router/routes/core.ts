/**
 * 静态核心路由：根路由用基础布局承载后台页面，/auth 下挂登录、验证码登录、
 * 忘记密码、注册与 SSO 页面，另含兜底 404 路由。
 * 这些路由不参与权限生成，后端菜单路由由权限模块另行追加。
 */
import type { RouteRecordRaw } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';

import { $t } from '#/locales';

/** 后台页面布局的懒加载函数，作为根路由的容器组件。 */
const BasicLayout = () => import('#/layouts/basic.vue');
/** 认证页面布局的懒加载函数，作为 /auth 下登录类页面的容器组件。 */
const AuthPageLayout = () => import('#/layouts/auth.vue');
/** 全局404页面 */
const fallbackNotFoundRoute: RouteRecordRaw = {
  /** 404 兜底页面组件；任何路由都匹配不到时由它渲染。 */
  component: () => import('#/views/_core/fallback/not-found.vue'),
  meta: {
    hideInBreadcrumb: true,
    hideInMenu: true,
    hideInTab: true,
    title: '404',
  },
  name: 'FallbackNotFound',
  path: '/:path(.*)*',
};

/** 基本路由，这些路由是必须存在的 */
const coreRoutes: RouteRecordRaw[] = [
  /**
   * 根路由
   * 使用基础布局，作为所有页面的父级容器，子级就不必配置BasicLayout。
   * 此路由必须存在，且不应修改
   */
  {
    component: BasicLayout,
    meta: {
      hideInBreadcrumb: true,
      title: 'Root',
    },
    name: 'Root',
    path: '/',
    redirect: preferences.app.defaultHomePath,
    children: [],
  },
  {
    component: AuthPageLayout,
    meta: {
      hideInTab: true,
      title: 'Authentication',
    },
    name: 'Authentication',
    path: '/auth',
    redirect: LOGIN_PATH,
    children: [
      {
        name: 'Login',
        path: 'login',
        /** 账号密码登录页面。 */
        component: () => import('#/views/_core/authentication/login.vue'),
        meta: {
          title: $t('page.auth.login'),
        },
      },
      {
        name: 'CodeLogin',
        path: 'code-login',
        /** 验证码登录页面。 */
        component: () => import('#/views/_core/authentication/code-login.vue'),
        meta: {
          title: $t('page.auth.codeLogin'),
        },
      },
      {
        name: 'ForgetPassword',
        path: 'forget-password',
        /** 忘记密码页面。 */
        component: () =>
          import('#/views/_core/authentication/forget-password.vue'),
        meta: {
          title: $t('page.auth.forgetPassword'),
        },
      },
      {
        name: 'Register',
        path: 'register',
        /** 注册页面。 */
        component: () => import('#/views/_core/authentication/register.vue'),
        meta: {
          title: $t('page.auth.register'),
        },
      },
      {
        name: 'SSOLogin',
        path: 'sso-login',
        /** SSO 单点登录页面。 */
        component: () => import('#/views/_core/authentication/sso-login.vue'),
        meta: {
          title: $t('page.auth.login'),
        },
      },
    ],
  },
];

export { coreRoutes, fallbackNotFoundRoute };
