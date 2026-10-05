/**
 * 个人中心页（common-ui 的 ui/profile/profile）真实行为回归。
 *
 * 页面把当前登录用户展示在左侧卡片上，右侧渲染业务插槽，左侧页签由外层取值驱动：
 * 头像或昵称读错会让用户怀疑自己登错了账号，缺少用户信息时未回退默认头像会显示破图，
 * 页签不抛出取值会让右侧内容永远停在第一个区块。用例真实挂载页面、读取真实 DOM，
 * 并真实点击页签断言抛出的取值。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import Profile from './profile.vue';

/** 个人中心页签夹具：两项用于核对页签顺序与抛出的取值。 */
const TABS = [
  { label: 'DUMMY-基本设置', value: 'base' },
  { label: 'DUMMY-安全设置', value: 'security' },
];

/** 用户资料夹具：头像地址为占位地址，不得使用真实凭据。 */
const USER_INFO = {
  avatar: 'https://DUMMY-avatar.example.com/avatar.png',
  nickname: 'DUMMY-管理员',
  userId: '1',
  username: 'DUMMY-admin',
};

describe('个人中心资料展示', /** 头像与账号文案决定用户能否确认当前登录身份。 */ () => {
  it('渲染头像、昵称与用户名', /** 资料错位会让用户以为登错了账号。 */ () => {
    const wrapper = mount(Profile, {
      props: { tabs: TABS, userInfo: USER_INFO },
    });

    expect(wrapper.find('img').attributes('src')).toBe(
      'https://DUMMY-avatar.example.com/avatar.png',
    );
    expect(wrapper.find('span.text-lg').text()).toBe('DUMMY-管理员');
    expect(wrapper.find(String.raw`span.text-foreground\/80`).text()).toBe(
      'DUMMY-admin',
    );
    wrapper.unmount();
  });

  it('缺少用户资料时回退默认头像并留空账号文案', /** 未回退默认头像会显示破图，文案未兜底会渲染 undefined。 */ () => {
    const wrapper = mount(Profile, {
      props: { tabs: TABS, userInfo: null },
    });

    expect(wrapper.find('img').attributes('src')).toBe('/brand-logo.png');
    expect(wrapper.find('span.text-lg').text()).toBe('');
    expect(wrapper.find(String.raw`span.text-foreground\/80`).text()).toBe('');
    wrapper.unmount();
  });

  it('右侧内容区渲染业务插槽', /** 插槽被吞掉会让个人中心只剩一片空白。 */ () => {
    const wrapper = mount(Profile, {
      props: { tabs: TABS, userInfo: USER_INFO },
      slots: {
        content: '<div class="profile-content">DUMMY-区块内容</div>',
      },
    });

    expect(wrapper.find('.profile-content').text()).toBe('DUMMY-区块内容');
    wrapper.unmount();
  });
});

describe('个人中心页签', /** 页签取值决定右侧展示哪个设置区块。 */ () => {
  it('按 tabs 渲染页签并标记当前选中项', /** 页签缺失或选中态错误会让用户找不到要改的设置。 */ () => {
    const wrapper = mount(Profile, {
      props: { modelValue: 'base', tabs: TABS, userInfo: USER_INFO },
    });
    const triggers = wrapper.findAll('[role="tab"]');

    expect(triggers).toHaveLength(2);
    expect(triggers[0]?.text()).toBe('DUMMY-基本设置');
    expect(triggers[1]?.text()).toBe('DUMMY-安全设置');
    expect(triggers[0]?.attributes('data-state')).toBe('active');
    expect(triggers[1]?.attributes('data-state')).toBe('inactive');
    wrapper.unmount();
  });

  it('点击未选中页签抛出新的取值', /** 不抛出取值会让右侧内容永远停在第一个区块。 */ async () => {
    const wrapper = mount(Profile, {
      props: { modelValue: 'base', tabs: TABS, userInfo: USER_INFO },
    });

    // 页签按真实交互链路激活：先按下再触发点击。
    await wrapper.findAll('[role="tab"]')[1]?.trigger('mousedown');
    await wrapper.findAll('[role="tab"]')[1]?.trigger('click');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['security']);
    wrapper.unmount();
  });

  it('未传入 tabs 时回退空列表且不渲染页签', /** 缺省页签应为空列表，渲染出空页签会让左栏出现无名条目。 */ () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 静默 Vue 的必填提示，避免污染用例输出。 */ () => {},
      );
    // 本用例刻意不传 tabs：运行时必须真的缺省才能验证必填提示与空列表回退，
    // 因此这里只做类型标注（按组件自身 props 契约），不改动实际传给组件的参数对象。
    const props = { userInfo: USER_INFO } as unknown as InstanceType<
      typeof Profile
    >['$props'];
    const wrapper = mount(Profile, { props });

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(wrapper.find('span.text-lg').text()).toBe('DUMMY-管理员');
    // 页签仍按类型契约声明为必填，Vue 如实提示，调用方才能发现自己漏传配置。
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('tabs');
    warnSpy.mockRestore();
    wrapper.unmount();
  });
});
