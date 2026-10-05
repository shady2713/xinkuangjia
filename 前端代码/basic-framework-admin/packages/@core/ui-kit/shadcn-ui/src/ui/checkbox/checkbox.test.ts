/**
 * 复选框（shadcn-ui 的 ui/checkbox）状态与图标回归。
 *
 * 复选框用于多选与半选（表头全选）：勾选与未勾选必须映射到不同状态属性，半选必须换成减号
 * 图标，否则用户会把「部分选中」误读成「全部未选」。用例真实挂载 reka-ui 的复选框根节点，
 * 读取真实的 aria 属性与默认插槽图标。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Checkbox from './Checkbox.vue';

describe('复选框状态', /** 状态与图标错误会让用户误判勾选结果。 */ () => {
  it('未勾选时状态为 unchecked', /** 未勾选却显示勾选图标会让用户以为已经选中。 */ () => {
    const wrapper = mount(Checkbox, { props: { modelValue: false } });

    expect(wrapper.attributes('role')).toBe('checkbox');
    expect(wrapper.attributes('data-state')).toBe('unchecked');
    expect(wrapper.classes()).toContain('data-[state=checked]:bg-primary');
  });

  it('勾选时状态为 checked 并渲染勾号', /** 勾选态缺少图标会让用户无法确认选择。 */ () => {
    const wrapper = mount(Checkbox, { props: { modelValue: true } });

    expect(wrapper.attributes('data-state')).toBe('checked');
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('半选时状态为 indeterminate 并渲染减号图标', /** 半选仍显示勾号会让用户以为整组已全部选中。 */ () => {
    const wrapper = mount(Checkbox, {
      props: { indeterminate: true, modelValue: 'indeterminate' },
    });

    expect(wrapper.attributes('data-state')).toBe('indeterminate');
    expect(wrapper.html()).toContain('lucide-minus');
  });

  it('点击时抛出取反后的值', /** 不抛出新值会让多选状态无法更新。 */ () => {
    const wrapper = mount(Checkbox, {
      props: {
        modelValue: false,
        /** 忽略取值更新，仅用于驱动双向绑定。 */
        'onUpdate:modelValue': () => {},
      },
    });

    wrapper.trigger('click');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('调用方可覆盖默认图标', /** 无法覆盖会让特殊场景缺少自定义标记。 */ () => {
    const wrapper = mount(Checkbox, {
      props: { modelValue: true },
      slots: { default: '<i class="custom-icon"></i>' },
    });

    expect(wrapper.find('.custom-icon').exists()).toBe(true);
  });
});
