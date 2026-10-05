/**
 * 数字输入（shadcn-ui 的 ui/number-field）步进与默认图标回归。
 *
 * 数字输入用于数量、页数这类只允许数值的表单字段：增减按钮必须按步长改动值并抛出更新事件，
 * 默认的减号与加号图标必须出现，否则用户看不出按钮含义；输入框必须带数值输入语义。用例真实
 * 挂载 reka-ui 的数字输入根节点，读取真实按钮状态与双向绑定事件。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import NumberField from './NumberField.vue';
import NumberFieldContent from './NumberFieldContent.vue';
import NumberFieldDecrement from './NumberFieldDecrement.vue';
import NumberFieldIncrement from './NumberFieldIncrement.vue';
import NumberFieldInput from './NumberFieldInput.vue';

/**
 * 挂载数字输入。
 * @param modelValue 当前数值。
 * @param values 记录双向绑定更新的数组。
 * @returns 已挂载的数字输入包装器。
 */
function mountNumberField(modelValue = 2, values: unknown[] = []) {
  return mount(
    h(
      NumberField,
      {
        class: 'custom-field',
        modelValue,
        /** 记录取值更新。 */
        'onUpdate:modelValue': (value: unknown) => {
          values.push(value);
        },
      },
      {
        /** 渲染输入框与增减按钮。 */
        default: () =>
          h(
            NumberFieldContent,
            { class: 'custom-content' },
            {
              /** 渲染内容。 */
              default: () => [
                h(NumberFieldDecrement, { class: 'custom-decrement' }),
                h(NumberFieldInput, { class: 'custom-input' }),
                h(NumberFieldIncrement, { class: 'custom-increment' }),
              ],
            },
          ),
      },
    ),
  );
}

describe('数字输入结构与图标', /** 默认图标与语义决定用户能否理解增减按钮。 */ () => {
  it('渲染数值输入框并合并调用方 class', /** 缺少数值语义会让移动端弹出错误键盘。 */ async () => {
    const wrapper = mountNumberField();

    const input = wrapper.find('input');
    expect(input.attributes('type')).toBe('text');
    expect(input.attributes('role')).toBe('spinbutton');
    expect(input.attributes('data-slot')).toBe('input');
    expect(input.classes()).toContain('custom-input');
    expect(input.classes()).toContain('text-center');
    expect(wrapper.find('.custom-content').classes()).toContain('relative');
    expect(wrapper.classes()).toContain('custom-field');
    expect(wrapper.classes()).toContain('grid');
  });

  it('增减按钮默认渲染减号与加号图标', /** 图标缺失会让按钮变成没有含义的空白块。 */ () => {
    const wrapper = mountNumberField();

    const decrement = wrapper.find('[data-slot="decrement"]');
    const increment = wrapper.find('[data-slot="increment"]');
    expect(decrement.classes()).toContain('custom-decrement');
    expect(decrement.classes()).toContain('left-0');
    expect(increment.classes()).toContain('custom-increment');
    expect(increment.classes()).toContain('right-0');
    expect(decrement.find('svg').exists()).toBe(true);
    expect(increment.find('svg').exists()).toBe(true);
  });

  it('增减按钮支持自定义图标', /** 无法覆盖会让特殊场景缺少业务图标。 */ () => {
    const wrapper = mount(
      h(
        NumberField,
        { modelValue: 1 },
        {
          /** 渲染带自定义图标的增减按钮。 */
          default: () =>
            h(
              NumberFieldContent,
              {},
              {
                /** 渲染内容。 */
                default: () => [
                  h(
                    NumberFieldDecrement,
                    {},
                    {
                      /** 自定义减号图标。 */
                      default: () => h('i', { class: 'custom-minus' }),
                    },
                  ),
                  h(NumberFieldInput, {}),
                  h(
                    NumberFieldIncrement,
                    {},
                    {
                      /** 自定义加号图标。 */
                      default: () => h('i', { class: 'custom-plus' }),
                    },
                  ),
                ],
              },
            ),
        },
      ),
    );

    expect(wrapper.find('.custom-minus').exists()).toBe(true);
    expect(wrapper.find('.custom-plus').exists()).toBe(true);
    expect(wrapper.find('svg').exists()).toBe(false);
  });
});

describe('数字输入步进交互', /** 步进结果决定数量类字段能否被正确调整。 */ () => {
  it('点击加号按步长增加并抛出更新', /** 步长写错会让数量一次跳变过多。 */ async () => {
    const values: unknown[] = [];
    const wrapper = mountNumberField(2, values);
    await nextTick();

    // 步进按钮走按下即触发的按住连击链路，这里复刻真实指针按下与抬起。
    await wrapper
      .find('[data-slot="increment"]')
      .trigger('pointerdown', { button: 0 });
    await wrapper.find('[data-slot="increment"]').trigger('pointerup');
    await nextTick();

    expect(values).toEqual([3]);
  });

  it('点击减号按步长减少并抛出更新', /** 只增不减会让用户无法减少数量。 */ async () => {
    const values: unknown[] = [];
    const wrapper = mountNumberField(2, values);
    await nextTick();

    await wrapper
      .find('[data-slot="decrement"]')
      .trigger('pointerdown', { button: 0 });
    await wrapper.find('[data-slot="decrement"]').trigger('pointerup');
    await nextTick();

    expect(values).toEqual([1]);
  });

  it('低于最小值时减号禁用', /** 允许继续减少会产生非法值。 */ async () => {
    const wrapper = mount(
      h(
        NumberField,
        { min: 1, modelValue: 1 },
        {
          /** 渲染输入框与增减按钮。 */
          default: () =>
            h(
              NumberFieldContent,
              {},
              {
                /** 渲染内容。 */
                default: () => [
                  h(NumberFieldDecrement),
                  h(NumberFieldInput),
                  h(NumberFieldIncrement),
                ],
              },
            ),
        },
      ),
    );
    await nextTick();

    const decrement = wrapper.find('[data-slot="decrement"]');
    expect(decrement.attributes('disabled')).toBeDefined();
    expect(decrement.attributes('data-disabled')).toBe('');
    // 已到最小值时按下不再抛出更新，避免产生非法值。
    const values: unknown[] = [];
    await decrement.trigger('pointerdown', { button: 0 });
    await nextTick();
    expect(values).toEqual([]);
  });
});
