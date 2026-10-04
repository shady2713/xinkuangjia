/**
 * 数据字典选择器（apps/web-ele 的 form-create/components/dict-select）真实行为回归。
 *
 * 该组件把字典类型与值类型翻译成下拉、单选或多选控件：值类型映射错会让布尔字典显示成
 * 字符串、单选与多选分支写反会让页面出现错误的交互形态，字典类型拼错会让所有选项消失。
 * 用例挂载真实 Element Plus 控件，只把字典数据来源替换成可断言的受控返回，
 * 组件的分支选择、选项映射与属性透传全部真实执行。
 */
import { mount } from '@vue/test-utils';

import {
  ElCheckbox,
  ElCheckboxGroup,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
} from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DictSelect from './dict-select.vue';

/** 字典数据来源替身记录的调用参数；模块替身与用例读取同一实例。 */
const dictProbe = vi.hoisted(
  /** 建立可逐例重置的字典返回与调用记录。 */ () => ({
    /** 每次 getDictOptions 的入参记录。 */
    calls: [] as unknown[][],
    /** 本次要返回的字典项。 */
    options: [] as { label: string; value: boolean | number | string }[],
  }),
);

vi.mock(
  '@vben/hooks',
  /** 只替换字典数据来源，组件的值类型映射与渲染分支保持真实实现。 */ () => ({
    /**
     * 记录入参并返回本用例配置的字典项。
     * @param dictType 字典类型。
     * @param valueType 字典值类型，缺省表示字符串。
     * @returns 当前用例配置的字典项集合。
     */
    getDictOptions: (dictType: string, valueType?: string) => {
      dictProbe.calls.push([dictType, valueType]);
      return dictProbe.options;
    },
  }),
);

/**
 * 挂载字典选择器。
 * @param props 组件属性，dictType 缺省时使用固定字典类型。
 * @returns 已挂载的组件包装器。
 */
function mountDictSelect(props: Record<string, unknown> = {}) {
  return mount(DictSelect, {
    props: { dictType: 'system_user_sex', ...props },
  });
}

beforeEach(
  /** 每例从空调用记录与两条字典项出发。 */ () => {
    dictProbe.calls = [];
    dictProbe.options = [
      { label: '男', value: 1 },
      { label: '女', value: 2 },
    ];
  },
);

describe('值类型映射', /** 值类型决定字典项如何翻译成控件取值，映射错会让提交值与字典不一致。 */ () => {
  it('默认按字符串类型取字典', /** 未声明值类型时必须走字符串口径，不能静默取错类型。 */ () => {
    const wrapper = mountDictSelect();

    expect(dictProbe.calls).toEqual([['system_user_sex', undefined]]);
    expect(wrapper.findComponent(ElSelect).exists()).toBe(true);
    expect(wrapper.findAllComponents(ElOption)).toHaveLength(2);

    wrapper.unmount();
  });

  it('int 类型与字符串类型使用同一字典来源', /** 整型字典同样来自字典表，多传值类型会改变后端口径。 */ () => {
    const wrapper = mountDictSelect({ valueType: 'int' });

    expect(dictProbe.calls).toEqual([['system_user_sex', undefined]]);

    wrapper.unmount();
  });

  it('bool 类型按布尔口径取字典', /** 布尔字典不传 boolean 会把 true/false 显示成字符串。 */ () => {
    const wrapper = mountDictSelect({ valueType: 'bool' });

    expect(dictProbe.calls).toEqual([['system_user_sex', 'boolean']]);

    wrapper.unmount();
  });

  it('未知值类型不取字典且不渲染选项', /** 未知类型继续取字典会渲染出语义不明的选项。 */ () => {
    const wrapper = mountDictSelect({ valueType: 'unknown' });

    expect(dictProbe.calls).toEqual([]);
    expect(wrapper.findAllComponents(ElOption)).toHaveLength(0);
    expect(wrapper.findComponent(ElSelect).exists()).toBe(true);

    wrapper.unmount();
  });
});

