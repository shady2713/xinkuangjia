/**
 * 个人中心修改密码表单（common-ui 的 ui/profile/password-setting）真实行为回归。
 *
 * 该组件把外层声明的密码字段渲染成横向表单，校验通过后才把取值抛给个人中心提交：
 * 跳过校验会让过短的密码提交成功，抛错字段会让后端改错密码，标签宽度配置丢失会让
 * 表单排版与其它设置页不一致，暴露的实例失效会让调用方无法回填或重置密码框。用例真实
 * 挂载表单、真实输入密码、真实点击提交，并断言抛出的真实载荷与表单排版。
 */
import { mount } from '@vue/test-utils';

import { z } from '@vben-core/form-ui';

import { describe, expect, it, vi } from 'vitest';

import PasswordSetting from './password-setting.vue';

/** 修改密码表单夹具：原密码必填且初始为空，密码最少 12 位。 */
const FORM_SCHEMA = [
  {
    component: 'VbenInputPassword',
    componentProps: { placeholder: 'DUMMY-请输入原密码' },
    defaultValue: '',
    fieldName: 'oldPassword',
    label: 'DUMMY-原密码',
    rules: z.string().min(12, 'DUMMY-密码至少 12 位'),
  },
  {
    component: 'VbenInputPassword',
    componentProps: { placeholder: 'DUMMY-请输入新密码' },
    defaultValue: '',
    fieldName: 'newPassword',
    label: 'DUMMY-新密码',
  },
];

/** 表单实例中用例真正消费的读写能力。 */
interface ExposedFormApi {
  /** 读取当前全部字段取值。 */
  getValues: () => Promise<Record<string, unknown>>;
  /** 写入单个字段取值。 */
  setFieldValue: (field: string, value: unknown) => Promise<void>;
}

/** 组件对外暴露的入口：调用方靠它回填或重置密码表单。 */
interface ExposedPasswordSetting {
  /** 取当前组件的表单实例。 */
  getFormApi: () => ExposedFormApi;
}

describe('修改密码表单渲染', /** 字段与排版决定用户能否正确填写并辨认密码表单。 */ () => {
  it('按 schema 渲染密码输入框与提交按钮', /** 密码框类型写错会把密码明文暴露在屏幕上。 */ () => {
    const wrapper = mount(PasswordSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const inputs = wrapper.findAll('input');

    expect(inputs).toHaveLength(2);
    expect((inputs[0]?.element as HTMLInputElement).type).toBe('password');
    expect((inputs[1]?.element as HTMLInputElement).type).toBe('password');
    expect((inputs[0]?.element as HTMLInputElement).placeholder).toBe(
      'DUMMY-请输入原密码',
    );
    expect(wrapper.text()).toContain('DUMMY-原密码');
    expect(wrapper.text()).toContain('DUMMY-新密码');
    expect(wrapper.find('button[type="submit"]').text()).toBe(
      'profile.updatePassword',
    );
    wrapper.unmount();
  });

  it('标签按组件声明的宽度渲染', /** 标签宽度丢失会让密码表单与其它设置页排版不一致。 */ () => {
    const wrapper = mount(PasswordSetting, {
      props: { formSchema: FORM_SCHEMA },
    });

    expect(wrapper.findAll('label')[0]?.attributes('style')).toContain(
      'width: 130px',
    );
    // 必填字段必须带必填星号，用户才知道哪一项不能留空。
    expect(wrapper.findAll('label')[0]?.text()).toContain('*');
    wrapper.unmount();
  });

  it('未传入 schema 时只渲染提交入口', /** 缺少 schema 的调用方必须拿到空表单而不是崩溃。 */ () => {
    const wrapper = mount(PasswordSetting);

    expect(wrapper.findAll('input')).toHaveLength(0);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('修改密码表单提交', /** 校验与载荷决定用户能否安全地换掉密码。 */ () => {
  it('填写合法原密码后点击提交抛出全部字段取值', /** 载荷缺字段会让后端收到残缺的改密请求。 */ async () => {
    const wrapper = mount(PasswordSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const inputs = wrapper.findAll('input');
    await inputs[0]?.setValue('DUMMY-old-password');
    await inputs[1]?.setValue('DUMMY-new-password');

    await wrapper.find('button[type="submit"]').trigger('click');
    await vi.waitFor(
      /** 等待异步校验与取值链路结算，再核对抛出的载荷。 */ () => {
        expect(wrapper.emitted('submit')).toBeTruthy();
      },
    );

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      newPassword: 'DUMMY-new-password',
      oldPassword: 'DUMMY-old-password',
    });
    wrapper.unmount();
  });

  it('原密码未达长度要求时校验失败且不抛出提交', /** 放行过短密码会让弱密码通过改密入口生效。 */ async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默校验失败日志，用例只断言业务行为。 */ () => {},
      );
    const wrapper = mount(PasswordSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    await wrapper.findAll('input')[0]?.setValue('DUMMY-短');

    await wrapper.find('button[type="submit"]').trigger('click');
    await vi.waitFor(
      /** 等待校验错误真实渲染到表单项上。 */ () => {
        expect(wrapper.text()).toContain('DUMMY-密码至少 12 位');
      },
    );

    // 校验不通过时不得把不合格的密码交给外层提交。
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    wrapper.unmount();
  });

  it('暴露的表单实例可被消费方直接读写', /** 实例读写失效会让调用方无法回填或重置密码框。 */ async () => {
    const wrapper = mount(PasswordSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const exposed = wrapper.vm as unknown as ExposedPasswordSetting;

    const formApi = exposed.getFormApi();
    await formApi.setFieldValue('oldPassword', 'DUMMY-实例密码');

    expect(await formApi.getValues()).toMatchObject({
      oldPassword: 'DUMMY-实例密码',
    });
    wrapper.unmount();
  });
});
