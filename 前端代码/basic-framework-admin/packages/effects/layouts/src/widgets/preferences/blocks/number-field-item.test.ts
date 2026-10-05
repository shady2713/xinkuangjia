/**
 * 偏好设置数字输入项（preferences/blocks/number-field-item.vue）双向绑定回归。
 *
 * 该区块承载侧边栏宽度、标签页数量这类数值偏好：步进写回断开会让用户点加减号却没反应，提示文案
 * 渲染失效会让用户看不到取值范围说明。用例真实点击步进按钮、打开提示气泡并断言写回载荷。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import NumberFieldItem from './number-field-item.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载并清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 用真实双向绑定串起数字输入项。
 * @returns 数值本地状态与已挂载宿主。
 */
function mountNumberFieldItem() {
  const inputValue = ref(2);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的数字输入项。
       * @returns 渲染函数，返回绑定到本地状态的数字输入项。
       */
      setup() {
        return /** 返回绑定到本地状态的数字输入项。 */ () =>
          h(
            NumberFieldItem,
            {
              modelValue: inputValue.value,
              /** 写回新的数值。 */
              'onUpdate:modelValue': (value: number | undefined) => {
                inputValue.value = value ?? 2;
              },
            },
            {
              /** 渲染偏好项标题。 */
              default: () => 'DUMMY-标签页数量',
            },
          );
      },
    }),
  );
  mounted = wrapper;
  return { inputValue, wrapper };
}

describe('数字输入偏好项', /** 步进写回与提示决定数值类偏好能否被正确设置。 */ () => {
  it('未传提示与选项时渲染数值输入框', /** 默认值工厂缺失会让未配置的偏好项直接崩溃。 */ () => {
    const wrapper = mount(NumberFieldItem, {
      slots: { default: 'DUMMY-标签页数量' },
    });
    mounted = wrapper;

    const input = wrapper.find('input[role="spinbutton"]');
    expect(input.exists()).toBe(true);
    expect(wrapper.text()).toContain('DUMMY-标签页数量');
    expect(wrapper.find('.cursor-help').exists()).toBe(false);
  });

  it('提示文案按换行拆成多行说明', /** 多行提示挤成一行会让取值范围说明读不清。 */ async () => {
    const wrapper = mount(NumberFieldItem, {
      props: { tip: 'DUMMY-第一行说明\nDUMMY-第二行说明' },
      slots: { default: 'DUMMY-标签页数量' },
    });
    mounted = wrapper;

    const help = wrapper.find('.cursor-help');
    expect(help.exists()).toBe(true);
    await help.trigger('focus');
    await vi.waitFor(
      /** 等待提示内容真实传送挂载。 */ () => {
        expect(document.body.textContent).toContain('DUMMY-第一行说明');
      },
    );

    const lines = [...document.querySelectorAll('.side-content p')].map(
      /** 收集提示行文案用于核对换行拆分。 */ (line) => line.textContent,
    );
    expect(lines).toEqual(['DUMMY-第一行说明', 'DUMMY-第二行说明']);
  });

  it('提示插槽优先于提示文案', /** 插槽被文案覆盖会让业务无法自定义提示内容。 */ async () => {
    const wrapper = mount(NumberFieldItem, {
      slots: { default: 'DUMMY-标签页数量', tip: 'DUMMY-插槽提示' },
    });
    mounted = wrapper;

    await wrapper.find('.cursor-help').trigger('focus');
    await vi.waitFor(
      /** 等待提示内容真实传送挂载。 */ () => {
        expect(document.body.textContent).toContain('DUMMY-插槽提示');
      },
    );
  });

  it('点击加号与减号按步长写回新值', /** 步进写回断开会让用户点加减号却没有反应。 */ async () => {
    const { inputValue, wrapper } = mountNumberFieldItem();
    // 步进按钮的指针监听在挂载后一拍才绑到真实按钮上，先等待挂载完成。
    await nextTick();
    const increment = wrapper.find('[data-slot="increment"]');
    const decrement = wrapper.find('[data-slot="decrement"]');
    expect(increment.exists()).toBe(true);
    expect(decrement.exists()).toBe(true);

    // 步进按钮走真实指针链路：reka-ui 在 pointerdown 上开始步进、pointerup 上结束。
    await increment.trigger('pointerdown', { button: 0 });
    await increment.trigger('pointerup');
    await nextTick();
    expect(inputValue.value).toBe(3);

    await decrement.trigger('pointerdown', { button: 0 });
    await decrement.trigger('pointerup');
    await nextTick();
    expect(inputValue.value).toBe(2);
  });

  it('透传调用方属性到数值输入根节点', /** 属性未透传会让调用方无法限制取值范围。 */ () => {
    const wrapper = mount(NumberFieldItem, {
      props: { max: 3, min: 1, modelValue: 3 },
      slots: { default: 'DUMMY-标签页数量' },
    });
    mounted = wrapper;

    // 已到达上限时加号被禁用，说明 max 属性确实作用到了底层数字输入。
    expect(
      wrapper.find('[data-slot="increment"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.find('[data-slot="decrement"]').attributes('disabled'),
    ).toBeUndefined();
  });
});
