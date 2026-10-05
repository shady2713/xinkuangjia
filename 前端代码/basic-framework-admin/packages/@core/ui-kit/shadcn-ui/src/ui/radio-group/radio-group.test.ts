/**
 * 单选组（shadcn-ui 的 ui/radio-group）结构与选择回归。
 *
 * 单选组用于互斥选项：容器声明单选语义，选中项必须渲染指示圆点，点击未选项必须抛出新的选中
 * 值。语义或绑定写错会让用户无法判断当前选项，或让选择结果丢失。用例真实挂载 reka-ui 的单选
 * 根节点，读取真实 aria 属性与双向绑定事件。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import RadioGroup from './RadioGroup.vue';
import RadioGroupItem from './RadioGroupItem.vue';

/**
 * 挂载单选组。
 * @param modelValue 当前选中值。
 * @param values 记录选中值更新的数组。
 * @returns 已挂载的单选组包装器。
 */
function mountRadioGroup(modelValue = 'a', values: unknown[] = []) {
  return mount(
    h(
      RadioGroup,
      {
        class: 'custom-group',
        modelValue,
        /** 记录取值更新。 */
        'onUpdate:modelValue': (value: unknown) => {
          values.push(value);
        },
      },
      {
        /** 渲染两个互斥选项。 */
        default: () =>
          ['a', 'b'].map(
            /** 按取值渲染单选项。 */ (value) =>
              h(
                RadioGroupItem,
                { class: `item-${value}`, value },
                {
                  /** 选项文案。 */
                  default: () => (value === 'a' ? '选项一' : '选项二'),
                },
              ),
          ),
      },
    ),
  );
}

describe('单选组结构与语义', /** 语义与指示圆点决定用户能否看懂当前选中项。 */ () => {
  it('容器声明单选语义', /** 缺少 radiogroup 语义会让辅助技术读成普通容器。 */ async () => {
    const wrapper = mountRadioGroup();
    await nextTick();

    expect(wrapper.attributes('role')).toBe('radiogroup');
    expect(wrapper.classes()).toContain('grid');
    expect(wrapper.classes()).toContain('custom-group');
    expect(wrapper.findAll('.item-a')).toHaveLength(1);
    expect(wrapper.findAll('.item-b')).toHaveLength(1);
  });

  it('选中项渲染选中状态与指示圆点', /** 指示圆点缺失会让用户看不到当前选项。 */ async () => {
    const wrapper = mountRadioGroup();
    await nextTick();

    const checked = wrapper.find('.item-a');
    const unchecked = wrapper.find('.item-b');
    expect(checked.attributes('data-state')).toBe('checked');
    expect(checked.attributes('aria-checked')).toBe('true');
    expect(checked.classes()).toContain('rounded-full');
    expect(checked.find('svg').exists()).toBe(true);
    expect(unchecked.attributes('data-state')).toBe('unchecked');
    expect(unchecked.find('svg').exists()).toBe(false);
  });

  it('禁用项点击后不抛出选中值', /** 禁用态失效会让用户改动不该改的选项。 */ async () => {
    const values: unknown[] = [];
    const wrapper = mount(
      h(
        RadioGroup,
        {
          modelValue: 'a',
          /** 记录取值更新。 */
          'onUpdate:modelValue': (value: unknown) => {
            values.push(value);
          },
        },
        {
          /** 渲染一个禁用选项。 */
          default: () =>
            h(RadioGroupItem, {
              class: 'item-disabled',
              disabled: true,
              value: 'b',
            }),
        },
      ),
    );
    await nextTick();

    await wrapper.find('.item-disabled').trigger('click');
    await nextTick();

    expect(values).toEqual([]);
  });
});

describe('单选组选择绑定', /** 选择结果决定表单能否拿到用户意图。 */ () => {
  it('点击未选项抛出新的选中值', /** 不抛出会让选择结果停留在旧值。 */ async () => {
    const values: unknown[] = [];
    const wrapper = mountRadioGroup('a', values);
    await nextTick();

    await wrapper.find('.item-b').trigger('click');
    await nextTick();

    expect(values).toEqual(['b']);
  });
});
