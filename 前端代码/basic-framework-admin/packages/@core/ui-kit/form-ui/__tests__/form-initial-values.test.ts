/**
 * 表单初始值推导与具名插槽委托（use-form-context）的真实行为回归。
 *
 * 覆盖两条只在真实挂载下出现的契约：
 * ① 同名具名插槽会替换对应表单项的控件，证明插槽名确实被委托到表单项；
 * ② 按 zod 规则类型推导初始值：字符串、数字、嵌套对象、交集类型与其他类型各有确定结果。
 * 断言读取表单对外暴露的取值与真实渲染结果，不触碰内部推导函数。
 */
import type { Component } from 'vue';

import type { BaseFormComponentType } from '../src/types';

import { flushPromises, mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { useVbenForm } from '../src/use-form';

/** 初始值推导用例使用的业务值形状。 */
type InitialValues = {
  address: { city: string; zip: number };
  age: number;
  flag: boolean;
  merged: { a: string; b: string };
  name: string;
  partial: { a: string };
};

/**
 * 挂载真实表单组件并等待挂载期的字段注册与派生计算结算。
 * @param options 表单属性，与 useVbenForm 的入参一致。
 * @param slots 透传给表单组件的插槽，用于验证具名插槽委托。
 * @returns 表单操作实例与组件包装器。
 */
async function mountForm(
  options: Parameters<typeof useVbenForm>[0],
  slots?: Record<string, string>,
) {
  const [Form, formApi] = useVbenForm<BaseFormComponentType, InitialValues>(
    options,
  );
  const wrapper = mount(Form as Component, slots ? { slots } : {});
  await flushPromises();
  await wrapper.vm.$nextTick();
  await flushPromises();
  return { formApi, wrapper };
}

describe('useFormInitial 具名插槽委托', /** 表单组件必须把外部具名插槽按字段名交给对应表单项。 */ () => {
  it('同名插槽替换对应表单项的默认控件', /** 插槽名等于 fieldName 时必须渲染插槽内容并移除默认输入控件。 */ async () => {
    const { wrapper } = await mountForm(
      {
        schema: [
          { component: 'VbenInput', fieldName: 'name', label: '名称' },
          { component: 'VbenInput', fieldName: 'age', label: '年龄' },
        ],
      },
      {
        name: '<span class="delegated-slot">自定义名称控件</span>',
      },
    );

    expect(wrapper.find('.delegated-slot').exists()).toBe(true);
    expect(wrapper.text()).toContain('自定义名称控件');
    // 只有被委托的同名表单项被替换，其他字段仍使用默认控件。
    expect(wrapper.find('input[name="name"]').exists()).toBe(false);
    expect(wrapper.find('input[name="age"]').exists()).toBe(true);
  });
});

describe('useFormInitial 初始值推导', /** 按规则类型推导受控控件初始值的契约。 */ () => {
  it('按 zod 规则类型推导初始值', /** 字符串给空串、嵌套对象递归推导、交集类型合并两侧、布尔等类型交回默认值推导。 */ async () => {
    const { formApi } = await mountForm({
      schema: [
        {
          component: 'VbenInput',
          fieldName: 'name',
          label: '名称',
          rules: z.string(),
        },
        {
          component: 'VbenInput',
          fieldName: 'age',
          label: '年龄',
          rules: z.number(),
        },
        {
          component: 'VbenInput',
          fieldName: 'address',
          label: '地址',
          rules: z.object({ city: z.string(), zip: z.number() }),
        },
        {
          component: 'VbenInput',
          fieldName: 'merged',
          label: '交集',
          rules: z.intersection(
            z.object({ a: z.string() }),
            z.object({ b: z.string() }),
          ),
        },
        {
          component: 'VbenInput',
          fieldName: 'partial',
          label: '半对象交集',
          rules: z.intersection(z.object({ a: z.string() }), z.string()),
        },
        {
          component: 'VbenInput',
          fieldName: 'flag',
          label: '开关',
          rules: z.boolean(),
        },
      ],
    });

    // 字段名以点号路径写入，取值必须保持各自的嵌套形状而不是平铺的键。
    await expect(formApi.getValues()).resolves.toEqual({
      address: { city: '', zip: 0 },
      age: 0,
      flag: false,
      merged: { a: '', b: '' },
      name: '',
      partial: { a: '' },
    });
  });

  it('显式默认值优先于规则推导结果', /** defaultValue 是业务明确声明的口径，不能被规则推导出的空值覆盖。 */ async () => {
    const { formApi } = await mountForm({
      schema: [
        {
          component: 'VbenInput',
          defaultValue: '显式名称',
          fieldName: 'name',
          label: '名称',
          rules: z.string(),
        },
      ],
    });

    await expect(formApi.getValues()).resolves.toEqual(
      expect.objectContaining({ name: '显式名称' }),
    );
  });
});
