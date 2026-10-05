/**
 * 个人中心基础信息表单（common-ui 的 ui/profile/base-setting）真实行为回归。
 *
 * 该组件把外层声明的字段渲染成表单，校验通过后才把全部取值抛给个人中心保存：少抛字段会
 * 让后端把资料改空，跳过校验会让空昵称落库，回车提交失效会让习惯键盘的用户以为表单坏了，
 * 暴露的表单实例失效会让个人中心顶部无法回填刚保存的资料。用例真实挂载表单、真实输入、
 * 真实点击与回车提交，并断言抛出的真实载荷。
 */
import { mount } from '@vue/test-utils';

import { z } from '@vben-core/form-ui';

import { describe, expect, it, vi } from 'vitest';

import BaseSetting from './base-setting.vue';

/** 基础信息表单夹具：昵称必填且初始为空，用于同时覆盖校验通过与校验失败两条提交路径。 */
const FORM_SCHEMA = [
  {
    component: 'VbenInput',
    componentProps: { placeholder: 'DUMMY-请输入昵称' },
    defaultValue: '',
    fieldName: 'nickname',
    label: 'DUMMY-昵称',
    rules: z.string().min(1, 'DUMMY-昵称不能为空'),
  },
  {
    component: 'VbenInput',
    componentProps: { placeholder: 'DUMMY-请输入邮箱' },
    defaultValue: 'DUMMY-user@example.com',
    fieldName: 'email',
    label: 'DUMMY-邮箱',
  },
];

/** 表单实例中用例真正消费的读写能力。 */
interface ExposedFormApi {
  /** 读取当前全部字段取值。 */
  getValues: () => Promise<Record<string, unknown>>;
  /** 写入单个字段取值。 */
  setFieldValue: (field: string, value: unknown) => Promise<void>;
}

/** 组件对外暴露的入口：个人中心顶部与提交链路共用同一份表单实例。 */
interface ExposedBaseSetting {
  /** 取当前组件的表单实例。 */
  getFormApi: () => ExposedFormApi;
}

describe('基础信息表单渲染', /** 字段与提交入口决定用户能否看到并维护自己的资料。 */ () => {
  it('按 schema 渲染输入项与提交按钮', /** 少渲染字段会让用户无法维护该项资料。 */ () => {
    const wrapper = mount(BaseSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const inputs = wrapper.findAll('input');

    expect(inputs).toHaveLength(2);
    expect(wrapper.text()).toContain('DUMMY-昵称');
    expect(wrapper.text()).toContain('DUMMY-邮箱');
    // 带默认值的字段必须回填到输入框，否则用户会以为资料丢了。
    expect((inputs[1]?.element as HTMLInputElement).value).toBe(
      'DUMMY-user@example.com',
    );
    expect((inputs[0]?.element as HTMLInputElement).placeholder).toBe(
      'DUMMY-请输入昵称',
    );
    // 按钮文案来自公共语言包键名；测试环境未加载语言包，按键名定位提交入口。
    expect(wrapper.find('button[type="submit"]').text()).toBe(
      'profile.updateBasicProfile',
    );
    wrapper.unmount();
  });

  it('未传入 schema 时只渲染提交入口', /** 缺少 schema 的调用方必须拿到空表单而不是崩溃。 */ () => {
    const wrapper = mount(BaseSetting);

    expect(wrapper.findAll('input')).toHaveLength(0);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('基础信息表单提交', /** 校验与载荷决定用户资料能否被正确保存。 */ () => {
  it('填写合法昵称后点击提交抛出全部字段取值', /** 载荷缺字段会让后端把未提交的资料清空。 */ async () => {
    const wrapper = mount(BaseSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    await wrapper.findAll('input')[0]?.setValue('DUMMY-新昵称');

    await wrapper.find('button[type="submit"]').trigger('click');
    await vi.waitFor(
      /** 等待异步校验与取值链路结算，再核对抛出的载荷。 */ () => {
        expect(wrapper.emitted('submit')).toBeTruthy();
      },
    );

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      email: 'DUMMY-user@example.com',
      nickname: 'DUMMY-新昵称',
    });
    wrapper.unmount();
  });

  it('在输入框内回车等价于点击提交', /** 回车提交失效会让习惯键盘的用户以为表单坏了。 */ async () => {
    const wrapper = mount(BaseSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const nickname = wrapper.findAll('input')[0];

    await nickname?.setValue('DUMMY-键盘昵称');
    await nickname?.trigger('keydown.enter');
    await vi.waitFor(
      /** 等待回车触发的提交链路结算。 */ () => {
        expect(wrapper.emitted('submit')).toBeTruthy();
      },
    );

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      email: 'DUMMY-user@example.com',
      nickname: 'DUMMY-键盘昵称',
    });
    wrapper.unmount();
  });

  it('必填昵称留空时校验失败且不抛出提交', /** 放行空昵称会把用户资料改空。 */ async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默校验失败日志，用例只断言业务行为。 */ () => {},
      );
    const wrapper = mount(BaseSetting, {
      props: { formSchema: FORM_SCHEMA },
    });

    await wrapper.find('button[type="submit"]').trigger('click');
    await vi.waitFor(
      /** 等待校验错误真实渲染到表单项上。 */ () => {
        expect(wrapper.text()).toContain('DUMMY-昵称不能为空');
      },
    );

    // 校验不通过时不得把半成品资料交给外层保存。
    expect(wrapper.emitted('submit')).toBeUndefined();
    // 提交被拦下会打印校验错误，便于线上定位。
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    wrapper.unmount();
  });

  it('暴露的表单实例可被消费方直接读写', /** 实例读写失效会让个人中心顶部无法回填刚保存的资料。 */ async () => {
    const wrapper = mount(BaseSetting, {
      props: { formSchema: FORM_SCHEMA },
    });
    const exposed = wrapper.vm as unknown as ExposedBaseSetting;

    const formApi = exposed.getFormApi();
    await formApi.setFieldValue('nickname', 'DUMMY-实例写入');

    expect(await formApi.getValues()).toMatchObject({
      nickname: 'DUMMY-实例写入',
    });
    wrapper.unmount();
  });
});
