/**
 * 个人中心通知设置（common-ui 的 ui/profile/notification-setting）真实行为回归。
 *
 * 组件把外层传入的通知开关按 schema 铺成表单：每个开关必须显示自己的标签与说明，
 * 切换时必须把该项的字段名与新的布尔值抛给外层。字段名串位会让用户以为关掉了 A 通知
 * 却实际改了 B，取值不抛出会让界面看起来改成功而后端从未收到保存请求，标签与说明错位
 * 会让用户按错误的描述修改配置。用例真实挂载表单与 reka-ui 开关，真实点击开关并断言
 * 抛出的载荷与无障碍关联。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import NotificationSetting from './notification-setting.vue';

/** 通知设置夹具：两项开关初始状态一开一关，用于核对字段与取值不会串位。 */
const FORM_SCHEMA = [
  {
    description: 'DUMMY-站内信与邮件都会收到提醒',
    fieldName: 'systemMessage',
    label: 'DUMMY-系统消息',
    value: true,
  },
  {
    description: 'DUMMY-仅在待办到期时提醒',
    fieldName: 'todoTask',
    label: 'DUMMY-待办任务',
    value: false,
  },
];

describe('通知设置渲染', /** 标签、说明与初始状态决定用户能否看懂并信任这页配置。 */ () => {
  it('按 schema 渲染每项标签、说明与开关初始状态', /** 少渲染一项会让用户无法配置该通知。 */ () => {
    const wrapper = mount(NotificationSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const switches = wrapper.findAll('[role="switch"]');

    expect(switches).toHaveLength(2);
    expect(wrapper.text()).toContain('DUMMY-系统消息');
    expect(wrapper.text()).toContain('DUMMY-站内信与邮件都会收到提醒');
    expect(wrapper.text()).toContain('DUMMY-待办任务');
    expect(wrapper.text()).toContain('DUMMY-仅在待办到期时提醒');
    // 初始状态必须来自 schema 的 value，读反会让用户看到与后端相反的配置。
    expect(switches[0]?.attributes('aria-checked')).toBe('true');
    expect(switches[1]?.attributes('aria-checked')).toBe('false');
    wrapper.unmount();
  });

  it('标签与说明通过表单项标识关联到开关', /** 关联断裂会让读屏用户听到没有含义的开关。 */ () => {
    const wrapper = mount(NotificationSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const labels = wrapper.findAll('label');
    const descriptions = wrapper.findAll('p');
    const switchElement = wrapper.findAll('[role="switch"]')[0];

    expect(labels[0]?.attributes('for')).toBe(switchElement?.attributes('id'));
    expect(labels[0]?.text()).toBe('DUMMY-系统消息');
    expect(switchElement?.attributes('aria-describedby')).toBe(
      descriptions[0]?.attributes('id'),
    );
    expect(descriptions[0]?.text()).toBe('DUMMY-站内信与邮件都会收到提醒');
    wrapper.unmount();
  });

  it('未传入 schema 时回退到空列表且不渲染开关', /** 缺少 schema 的调用方必须拿到空表单而不是崩溃或无名开关。 */ () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 静默 Vue 的必填提示，避免污染用例输出。 */ () => {},
      );
    const wrapper = mount(NotificationSetting);

    expect(wrapper.findAll('[role="switch"]')).toHaveLength(0);
    expect(wrapper.text()).toBe('');
    // 组件仍按类型契约把该属性声明为必填，Vue 如实提示，调用方才能发现自己漏传配置。
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('formSchema');
    warnSpy.mockRestore();
    wrapper.unmount();
  });
});

describe('通知设置切换', /** 抛出的字段名与取值决定后端保存哪一项配置。 */ () => {
  it('切换已达开启的通知时抛出该项字段名与取反后的值', /** 抛原值会让开关点击后后端仍保持旧配置。 */ async () => {
    const wrapper = mount(NotificationSetting, {
      props: { formSchema: FORM_SCHEMA },
    });

    await wrapper.findAll('[role="switch"]')[0]?.trigger('click');

    expect(wrapper.emitted('change')?.[0]).toEqual([
      { fieldName: 'systemMessage', value: false },
    ]);
    wrapper.unmount();
  });

  it('切换第二项时只抛出第二项的字段名', /** 字段名串位会让用户改到另一项通知。 */ async () => {
    const wrapper = mount(NotificationSetting, {
      props: { formSchema: FORM_SCHEMA },
    });

    await wrapper.findAll('[role="switch"]')[1]?.trigger('click');

    const emitted = wrapper.emitted('change');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]).toEqual([{ fieldName: 'todoTask', value: true }]);
    wrapper.unmount();
  });

  it('点击后仍按 schema 的取值受控显示', /** 就地改写只读入参会让父组件的配置与界面不一致。 */ async () => {
    const wrapper = mount(NotificationSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const switchElement = wrapper.findAll('[role="switch"]')[0];

    await switchElement?.trigger('click');

    // 组件只负责抛出取值，状态由外层的 v-model 决定，schema 明文值不得被改动。
    expect(switchElement?.attributes('aria-checked')).toBe('true');
    expect(FORM_SCHEMA[0]?.value).toBe(true);
    wrapper.unmount();
  });
});