describe('选择器形态', /** 三种形态由同一份字典数据驱动，分支写错会让页面出现错误的交互控件。 */ () => {
  it('select 形态把字典项渲染为下拉选项', /** 选项值与文案错位会让用户选到错误的字典项。 */ () => {
    const wrapper = mountDictSelect({ selectType: 'select' });

    const options = wrapper.findAllComponents(ElOption);
    expect(
      options.map(
        /** 取出选项取值，核对与字典项一一对应。 */ (o) => o.props('value'),
      ),
    ).toEqual([1, 2]);
    expect(
      options.map(
        /** 取出选项文案，核对与字典项一一对应。 */ (o) => o.props('label'),
      ),
    ).toEqual(['男', '女']);

    wrapper.unmount();
  });

  it('radio 形态把字典项渲染为单选项', /** 单选形态缺失会让业务只能退化成下拉选择。 */ () => {
    const wrapper = mountDictSelect({ selectType: 'radio' });

    expect(wrapper.findComponent(ElSelect).exists()).toBe(false);
    expect(wrapper.findComponent(ElRadioGroup).exists()).toBe(true);
    const radios = wrapper.findAllComponents(ElRadio);
    expect(radios).toHaveLength(2);
    expect(
      radios.map(
        /** 取出单选项取值，核对与字典项一致。 */ (r) => r.props('label'),
      ),
    ).toEqual([1, 2]);
    expect(wrapper.text()).toContain('男');
    expect(wrapper.text()).toContain('女');

    wrapper.unmount();
  });

  it('checkbox 形态把字典项渲染为多选项', /** 多选形态缺失会让业务无法一次选择多个字典项。 */ () => {
    const wrapper = mountDictSelect({ selectType: 'checkbox' });

    expect(wrapper.findComponent(ElSelect).exists()).toBe(false);
    expect(wrapper.findComponent(ElCheckboxGroup).exists()).toBe(true);
    const checkboxes = wrapper.findAllComponents(ElCheckbox);
    expect(checkboxes).toHaveLength(2);
    expect(
      checkboxes.map(
        /** 取出多选项取值，核对与字典项一致。 */ (c) => c.props('label'),
      ),
    ).toEqual([1, 2]);
    expect(wrapper.text()).toContain('男');

    wrapper.unmount();
  });

  it('未声明形态时按下拉渲染', /** 缺省形态必须是下拉，不能渲染出两个控件或空白。 */ () => {
    const wrapper = mountDictSelect({ selectType: undefined });

    expect(wrapper.findComponent(ElSelect).exists()).toBe(true);
    expect(wrapper.findComponent(ElRadioGroup).exists()).toBe(false);
    expect(wrapper.findComponent(ElCheckboxGroup).exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('属性透传', /** 表单容器会把占位、禁用等属性透传给控件，丢失会让页面配置失效。 */ () => {
  it('下拉形态把外部属性透传给选择控件', /** 占位文案与禁用状态丢失会让页面无法表达输入要求。 */ () => {
    const wrapper = mountDictSelect({
      disabled: true,
      placeholder: '请选择性别',
    });

    const select = wrapper.findComponent(ElSelect);
    expect(select.props('placeholder')).toBe('请选择性别');
    expect(select.props('disabled')).toBe(true);

    wrapper.unmount();
  });

  it('单选形态把外部属性透传给单选框组', /** 属性只透传给下拉会让单选与多选形态丢失页面配置。 */ () => {
    const wrapper = mountDictSelect({
      disabled: true,
      selectType: 'radio',
    });

    expect(wrapper.findComponent(ElRadioGroup).props('disabled')).toBe(true);

    wrapper.unmount();
  });

  it('多选形态把外部属性透传给多选框组', /** 属性漏传会让多选形态无法按页面要求禁用。 */ () => {
    const wrapper = mountDictSelect({
      disabled: true,
      selectType: 'checkbox',
    });

    expect(wrapper.findComponent(ElCheckboxGroup).props('disabled')).toBe(true);

    wrapper.unmount();
  });
});
