/**
 * 偏好设置开关行（preferences/blocks/switch-item.vue）真实交互回归。
 *
 * 开关行是所有布尔偏好的公共载体：点击整行必须写回取反后的值，行内开关按钮必须自己完成一次
 * 写回且不冒泡触发整行（否则一次点击翻转两次回到原值），带快捷键提示的行必须渲染出提示区供
 * 用户看到按键；这些都决定偏好面板上的开关是否可信。用例真实点击整行与行内开关按钮，
 * 断言写回载荷、快捷键提示区、提示气泡与禁用样式。
 */
import { mount } from '@vue/test-utils';
import { h, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import SwitchItem from './switch-item.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理提示气泡的传送节点。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

describe('偏好设置开关行', /** 整行与行内开关的写回方向决定布尔偏好能否被正确切换。 */ () => {
  it('点击整行写回取反后的值', /** 取反写错会让开关越点越回到原状态。 */ async () => {
    const checked = ref(false);
    const wrapper = mount(SwitchItem, {
      props: {
        modelValue: checked.value,
        /** 写回开关取值。 */
        'onUpdate:modelValue': (value: boolean | undefined) => {
          checked.value = value ?? false;
        },
      },
    });
    mounted = wrapper;

    await wrapper.trigger('click');

    expect(checked.value).toBe(true);
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
  });

  it('未传初始值时点击整行写回明确的 true', /** 把 undefined 取反会让写回值变成 truthy 的怪值。 */ async () => {
    const wrapper = mount(SwitchItem);
    mounted = wrapper;

    await wrapper.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
  });

  it('渲染快捷键提示区并支持直接点击行内开关按钮', /** 提示区缺失会让用户看不到快捷键，行内按钮写回断开会让开关按钮点了没反应。 */ async () => {
    const checked = ref(false);
    const wrapper = mount(SwitchItem, {
      props: {
        modelValue: checked.value,
        /** 写回行内开关按钮的取值。 */
        'onUpdate:modelValue': (value: boolean | undefined) => {
          checked.value = value ?? false;
        },
      },
      slots: {
        /** 默认插槽：开关文案。 */
        default: () => '全局搜索',
        /** 快捷键插槽：展示真实按键提示。 */
        shortcut: () => h('kbd', 'K'),
      },
    });
    mounted = wrapper;

    const shortcut = wrapper.get('.ml-auto');
    expect(shortcut.text()).toContain('K');
    expect(shortcut.find('kbd').exists()).toBe(true);

    await wrapper.get('button[role="switch"]').trigger('click');

    expect(checked.value).toBe(true);
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
  });

  it('多行提示按换行拆成多段文案', /** 提示不拆行会让长说明挤成一行难以阅读。 */ async () => {
    const wrapper = mount(SwitchItem, {
      props: { modelValue: false, tip: '第一行说明\n第二行说明' },
    });
    mounted = wrapper;

    expect(wrapper.find('.cursor-help').exists()).toBe(true);
    await wrapper.get('.cursor-help').trigger('pointermove');

    await vi.waitFor(
      /** 等待提示面板真实渲染出拆行后的说明。 */ () => {
        expect(document.body.textContent).toContain('第一行说明');
        expect(document.body.textContent).toContain('第二行说明');
      },
      { timeout: 2000 },
    );
  });

  it('禁用时整行置灰不可交互', /** 禁用样式丢失会让用户改动注定不生效的偏好。 */ () => {
    const wrapper = mount(SwitchItem, {
      props: { disabled: true, modelValue: false },
    });
    mounted = wrapper;

    expect(wrapper.classes()).toContain('pointer-events-none');
    expect(wrapper.classes()).toContain('opacity-50');
    expect(wrapper.attributes('class')).toContain('hover:bg-accent');
  });

  it('未禁用时不带禁用样式', /** 负对照：禁用样式不能误加到可用开关行上。 */ () => {
    const wrapper = mount(SwitchItem, { props: { modelValue: false } });
    mounted = wrapper;

    expect(wrapper.classes()).not.toContain('pointer-events-none');
    expect(wrapper.classes()).not.toContain('opacity-50');
    expect(wrapper.find('.cursor-help').exists()).toBe(false);
  });
});
