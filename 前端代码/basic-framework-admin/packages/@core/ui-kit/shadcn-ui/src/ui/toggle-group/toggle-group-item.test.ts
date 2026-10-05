/**
 * 切换项（shadcn-ui 的 ui/toggle-group 的 ToggleGroupItem）尺寸继承与状态回归。
 *
 * 切换项是切换组里的按压按钮：它必须优先继承容器通过 provide 下发的 size/variant，容器未声明
 * 时才回落到自身属性，同时合并调用方 class、透传禁用态。继承或回落写错会让工具栏尺寸错乱或
 * 按钮失去禁用约束。用例真实挂载 reka-ui 的切换组与切换项，读取真实 DOM 属性与 class。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import ToggleGroup from './ToggleGroup.vue';
import ToggleGroupItem from './ToggleGroupItem.vue';

/**
 * 挂载带真实双向绑定的切换组与单个切换项。
 * @param itemProps 透传给切换项的属性，如尺寸、变体、禁用与 class。
 * @param groupProps 透传给切换组的属性，如尺寸与变体。
 * @returns 已挂载的切换组包装器。
 */
function mountItem(
  itemProps: Record<string, unknown> = {},
  groupProps: Record<string, unknown> = {},
) {
  return mount(
    h(
      ToggleGroup,
      { modelValue: 'a', type: 'single', ...groupProps },
      {
        /** 渲染一个带真实文案的切换项。 */
        default: () =>
          h(
            ToggleGroupItem,
            { class: 'item-a', value: 'a', ...itemProps },
            {
              /** 切换项文案。 */
              default: () => '选项一',
            },
          ),
      },
    ),
  );
}

describe('切换项尺寸与变体来源', /** 尺寸来源判定错误会让工具栏里的按钮大小不一致。 */ () => {
  it('容器声明尺寸时子项继承容器取值', /** 未继承会让紧凑工具栏里的按钮回落到默认高度。 */ async () => {
    const wrapper = mountItem({}, { size: 'sm', variant: 'outline' });
    await nextTick();

    const item = wrapper.find('.item-a');
    expect(item.classes()).toContain('h-8');
    expect(item.classes()).toContain('border-input');
  });

  it('容器未声明尺寸时回落到子项自身取值', /** 回落失效会让子项无法单独指定尺寸。 */ async () => {
    const wrapper = mountItem({ size: 'lg', variant: 'outline' });
    await nextTick();

    const item = wrapper.find('.item-a');
    expect(item.classes()).toContain('h-10');
    expect(item.classes()).toContain('border-input');
  });

  it('容器与子项都未声明时使用默认变体', /** 默认变体丢失会让按钮缺少基础尺寸与内边距。 */ async () => {
    const wrapper = mountItem();
    await nextTick();

    const item = wrapper.find('.item-a');
    expect(item.classes()).toContain('h-9');
    expect(item.classes()).toContain('bg-transparent');
  });
});

describe('切换项状态与调用方契约', /** 状态与禁用约束决定用户能否正确操作这个按钮。 */ () => {
  it('合并调用方 class 并渲染真实文案', /** class 覆盖失效会破坏业务自定义样式。 */ async () => {
    const wrapper = mountItem({ class: 'item-a custom-item' });
    await nextTick();

    const item = wrapper.find('.item-a');
    expect(item.classes()).toContain('inline-flex');
    expect(item.classes()).toContain('custom-item');
    expect(item.text()).toBe('选项一');
  });

  it('禁用态透传为原生禁用属性', /** 禁用态丢失会让用户改动不该改的选项。 */ async () => {
    const wrapper = mountItem({ disabled: true });
    await nextTick();

    const item = wrapper.find('.item-a');
    expect(item.attributes('disabled')).toBeDefined();
    expect(item.attributes('data-disabled')).toBe('');
  });

  it('选中项与未选中项的按压态相反', /** 按压态判定错误会让用户看不出当前选中项。 */ async () => {
    const wrapper = mountItem({ class: 'item-a' }, { modelValue: 'b' });
    await nextTick();

    expect(wrapper.find('.item-a').attributes('data-state')).toBe('off');
  });
});
