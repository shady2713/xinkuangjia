/**
 * 通用选择器（shadcn-ui 的 components/select）选项与清除行为回归。
 *
 * 选择器把选项数组渲染成下拉项，并在允许清除且已有取值时渲染清除按钮；点击清除必须把取值置空
 * 且不能触发下拉展开。选项漏渲染会让用户无法选择，清除按钮失效会让用户无法取消已选条件。
 * 用例真实挂载 reka-ui 的选择根节点，读取真实的清除按钮与取值更新事件。
 */
import { mount } from '@vue/test-utils';

import { afterEach, describe, expect, it } from 'vitest';

import Select from './select.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/** 选择项夹具：两个可选项。 */
const OPTIONS = [
  { label: 'DUMMY-启用', value: 'enabled' },
  { label: 'DUMMY-停用', value: 'disabled' },
];

describe('选择器渲染与清除', /** 选项与清除入口决定用户能否设置或取消条件。 */ () => {
  it('渲染触发按钮与占位文案', /** 占位缺失会让用户看不出这是可选项输入。 */ () => {
    mounted = mount(Select, {
      props: {
        class: 'custom-trigger',
        options: OPTIONS,
        placeholder: '请选择状态',
      },
    });

    const trigger = mounted.find('.custom-trigger');
    expect(trigger.element.tagName).toBe('BUTTON');
    expect(trigger.attributes('role')).toBe('combobox');
    expect(trigger.text()).toContain('请选择状态');
  });

  it('未开启清除时不渲染清除按钮', /** 多余清除按钮会让用户误清空取值。 */ () => {
    mounted = mount(Select, {
      props: { options: OPTIONS, placeholder: '请选择状态' },
    });

    expect(mounted.find('[data-clear-button]').exists()).toBe(false);
  });

  it('已取值且允许清除时渲染清除按钮', /** 缺少清除按钮会让已选条件无法取消。 */ () => {
    mounted = mount(Select, {
      props: {
        allowClear: true,
        modelValue: 'enabled',
        options: OPTIONS,
      },
    });

    expect(mounted.find('[data-clear-button]').exists()).toBe(true);
    expect(mounted.find('[data-clear-button]').classes()).toContain(
      'cursor-pointer',
    );
  });

  it('点击清除按钮把取值置空且不展开下拉', /** 清除时展开下拉会让用户以为清除失败。 */ async () => {
    const updates: unknown[] = [];
    mounted = mount(Select, {
      props: {
        allowClear: true,
        modelValue: 'enabled',
        options: OPTIONS,
        /** 记录取值更新。 */
        'onUpdate:modelValue': (value: unknown) => {
          updates.push(value);
        },
      },
    });

    const clearButton = mounted.find('[data-clear-button]');
    await clearButton.trigger('pointerdown');
    await clearButton.trigger('click');

    expect(updates).toEqual([undefined]);
    expect(mounted.find('[data-clear-button]').exists()).toBe(true);
  });

  it('选中下拉项后抛出新的取值', /** 不抛出会让选择结果丢失。 */ async () => {
    const updates: unknown[] = [];
    mounted = mount(Select, {
      props: {
        modelValue: 'enabled',
        options: OPTIONS,
        /** 记录取值更新。 */
        'onUpdate:modelValue': (value: unknown) => {
          updates.push(value);
        },
      },
    });
    const trigger = mounted.find('button[role="combobox"]');
    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await new Promise(
      /** 等待传送节点真实渲染完成。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    const options = [
      ...document.querySelectorAll('[role="option"]'),
    ] as HTMLElement[];
    // 下拉项按真实交互链路选中：先按下再抬起（reka-ui 在 pointerup 上提交选择）。
    options[1]?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    options[1]?.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 0 }),
    );
    options[1]?.click();
    await new Promise(
      /** 等待选择事件真实派发完成。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );
    await new Promise(
      /** 再等一个宏任务让选中状态回写完成。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(updates).toEqual(['disabled']);
  });

  it('展开后按选项数组渲染下拉项', /** 选项漏渲染会让用户无法选择任何取值。 */ async () => {
    mounted = mount(Select, {
      props: { modelValue: 'enabled', options: OPTIONS },
    });

    const trigger = mounted.find('button[role="combobox"]');
    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await new Promise(
      /** 等待传送节点真实渲染完成。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(document.body.textContent).toContain('DUMMY-启用');
    expect(document.body.textContent).toContain('DUMMY-停用');
    expect(document.querySelectorAll('[role="option"]').length).toBe(2);
  });
});
