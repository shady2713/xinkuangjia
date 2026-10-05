/**
 * 仪表盘欢迎页（views/dashboard/analytics）真实行为回归。
 *
 * 页面按当前时间生成问候语、按登录身份渲染用户卡片，并把有权限的菜单过滤成快捷入口：
 * 问候语的时段边界写错会让用户在深夜看到"中午好"；身份字段缺失未回退会让标题出现
 * undefined；角色列表为空未回退为短横线会让界面出现空白；快捷入口未按菜单权限过滤会把
 * 用户无权访问的页面暴露成可点击入口，跳转后被权限守卫打回。用例挂载真实页面与真实
 * Element Plus 卡片，只替换路由跳转、登录身份与菜单权限来源。
 */
import { mount } from '@vue/test-utils';

import { useAccessStore, useUserStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Analytics from './index.vue';

/** 路由跳转替身。 */
const spies = vi.hoisted(
  /** 建立用例可断言的路由替身。 */ () => ({
    push: vi.fn(),
  }),
);

vi.mock(
  'vue-router',
  /** 路由是外部边界，只记录跳转目标。 */ () => ({
    /** 返回可观察的路由替身。 */
    useRouter: () => ({ push: spies.push }),
  }),
);

/** 页面声明的四个快捷入口路径。 */
const QUICK_LINK_PATHS = new Set([
  '/system/dept',
  '/system/dict',
  '/system/role',
  '/system/user',
]);

/** 真实时间构造函数：用例结束后按字节还原，避免影响其他用例。 */
const RealDate = Date;

beforeEach(
  /** 每例使用独立 Pinia 并清空替身调用。 */ () => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    // 默认全部菜单可见，便于核对快捷入口渲染。
    vi.spyOn(useAccessStore(), 'getMenuByPath').mockImplementation(
      /** 全部路径都视为已授权。 */ (path: string) =>
        QUICK_LINK_PATHS.has(path) ? ({ path } as never) : (undefined as never),
    );
  },
);

afterEach(
  /** 还原被替换的时间构造函数。 */ () => {
    vi.stubGlobal('Date', RealDate);
  },
);

/**
 * 把系统时间固定在指定小时，用于驱动问候语的时段分支。
 * @param hour 目标小时，取值 0 到 23。
 */
function freezeHour(hour: number) {
  vi.stubGlobal(
    'Date',
    class extends RealDate {
      /** 构造固定时刻：页面只用无参构造读取当前小时。 */
      constructor() {
        super(2026, 0, 2, hour, 0, 0);
      }
    },
  );
}

/**
 * 写入一份登录身份。
 * @param overrides 用例需要覆盖的身份字段。
 */
function setUser(overrides: Record<string, unknown> = {}) {
  useUserStore().setUserInfo({
    avatar: '',
    email: 'tester@example.test',
    nickname: '测试员',
    userId: 'U1',
    username: 'tester',
    ...overrides,
  } as never);
}

describe('仪表盘问候语', /** 问候语按当前时段生成，边界写错会在深夜问候用户"中午好"。 */ () => {
  it.each([
    [0, '夜深了'],
    [5, '夜深了'],
    [6, '早上好'],
    [8, '早上好'],
    [9, '上午好'],
    [11, '上午好'],
    [12, '中午好'],
    [13, '中午好'],
    [14, '下午好'],
    [17, '下午好'],
    [18, '晚上好'],
    [23, '晚上好'],
  ] as const)(
    '%i 点展示「%s」',
    /** 每个时段边界都必须落在正确的问候语上。 */ async (hour, greeting) => {
      freezeHour(hour);
      setUser();

      const wrapper = mount(Analytics);

      expect(wrapper.get('.welcome-title').text()).toContain(greeting);
    },
  );

  it('昵称缺失时回退到账号名', /** 未回退会让标题出现 undefined。 */ () => {
    freezeHour(10);
    setUser({ nickname: '' });

    const wrapper = mount(Analytics);

    expect(wrapper.get('.welcome-title').text()).toContain('tester');
  });

  it('昵称与账号名都缺失时回退为通用称呼', /** 双重缺失未兜底会让标题出现空白。 */ () => {
    freezeHour(10);
    setUser({ nickname: '', username: '' });

    const wrapper = mount(Analytics);

    expect(wrapper.get('.welcome-title').text()).toContain('用户');
  });
});

