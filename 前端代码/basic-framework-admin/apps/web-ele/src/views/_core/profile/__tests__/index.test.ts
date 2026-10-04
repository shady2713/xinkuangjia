/**
 * 个人中心页面（apps/web-ele 的 views/_core/profile）真实行为回归。
 *
 * 该页面负责拉取个人资料并向下分发、在子面板提交成功后同时刷新资料与登录身份信息，
 * 以及维护"基本设置/密码设置"两个标签页的切换：资料未下发会让子面板显示空表单，
 * 刷新分支漏掉身份信息会让右上角昵称等展示与实际不一致。用例挂载真实页面与真实的
 * Element Plus 标签页，断言子组件收到的资料属性、刷新后的真实用户 store 状态与标签页切换。
 *
 * 三个子面板与两个接口替换为受控替身：子面板是独立展示单元（各自有专门用例），接口替换只为
 * 控制返回值；同时避免真实子面板被"只导入不渲染"，从而让它们在门禁里出现假通过。
 */
import type { Pinia } from 'pinia';

import type { SystemUserProfileApi } from '#/api/system/user/profile';

import { mount } from '@vue/test-utils';
import { createApp, h, nextTick } from 'vue';

import { initStores, useUserStore } from '@vben/stores';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProfilePage from '../index.vue';

/** 个人资料接口与登录身份接口的受控返回值。 */
const profileApi = vi.hoisted(
  /** 建立两个接口的替身容器，各用例自行设置返回值。 */ () => ({
    /** 拉取个人资料的接口替身。 */
    getUserProfile: vi.fn(),
  }),
);

/** 登录身份信息接口替身。 */
const authApi = vi.hoisted(
  /** 建立登录身份接口替身，用于验证刷新分支同时更新用户 store。 */ () => ({
    /** 拉取当前登录身份与权限的接口替身。 */
    getAuthPermissionInfoApi: vi.fn(),
  }),
);

vi.hoisted(
  /**
   * `initStores` 读取运行时配置里的持久化密钥，测试进程没有加载生产配置脚本，
   * 因此在导入 Stores 之前建立最小替身；该键值不参与任何真实加密。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_APP_STORE_SECURE_KEY: '',
    });
  },
);

vi.mock(
  '#/api/system/user/profile',
  /** 只替换个人资料接口，页面自身的加载与分发逻辑保持真实。 */ () =>
    profileApi,
);

vi.mock(
  '#/api',
  /** 只替换登录身份接口，避免加载整个接口桶文件。 */ () => authApi,
);

vi.mock(
  '../modules/base-info.vue',
  /** 用最小替身承接资料属性与成功事件，避免真实面板只被导入不被渲染。 */ () => ({
    default: {
      /** 声明真实契约中的资料属性与成功事件。 */
      emits: ['success'],
      /** 面板名称，供用例定位子组件实例。 */
      name: 'BaseInfo',
      /** 资料属性由父级下发，替身只渲染占位节点。 */
      props: ['profile'],
      /**
       * 渲染占位节点，交互通过 emits 驱动。
       * @returns 返回渲染占位节点的函数。
       */
      setup() {
        /** 渲染占位节点。 */
        function renderStub() {
          return h('div', { class: 'base-info-stub' });
        }

        return renderStub;
      },
    },
  }),
);

vi.mock(
  '../modules/profile-user.vue',
  /** 用最小替身承接资料属性与成功事件。 */ () => ({
    default: {
      /** 声明真实契约中的资料属性与成功事件。 */
      emits: ['success'],
      /** 面板名称，供用例定位子组件实例。 */
      name: 'ProfileUser',
      /** 资料属性由父级下发。 */
      props: ['profile'],
      /**
       * 渲染占位节点。
       * @returns 返回渲染占位节点的函数。
       */
      setup() {
        /** 渲染占位节点。 */
        function renderStub() {
          return h('div', { class: 'profile-user-stub' });
        }

        return renderStub;
      },
    },
  }),
);

vi.mock(
  '../modules/reset-pwd.vue',
  /** 密码面板不接收资料属性，替身只渲染占位节点。 */ () => ({
    default: {
      /** 面板名称，供用例定位子组件实例。 */
      name: 'ResetPwd',
      /**
       * 渲染占位节点。
       * @returns 返回渲染占位节点的函数。
       */
      setup() {
        /** 渲染占位节点。 */
        function renderStub() {
          return h('div', { class: 'reset-pwd-stub' });
        }

        return renderStub;
      },
    },
  }),
);

/** 本文件共享的真实 Pinia 实例，由生产入口 `initStores` 创建并安装。 */
let pinia: Pinia;

/**
 * 构造一份个人资料响应，字段与后端个人中心接口对齐。
 * @param nickname 昵称，用于区分不同次刷新返回的资料。
 * @returns 满足个人资料契约的响应对象。
 */
