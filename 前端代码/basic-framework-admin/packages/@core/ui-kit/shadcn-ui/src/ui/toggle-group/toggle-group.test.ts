/**
 * 切换组容器（shadcn-ui 的 ui/toggle-group 的 ToggleGroup）语义与选择回归。
 *
 * 切换组用于主题模式、圆角大小这类紧凑的互斥选项：容器必须声明分组语义、把 size/variant 通过
 * provide 下发给子项、合并调用方 class，并在点击子项后抛出新的选中值。语义或绑定写错会让用户
 * 看不出当前选项，或让偏好设置无法回写。用例真实挂载 reka-ui 的切换组根节点，读取真实语义属性、
 * 子项状态与双向绑定事件。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import ToggleGroup from './ToggleGroup.vue';
import ToggleGroupItem from './ToggleGroupItem.vue';

/**
 * 挂载带真实双向绑定的切换组。
 * @param modelValue 当前选中值。
 * @param updates 记录选中值更新的数组。
 * @param groupProps 额外透传给切换组的属性，如尺寸与变体。
 * @returns 已挂载的切换组包装器。
 */
function mountGroup(
  modelValue = 'a',
  updates: unknown[] = [],
  groupProps: Record<string, unknown> = {},
) {
  return mount(
    h(
      ToggleGroup,
      {
        class: 'custom-group',
        modelValue,
        type: 'single',
        /** 记录取值更新，形成真实双向绑定。 */
        'onUpdate:modelValue': (value: unknown) => {
          updates.push(value);
        },
        ...groupProps,
      },
      {
        /** 渲染两个互斥选项。 */
        default: () =>
          ['a', 'b'].map(
            /** 按取值渲染切换项。 */ (value) =>
              h(
                ToggleGroupItem,
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

describe('切换组语义与结构', /** 分组语义与容器样式决定用户能否看懂这组按钮的用途。 */ () => {
  it('容器声明分组语义并合并调用方 class', /** 语义缺失会让辅助技术读成普通容器。 */ async () => {
    const wrapper = mountGroup();
    await nextTick();

    expect(wrapper.attributes('role')).toBe('group');
    expect(wrapper.classes()).toContain('flex');
    expect(wrapper.classes()).toContain('items-center');
    expect(wrapper.classes()).toContain('gap-1');
    expect(wrapper.classes()).toContain('custom-group');
    expect(wrapper.findAll('.item-a')).toHaveLength(1);
    expect(wrapper.findAll('.item-b')).toHaveLength(1);
  });

  it('按当前选中值标记按压态', /** 按压态标记错误会让用户看不出当前生效的选项。 */ async () => {
    const wrapper = mountGroup('a');
    await nextTick();

    expect(wrapper.find('.item-a').attributes('data-state')).toBe('on');
    expect(wrapper.find('.item-a').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.item-b').attributes('data-state')).toBe('off');
    expect(wrapper.find('.item-b').attributes('aria-pressed')).toBe('false');
  });

  it('子项文案通过插槽真实渲染', /** 插槽未渲染会让选项按钮变成空白方块。 */ async () => {
    const wrapper = mountGroup();
    await nextTick();

    expect(wrapper.find('.item-a').text()).toBe('选项一');
    expect(wrapper.find('.item-b').text()).toBe('选项二');
  });
});

describe('切换组尺寸与变体下发', /** size/variant 未下发会让子项样式与偏好设置不一致。 */ () => {
  it('容器尺寸与变体透传到未自报尺寸的子项', /** provide 断开会让子项回落到默认尺寸，破坏紧凑工具栏。 */ async () => {
    const wrapper = mountGroup('a', [], {
      size: 'sm',
      variant: 'outline',
    });
    await nextTick();

    expect(wrapper.find('.item-a').classes()).toContain('h-8');
    expect(wrapper.find('.item-a').classes()).toContain('border-input');
  });
});

describe('切换组选择绑定', /** 选择结果决定偏好设置能否回写到配置。 */ () => {
  it('点击未选项抛出新的选中值', /** 不抛出会让主题或圆角停留在旧值。 */ async () => {
    const updates: unknown[] = [];
    const wrapper = mountGroup('a', updates);
    await nextTick();

    await wrapper.find('.item-b').trigger('click');
    await nextTick();

    expect(updates).toEqual(['b']);
  });

  it('再次点击已选项抛出取消选中', /** 单选组允许取消选中，未抛出会让用户无法恢复默认外观。 */ async () => {
    const updates: unknown[] = [];
    const wrapper = mountGroup('a', updates);
    await nextTick();

    await wrapper.find('.item-a').trigger('click');
    await nextTick();

    expect(updates).toEqual([undefined]);
  });
});
