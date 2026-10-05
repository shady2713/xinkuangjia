/**
 * 偏好设置互斥切换项（preferences/blocks/toggle-item.vue）双向绑定回归。
 *
 * 该区块把选项渲染成一组互斥按钮：选项漏渲染会让用户无法选择，选中写回断开会让偏好停留在旧值，
 * 禁用态样式丢失会让用户以为还能继续切换。用例真实点击按钮并断言写回载荷与按下状态。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import ToggleItem from './toggle-item.vue';

/** 互斥选项夹具：三档取值用于核对渲染顺序与写回载荷。 */
const OPTIONS = [
  { label: 'DUMMY-自动', value: 'auto' },
  { label: 'DUMMY-顶部', value: 'header' },
  { label: 'DUMMY-固定', value: 'fixed' },
];

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

/**
 * 用真实双向绑定串起互斥切换项。
 * @returns 选中值本地状态与已挂载宿主。
 */
function mountToggleItem() {
  const modelValue = ref('auto');
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的互斥切换项。
       * @returns 渲染函数，返回绑定到本地状态的互斥切换项。
       */
      setup() {
        return /** 返回绑定到本地状态的互斥切换项。 */ () =>
          h(
            ToggleItem,
            {
              items: OPTIONS,
              modelValue: modelValue.value,
              /** 写回新的选中值。 */
              'onUpdate:modelValue': (value: string | undefined) => {
                modelValue.value = value ?? 'auto';
              },
            },
            {
              /** 渲染选项组标题。 */
              default: () => 'DUMMY-偏好说明',
            },
          );
      },
    }),
  );
  mounted = wrapper;
  return { modelValue, wrapper };
}

describe('互斥切换项', /** 选项渲染与选中写回决定用户能否切换偏好。 */ () => {
  it('渲染选项文案与选中项标题', /** 文案缺失会让用户不知道这些按钮在切换什么。 */ () => {
    const { wrapper } = mountToggleItem();
    const buttons = wrapper.findAll('button');

    expect(wrapper.text()).toContain('DUMMY-偏好说明');
    expect(
      buttons.map(
        /** 收集按钮文案用于核对选项顺序。 */ (button) => button.text(),
      ),
    ).toEqual(['DUMMY-自动', 'DUMMY-顶部', 'DUMMY-固定']);
    expect(buttons[0]?.attributes('data-state')).toBe('on');
    expect(buttons[1]?.attributes('data-state')).toBe('off');
  });

  it('未传选项时渲染空选项组而不是报错', /** 默认选项工厂缺失会让未配置的偏好项直接崩溃。 */ () => {
    const wrapper = mount(ToggleItem, { slots: { default: 'DUMMY-偏好说明' } });
    mounted = wrapper;

    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(wrapper.text()).toContain('DUMMY-偏好说明');
  });

  it('点击其他选项写回新的取值', /** 写回断开会让用户点击后偏好仍停留在旧值。 */ async () => {
    const { modelValue, wrapper } = mountToggleItem();
    const buttons = wrapper.findAll('button');

    await buttons[2]?.trigger('click');

    expect(modelValue.value).toBe('fixed');
    expect(buttons[2]?.attributes('data-state')).toBe('on');
    expect(buttons[0]?.attributes('data-state')).toBe('off');
  });

  it('禁用时渲染不可交互样式', /** 禁用样式丢失会让用户以为还能继续切换。 */ () => {
    const wrapper = mount(ToggleItem, {
      props: { disabled: true, items: OPTIONS },
      slots: { default: 'DUMMY-偏好说明' },
    });
    mounted = wrapper;

    expect(wrapper.classes()).toContain('pointer-events-none');
    expect(wrapper.classes()).toContain('opacity-50');
    expect(wrapper.attributes('disabled')).toBeDefined();
  });
});
