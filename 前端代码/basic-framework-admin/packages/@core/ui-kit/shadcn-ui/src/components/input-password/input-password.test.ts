/** 密码输入框组件的明文切换测试：验证点击显隐按钮后输入类型与图标状态真实切换。 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import InputPassword from './input-password.vue';

/** 取出组件内真实渲染的原生输入框。
 * @param wrapper 已挂载的密码输入框组件。
 * @returns 供断言 type 与值绑定的原生 input 元素。
 */
function inputOf(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('input');
}

describe('密码输入框明文切换', /** 显隐按钮是唯一改变 type 的入口，点击前后必须双向可切换。 */ () => {
  it('初始为密码类型，点击后切到明文并显示已显示状态的图标', /** 默认不能明文回显密码；点击一次后必须真实切换成 text。 */ async () => {
    const wrapper = mount(InputPassword, {
      props: { modelValue: 'DUMMY-test-password' },
    });

    expect(inputOf(wrapper).attributes('type')).toBe('password');

    await wrapper.get('div.absolute').trigger('click');

    expect(inputOf(wrapper).attributes('type')).toBe('text');
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('再次点击切回密码类型', /** 切换按钮必须可逆，否则用户无法恢复遮挡。 */ async () => {
    const wrapper = mount(InputPassword, {
      props: { modelValue: 'DUMMY-test-password' },
    });

    await wrapper.get('div.absolute').trigger('click');
    await wrapper.get('div.absolute').trigger('click');

    expect(inputOf(wrapper).attributes('type')).toBe('password');
  });

  it('双向绑定值随原生输入回传', /** 组件对外契约是 v-model，输入框内容必须经 update:modelValue 交回调用方。 */ async () => {
    const wrapper = mount(InputPassword, {
      props: { modelValue: '' },
    });

    await inputOf(wrapper).setValue('DUMMY-typed-value');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      'DUMMY-typed-value',
    ]);
  });

  it('启用强度提示时渲染强度条，并保留自定义强度说明插槽', /** passwordStrength 打开后必须出现强度组件与插槽内容，否则用户看不到强度反馈。 */ () => {
    const wrapper = mount(InputPassword, {
      props: { modelValue: 'Abcd1234!', passwordStrength: true },
      slots: {
        strengthText: '强度说明',
      },
    });

    expect(wrapper.text()).toContain('强度说明');
    expect(wrapper.findAll(String.raw`div.h-1\.5`)).toHaveLength(5);
  });

  it('未启用强度提示时不渲染强度条', /** 默认关闭时不能多出强度区域，避免普通密码框变高。 */ () => {
    const wrapper = mount(InputPassword, {
      props: { modelValue: 'Abcd1234!' },
    });

    expect(wrapper.find(String.raw`div.h-1\.5`).exists()).toBe(false);
  });

  it('透传外部属性到原生输入框', /** inheritAttrs 关闭后仍要手动把禁用等属性交给真实输入控件。 */ () => {
    const wrapper = mount(InputPassword, {
      props: { modelValue: '' },
      attrs: { disabled: true, placeholder: '请输入密码' },
    });

    expect(inputOf(wrapper).attributes('placeholder')).toBe('请输入密码');
    expect(inputOf(wrapper).attributes('disabled')).toBeDefined();
  });
});
