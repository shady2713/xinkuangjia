/**
 * 个人中心安全设置（common-ui 的 ui/profile/security-setting）真实行为回归。
 *
 * 组件把账号安全开关按 schema 铺成表单：每个开关必须显示自己的标签与说明，切换时必须把
 * 该项的字段名与新的布尔值抛给外层。字段名串位会让用户以为开启了双重验证却实际改了别的
 * 安全项，取值不抛出会让账号安全配置静默失效，标签与说明错位会让用户按错误描述操作。
 * 用例真实挂载表单与 reka-ui 开关，真实点击开关并断言抛出的载荷与无障碍关联。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import SecuritySetting from './security-setting.vue';

/** 安全设置夹具：两项开关初始状态一开一关，用于核对字段与取值不会串位。 */
const FORM_SCHEMA = [
  {
    description: 'DUMMY-开启后登录需要输入动态验证码',
    fieldName: 'twoFactorAuth',
    label: 'DUMMY-双重验证',
    value: false,
  },
  {
    description: 'DUMMY-异地登录时发送提醒邮件',
    fieldName: 'loginAlert',
    label: 'DUMMY-登录提醒',
    value: true,
  },
];

describe('安全设置渲染', /** 标签、说明与初始状态决定用户能否看懂账号安全现状。 */ () => {
  it('按 schema 渲染每项标签、说明与开关初始状态', /** 少渲染一项会让用户无法加固对应的安全能力。 */ () => {
    const wrapper = mount(SecuritySetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const switches = wrapper.findAll('[role="switch"]');

    expect(switches).toHaveLength(2);
    expect(wrapper.text()).toContain('DUMMY-双重验证');
    expect(wrapper.text()).toContain('DUMMY-开启后登录需要输入动态验证码');
    expect(wrapper.text()).toContain('DUMMY-登录提醒');
    expect(wrapper.text()).toContain('DUMMY-异地登录时发送提醒邮件');
    // 初始状态必须来自 schema 的 value，读反会让用户以为账号已经加固。
    expect(switches[0]?.attributes('aria-checked')).toBe('false');
    expect(switches[1]?.attributes('aria-checked')).toBe('true');
    wrapper.unmount();
  });

  it('标签与说明通过表单项标识关联到开关', /** 关联断裂会让读屏用户听到没有含义的安全开关。 */ () => {
    const wrapper = mount(SecuritySetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const labels = wrapper.findAll('label');
    const descriptions = wrapper.findAll('p');
    const switchElement = wrapper.findAll('[role="switch"]')[1];

    expect(labels[1]?.attributes('for')).toBe(switchElement?.attributes('id'));
    expect(labels[1]?.text()).toBe('DUMMY-登录提醒');
    expect(switchElement?.attributes('aria-describedby')).toBe(
      descriptions[1]?.attributes('id'),
    );
    expect(descriptions[1]?.text()).toBe('DUMMY-异地登录时发送提醒邮件');
    wrapper.unmount();
  });

  it('未传入 schema 时回退到空列表且不渲染开关', /** 缺少 schema 的调用方必须拿到空表单而不是崩溃或无名开关。 */ () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 静默 Vue 的必填提示，避免污染用例输出。 */ () => {},
      );
    const wrapper = mount(SecuritySetting);

    expect(wrapper.findAll('[role="switch"]')).toHaveLength(0);
    expect(wrapper.text()).toBe('');
    // 组件仍按类型契约把该属性声明为必填，Vue 如实提示，调用方才能发现自己漏传配置。
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('formSchema');
    warnSpy.mockRestore();
    wrapper.unmount();
  });
});

describe('安全设置切换', /** 抛出的字段名与取值决定后端保存哪一项安全配置。 */ () => {
  it('开启双重验证时抛出该项字段名与取反后的值', /** 抛原值会让用户以为已开启双重验证而账号仍未加固。 */ async () => {
    const wrapper = mount(SecuritySetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const switchElement = wrapper.findAll('[role="switch"]')[0];

    await switchElement?.trigger('click');

    expect(wrapper.emitted('change')?.[0]).toEqual([
      { fieldName: 'twoFactorAuth', value: true },
    ]);
    // 抛出取值只表示用户意图，schema 明文值不得被就地改动，状态仍由外层持有。
    expect(switchElement?.attributes('aria-checked')).toBe('false');
    wrapper.unmount();
  });

  it('关闭登录提醒时只抛出第二项的字段名', /** 字段名串位会让用户改到另一项安全配置。 */ async () => {
    const wrapper = mount(SecuritySetting, {
      props: { formSchema: FORM_SCHEMA },
    });

    await wrapper.findAll('[role="switch"]')[1]?.trigger('click');

    const emitted = wrapper.emitted('change');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]).toEqual([{ fieldName: 'loginAlert', value: false }]);
    expect(FORM_SCHEMA[1]?.value).toBe(true);
    wrapper.unmount();
  });
});