function createProfile(
  nickname: string,
): SystemUserProfileApi.UserProfileRespVO {
  return {
    createTime: '2026-01-01 00:00:00',
    dept: { id: 1, name: '研发部' },
    id: 1,
    loginDate: '2026-01-01 00:00:00',
    loginIp: '127.0.0.1',
    nickname,
    posts: [{ id: 2, name: '工程师' }],
    roles: [{ id: 3, name: '管理员' }],
    username: 'DUMMY-user',
  };
}

/**
 * 构造一份登录身份响应。
 * @param nickname 昵称，用于核对页面把身份写回了用户 store。
 * @returns 只含页面消费字段的登录身份响应。
 */
function createAuthPermissionInfo(nickname: string) {
  return {
    permissions: ['system:user:list'],
    roles: ['super_admin'],
    user: {
      avatar: '',
      deptId: 1,
      email: '',
      id: 1,
      nickname,
      username: 'DUMMY-user',
      userType: 'super_admin',
    },
  };
}

/**
 * 取出数组中指定位置的元素。
 * @param items 目标数组。
 * @param index 目标下标，从 0 开始。
 * @returns 该下标上的元素。
 * @throws 下标越界时抛出，避免断言作用在 undefined 上。
 */
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`集合下标 ${index} 不存在`);
  }
  return item;
}

/**
 * 挂载个人中心页面。
 * @returns 组件包装器。
 */
function mountProfile() {
  return mount(ProfilePage, { global: { plugins: [pinia] } });
}

beforeEach(
  /** 每例使用独立真实 Pinia 与独立接口返回值，避免状态相互影响。 */ async () => {
    localStorage.clear();
    sessionStorage.clear();
    profileApi.getUserProfile.mockReset();
    authApi.getAuthPermissionInfoApi.mockReset();
    pinia = await initStores(
      createApp({
        /** 只为安装 Pinia 提供应用实例，不渲染任何界面。 */
        render: () => null,
      }),
      { namespace: 'profile-page-test' },
    );
  },
);

describe('个人中心资料加载', /** 资料必须在挂载后真实下发到两个资料面板。 */ () => {
  it('挂载后拉取资料并下发给子面板', /** 未下发或下发错误对象会让面板显示空表单。 */ async () => {
    const profile = createProfile('张三');
    profileApi.getUserProfile.mockResolvedValue(profile);

    const wrapper = mountProfile();

    await vi.waitFor(
      /** 加载是异步的，按子组件收到的属性等待而不是固定休眠。 */ () => {
        expect(
          wrapper.findComponent({ name: 'ProfileUser' }).props('profile'),
        ).toEqual(profile);
      },
    );
    expect(
      wrapper.findComponent({ name: 'BaseInfo' }).props('profile'),
    ).toEqual(profile);

    wrapper.unmount();
  });

  it('渲染两个标签页并默认停在基本设置', /** 默认标签写错会让用户进入页面看不到惯用面板。 */ async () => {
    profileApi.getUserProfile.mockResolvedValue(createProfile('张三'));

    const wrapper = mountProfile();
    await nextTick();

    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('基本设置');
    expect(wrapper.text()).toContain('密码设置');

    wrapper.unmount();
  });
});

describe('个人中心资料刷新', /** 面板提交成功后必须同时刷新资料与登录身份。 */ () => {
  it('子面板成功后重新拉取资料并更新用户 store', /** 刷新分支漏掉身份信息会让页面昵称与实际身份不一致。 */ async () => {
    const first = createProfile('张三');
    const second = createProfile('李四');
    profileApi.getUserProfile.mockResolvedValueOnce(first);
    const wrapper = mountProfile();
    await vi.waitFor(
      /** 先确认首次加载完成，再触发刷新分支。 */ () => {
        expect(profileApi.getUserProfile).toHaveBeenCalledTimes(1);
      },
    );
    profileApi.getUserProfile.mockResolvedValueOnce(second);
    authApi.getAuthPermissionInfoApi.mockResolvedValue(
      createAuthPermissionInfo('李四'),
    );

    wrapper.findComponent({ name: 'BaseInfo' }).vm.$emit('success');

    await vi.waitFor(
      /** 刷新包含两次异步请求，按真实结果等待。 */ () => {
        expect(useUserStore(pinia).userInfo?.nickname).toBe('李四');
      },
    );
    expect(profileApi.getUserProfile).toHaveBeenCalledTimes(2);
    expect(authApi.getAuthPermissionInfoApi).toHaveBeenCalledTimes(1);
    expect(
      wrapper.findComponent({ name: 'ProfileUser' }).props('profile'),
    ).toEqual(second);

    wrapper.unmount();
  });
});

describe('个人中心标签页切换', /** 标签页绑定必须真实切换激活面板。 */ () => {
  it('点击密码设置后切换激活标签', /** v-model 绑定失效会让用户无法进入密码设置面板。 */ async () => {
    profileApi.getUserProfile.mockResolvedValue(createProfile('张三'));
    const wrapper = mountProfile();
    await nextTick();

    const tabs = wrapper.findAll('.el-tabs__item');
    expect(tabs).toHaveLength(2);

    await at(tabs, 1).trigger('click');

    expect(wrapper.find('.el-tabs__item.is-active').text()).toBe('密码设置');

    wrapper.unmount();
  });
});
