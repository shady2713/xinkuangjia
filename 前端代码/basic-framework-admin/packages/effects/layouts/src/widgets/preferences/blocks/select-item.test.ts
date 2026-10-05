/**
 * 偏好设置下拉选择项（preferences/blocks/select-item.vue）交互回归。
 *
 * 该区块把选项数组渲染成下拉面板：选项漏渲染会让用户无法选择，选中写回断开会让偏好停留在旧值，
 * 提示插槽失效会让用户看不到配置说明。用例真实展开下拉、选中下拉项并打开提示气泡。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import SelectItem from './select-item.vue';

/** 下拉选项夹具：三项用于核对渲染顺序与写回载荷。 */
const OPTIONS = [
  { label: 'DUMMY-自动', value: 'auto' },
  { label: 'DUMMY-顶部', value: 'header' },
  { label: 'DUMMY-固定', value: 'fixed' },
];

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
 * 用真实双向绑定串起下拉选择项。
 * @param initialValue 宿主传入的初始选中值，留空表示尚未选择。
 * @returns 选中值本地状态与已挂载宿主。
 */
function mountSelectItem(initialValue = 'auto') {
  const selectValue = ref(initialValue);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的下拉选择项。
       * @returns 渲染函数，返回绑定到本地状态的下拉选择项。
       */
      setup() {
        return /** 返回绑定到本地状态的下拉选择项。 */ () =>
          h(
            SelectItem,
            {
              items: OPTIONS,
              modelValue: selectValue.value,
              placeholder: 'DUMMY-请选择位置',
              /** 写回新的选中值。 */
              'onUpdate:modelValue': (value: string | undefined) => {
                selectValue.value = value ?? 'auto';
              },
            },
            {
              /** 渲染偏好项标题。 */
              default: () => 'DUMMY-按钮位置',
            },
          );
      },
    }),
  );
  mounted = wrapper;
  return { selectValue, wrapper };
}

describe('下拉选择项', /** 选项渲染与选中写回决定偏好能否被设置。 */ () => {
  it('渲染标题与未选择时的占位文案', /** 占位缺失会让用户看不出这里是可选项输入。 */ () => {
    const { wrapper } = mountSelectItem('');

    expect(wrapper.text()).toContain('DUMMY-按钮位置');
    const trigger = wrapper.find('button[role="combobox"]');
    // reka-ui 只有在选项注册后才回显文案，未选择时展示占位提示。
    expect(trigger.text()).toContain('DUMMY-请选择位置');
    expect(trigger.attributes('data-placeholder')).toBe('');
    // 没有提示插槽时整行保留悬停底色，方便用户识别可点击区域。
    expect(wrapper.classes()).toContain('hover:bg-accent');
  });

  it('未传选项时渲染占位文案且无下拉项', /** 默认选项工厂缺失会让未配置的偏好项直接崩溃。 */ () => {
    const wrapper = mount(SelectItem, {
      props: { placeholder: 'DUMMY-请选择位置' },
      slots: { default: 'DUMMY-按钮位置' },
    });
    mounted = wrapper;

    const trigger = wrapper.find('button[role="combobox"]');
    expect(trigger.text()).toContain('DUMMY-请选择位置');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it('展开下拉后按选项数组渲染下拉项并选中', /** 选项漏渲染或写回断开会让用户的选择丢失。 */ async () => {
    const { selectValue, wrapper } = mountSelectItem();
    const trigger = wrapper.find('button[role="combobox"]');

    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await vi.waitFor(
      /** 等待下拉面板真实渲染出全部选项。 */ () => {
        expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
      },
    );

    const options = [
      ...document.querySelectorAll('[role="option"]'),
    ] as HTMLElement[];
    expect(
      options.map(
        /** 收集下拉项文案用于核对选项顺序。 */ (item) => item.textContent,
      ),
    ).toEqual(['DUMMY-自动', 'DUMMY-顶部', 'DUMMY-固定']);

    // 下拉项走真实指针链路提交选择：reka-ui 在 pointerup 上写回取值。
    options[2]?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    options[2]?.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 0 }),
    );
    options[2]?.click();
    await vi.waitFor(
      /** 等待选中结果写回宿主状态。 */ () => {
        expect(selectValue.value).toBe('fixed');
      },
    );

    expect(trigger.text()).toContain('DUMMY-固定');
  });

  it('提供提示插槽时打开气泡显示说明', /** 提示失效会让用户看不到配置项含义。 */ async () => {
    const wrapper = mount(SelectItem, {
      props: { items: OPTIONS, placeholder: 'DUMMY-请选择位置' },
      slots: { default: 'DUMMY-按钮位置', tip: 'DUMMY-提示文案' },
    });
    mounted = wrapper;

    // 有提示时整行不再整块高亮，避免与提示图标争抢悬停反馈。
    expect(wrapper.classes()).not.toContain('hover:bg-accent');
    const help = wrapper.find('.cursor-help');
    expect(help.exists()).toBe(true);

    await help.trigger('focus');
    await vi.waitFor(
      /** 等待提示内容真实传送挂载。 */ () => {
        expect(document.body.textContent).toContain('DUMMY-提示文案');
      },
    );
  });

  it('禁用时渲染不可交互样式', /** 禁用样式丢失会让用户以为还能继续切换。 */ () => {
    const wrapper = mount(SelectItem, {
      props: { disabled: true, items: OPTIONS },
      slots: { default: 'DUMMY-按钮位置' },
    });
    mounted = wrapper;

    expect(wrapper.classes()).toContain('pointer-events-none');
    expect(wrapper.classes()).toContain('opacity-50');
    // 无提示插槽时仍保留悬停底色，禁用只靠指针事件样式拦截。
    expect(wrapper.classes()).toContain('hover:bg-accent');
  });
});
