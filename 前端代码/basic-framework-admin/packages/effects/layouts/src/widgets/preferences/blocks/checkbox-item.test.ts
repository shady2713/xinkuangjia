/**
 * 偏好设置多选按钮组（preferences/blocks/checkbox-item.vue）双向绑定回归。
 *
 * 该区块把选项渲染成可多选的按钮组：选项漏渲染会让用户无法选择，多选写回断开会让勾选丢失，
 * 按钮回调未透传会让业务拿不到点击事件。用例真实点击按钮并断言写回载荷、勾选态与回调载荷。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import CheckboxItem from './checkbox-item.vue';

/** 多选选项夹具：三项用于核对渲染顺序与写回载荷。 */
const OPTIONS = [
  { label: 'DUMMY-搜索', value: 'search' },
  { label: 'DUMMY-通知', value: 'notice' },
  { label: 'DUMMY-全屏', value: 'fullscreen' },
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
 * 用真实双向绑定串起多选按钮组，并记录按钮回调载荷。
 * @returns 选中值本地状态、按钮回调载荷与已挂载宿主。
 */
function mountCheckboxItem() {
  const inputValue = ref<string[]>([]);
  const clicked: string[] = [];
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的多选按钮组。
       * @returns 渲染函数，返回绑定到本地状态的多选按钮组。
       */
      setup() {
        return /** 返回绑定到本地状态的多选按钮组。 */ () =>
          h(
            CheckboxItem,
            {
              items: OPTIONS,
              multiple: true,
              modelValue: inputValue.value,
              /** 记录按钮点击回调载荷。 */
              onBtnClick: (value: string) => {
                clicked.push(value);
              },
              /** 写回新的选中值集合。 */
              'onUpdate:modelValue': (value: string[] | undefined) => {
                inputValue.value = value ?? [];
              },
            },
            {
              /** 渲染偏好项标题。 */
              default: () => 'DUMMY-界面元素',
            },
          );
      },
    }),
  );
  mounted = wrapper;
  return { clicked, inputValue, wrapper };
}

describe('多选按钮组偏好项', /** 选项渲染、多选写回与回调决定界面元素配置是否可用。 */ () => {
  it('未传选项与回调时渲染空按钮组', /** 默认值工厂缺失会让未配置的偏好项直接崩溃。 */ () => {
    const wrapper = mount(CheckboxItem, {
      slots: { default: 'DUMMY-界面元素' },
    });
    mounted = wrapper;

    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(wrapper.text()).toContain('DUMMY-界面元素');
    // 没有提示插槽时整行保留悬停底色，方便用户识别可点击区域。
    expect(wrapper.classes()).toContain('hover:bg-accent');
  });

  it('未传按钮回调时点击选项仍然写回取值', /** 默认回调缺失会让未接回调的调用方点击即报错。 */ async () => {
    const wrapper = mount(CheckboxItem, {
      props: { items: OPTIONS },
      slots: { default: 'DUMMY-界面元素' },
    });
    mounted = wrapper;

    await wrapper.findAll('button')[0]?.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['search']]);
  });

  it('多选时逐次点击累加选中值', /** 多选写回退化成单选会让用户只能保留一个界面元素。 */ async () => {
    const { clicked, inputValue, wrapper } = mountCheckboxItem();
    const buttons = wrapper.findAll('button');

    await buttons[0]?.trigger('click');
    expect(inputValue.value).toEqual(['search']);
    expect(clicked).toEqual(['search']);
    expect(buttons[0]?.classes()).toContain('bg-primary');
    expect(buttons[0]?.find('.lucide-circle-check-big').exists()).toBe(true);

    await buttons[1]?.trigger('click');
    expect(inputValue.value).toEqual(['search', 'notice']);
    expect(clicked).toEqual(['search', 'notice']);
    expect(buttons[1]?.classes()).toContain('bg-primary');
    expect(buttons[2]?.classes()).toContain('bg-background');
  });

  it('再次点击已选项可取消选中', /** 不能取消会让用户无法撤销已选界面元素。 */ async () => {
    const { inputValue, wrapper } = mountCheckboxItem();
    const buttons = wrapper.findAll('button');

    await buttons[0]?.trigger('click');
    await buttons[0]?.trigger('click');

    expect(inputValue.value).toEqual([]);
    expect(buttons[0]?.classes()).toContain('bg-background');
  });

  it('禁用时按钮不可点击', /** 禁用失效会让用户改动不该改的界面元素。 */ async () => {
    const wrapper = mount(CheckboxItem, {
      props: { disabled: true, items: OPTIONS, multiple: true },
      slots: { default: 'DUMMY-界面元素' },
    });
    mounted = wrapper;

    expect(wrapper.classes()).toContain('pointer-events-none');
    expect(wrapper.classes()).toContain('opacity-50');
    expect(wrapper.findAll('button')[0]?.attributes('disabled')).toBeDefined();
    await wrapper.findAll('button')[0]?.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('提供提示插槽时打开气泡显示说明', /** 提示失效会让用户看不到配置项含义。 */ async () => {
    const wrapper = mount(CheckboxItem, {
      props: { items: OPTIONS },
      slots: { default: 'DUMMY-界面元素', tip: 'DUMMY-提示文案' },
    });
    mounted = wrapper;

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
});