describe('仪表盘用户卡片', /** 用户卡片决定用户能否在首页核对自己的账号信息。 */ () => {
  it('渲染账号、昵称、邮箱与全部角色', /** 字段漏渲染会让用户无法核对账号归属。 */ () => {
    freezeHour(10);
    setUser();
    useUserStore().setUserRoles(['admin', 'operator']);

    const wrapper = mount(Analytics);
    const text = wrapper.text();

    expect(text).toContain('tester');
    expect(text).toContain('测试员');
    expect(text).toContain('tester@example.test');
    expect(
      wrapper
        .findAll('.el-tag')
        .map(/** 提取角色标签文本用于断言。 */ (tag) => tag.text()),
    ).toEqual(['admin', 'operator']);
  });

  it('身份缺失或字段为空时字段回退为短横线', /** 未回退会让界面出现空白，用户无法判断字段是否真的为空。 */ () => {
    freezeHour(10);
    setUser({ email: '', nickname: '', username: '' });

    const wrapper = mount(Analytics);

    expect(wrapper.findAll('.info-value').length).toBeGreaterThan(0);
    // 三个为空的身份字段与空角色列表都应渲染出短横线。
    expect(
      wrapper
        .findAll('.info-value')
        .filter(
          /** 只统计回退为短横线的取值节点。 */ (node) => node.text() === '-',
        ).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('身份未加载时整个人卡片仍可渲染', /** 身份未加载时整块渲染失败会让首页白屏。 */ () => {
    freezeHour(10);

    const wrapper = mount(Analytics);

    expect(wrapper.get('.welcome-title').text()).toContain('用户');
    expect(wrapper.findAll('.el-tag')).toHaveLength(0);
  });

  it('有头像时渲染头像图片', /** 头像缺失未隐藏会让未设置头像的用户看到破图。 */ () => {
    freezeHour(10);
    setUser({ avatar: 'https://files.test/avatar.png' });

    const wrapper = mount(Analytics);
    const avatar = wrapper.get('.avatar-img');

    expect(avatar.attributes('src')).toBe('https://files.test/avatar.png');
    expect(avatar.attributes('alt')).toBe('avatar');
  });

  it('无头像时不渲染头像区域', /** 无头像仍渲染图片占位会显示破图。 */ () => {
    freezeHour(10);
    setUser({ avatar: '' });

    const wrapper = mount(Analytics);

    expect(wrapper.find('.welcome-avatar').exists()).toBe(false);
  });
});

describe('仪表盘快捷入口', /** 快捷入口决定用户能否一键进入常用页面，且不能暴露越权入口。 */ () => {
  it('只为已授权菜单渲染快捷入口', /** 未按权限过滤会把无权页面暴露成可点击入口，跳转后被守卫打回。 */ () => {
    freezeHour(10);
    vi.mocked(useAccessStore().getMenuByPath).mockImplementation(
      /** 只授权用户管理与字典管理两个菜单。 */ (path: string) =>
        ['/system/dict', '/system/user'].includes(path)
          ? ({ path } as never)
          : (undefined as never),
    );

    const wrapper = mount(Analytics);
    const items = wrapper.findAll('.quick-link-item');

    expect(items).toHaveLength(2);
    expect(
      items.map(
        /** 提取入口标题用于断言。 */ (item) =>
          item.get('.quick-link-title').text(),
      ),
    ).toEqual(['用户管理', '字典管理']);
  });

  it('未授权任何菜单时不渲染快捷入口', /** 全部无权时仍渲染容器会留下空白卡片。 */ () => {
    freezeHour(10);
    vi.mocked(useAccessStore().getMenuByPath).mockReturnValue(
      undefined as never,
    );

    const wrapper = mount(Analytics);

    expect(wrapper.findAll('.quick-link-item')).toHaveLength(0);
  });

  it('点击快捷入口按菜单路径跳转', /** 跳转路径写错会把用户带到不存在的页面。 */ async () => {
    freezeHour(10);

    const wrapper = mount(Analytics);
    const items = wrapper.findAll('.quick-link-item');

    await items[1]?.trigger('click');

    expect(spies.push).toHaveBeenCalledWith('/system/role');
  });

  it('入口标题与说明来自页面声明的快捷入口定义', /** 说明文案丢失会让用户不知道入口的用途。 */ () => {
    freezeHour(10);

    const wrapper = mount(Analytics);

    expect(wrapper.get('.quick-link-title').text()).toBe('用户管理');
    expect(wrapper.get('.quick-link-desc').text()).toBe('管理系统用户账号');
  });
});
