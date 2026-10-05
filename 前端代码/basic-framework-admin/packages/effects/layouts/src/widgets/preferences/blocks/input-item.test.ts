/**
 * 偏好设置文本输入项（preferences/blocks/input-item.vue）双向绑定回归。
 *
 * 该区块承载水印文案这类自由文本：输入写回断开会让用户改了文案却不生效，清除按钮失效会让用户
 * 无法一键清空已填内容。用例真实输入文本、点击清除图标并打开提示气泡。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import InputItem from './input-item.vue';

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
 * 用真实双向绑定串起文本输入项。
 * @returns 输入值本地状态与已挂载宿主。
 */
function mountInputItem() {
  const inputValue = ref('');
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的文本输入项。
       * @returns 渲染函数，返回绑定到本地状态的文本输入项。
       */
      setup() {
        return /** 返回绑定到本地状态的文本输入项。 */ () =>
          h(
            InputItem,
            {
              modelValue: inputValue.value,
              placeholder: 'DUMMY-请输入水印文案',
              /** 写回新的输入值。 */
              'onUpdate:modelValue': (value: string | undefined) => {
                inputValue.value = value ?? '';
              },
            },
            {
              /** 渲染偏好项标题。 */
              default: () => 'DUMMY-水印文案',
            },
          );
      },
    }),
  );
  mounted = wrapper;
  return { inputValue, wrapper };
}

describe('文本输入偏好项', /** 输入写回与清除入口决定水印文案能否被设置。 */ () => {
  it('未传值与选项时渲染空输入框', /** 默认值工厂缺失会让未配置的偏好项直接崩溃。 */ () => {
    const wrapper = mount(InputItem, { slots: { default: 'DUMMY-水印文案' } });
    mounted = wrapper;

    const input = wrapper.find('input');
    expect(input.attributes('placeholder')).toBe('');
    expect((input.element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('.lucide-circle-x').exists()).toBe(false);
    // 没有提示插槽时整行保留悬停底色，方便用户识别可点击区域。
    expect(wrapper.classes()).toContain('hover:bg-accent');
  });

  it('输入文本时写回真实载荷并显示清除图标', /** 写回断开会让用户填的水印文案被丢弃。 */ async () => {
    const { inputValue, wrapper } = mountInputItem();
    const input = wrapper.find('input');

    expect(input.attributes('placeholder')).toBe('DUMMY-请输入水印文案');
    await input.setValue('DUMMY-内部系统');

    expect(inputValue.value).toBe('DUMMY-内部系统');
    expect(wrapper.find('.lucide-circle-x').exists()).toBe(true);
  });

  it('点击清除图标把取值置空', /** 清除按钮失效会让用户无法一键清空已填文案。 */ async () => {
    const { inputValue, wrapper } = mountInputItem();

    await wrapper.find('input').setValue('DUMMY-内部系统');
    expect(inputValue.value).toBe('DUMMY-内部系统');

    await wrapper.find('.lucide-circle-x').trigger('click');

    expect(inputValue.value).toBe('');
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('.lucide-circle-x').exists()).toBe(false);
  });

  it('提供提示插槽时打开气泡显示说明', /** 提示失效会让用户看不到配置项含义。 */ async () => {
    const wrapper = mount(InputItem, {
      slots: { default: 'DUMMY-水印文案', tip: 'DUMMY-提示文案' },
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

  it('禁用时渲染不可交互样式', /** 禁用样式丢失会让用户以为还能编辑文案。 */ () => {
    const wrapper = mount(InputItem, {
      props: { disabled: true },
      slots: { default: 'DUMMY-水印文案' },
    });
    mounted = wrapper;

    expect(wrapper.classes()).toContain('pointer-events-none');
    expect(wrapper.classes()).toContain('opacity-50');
  });
});
