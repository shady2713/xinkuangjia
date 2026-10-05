/**
 * 页签工具栏全屏按钮（tabs-ui 的 widgets/tool-screen）状态与图标切换回归。
 *
 * 全屏按钮承担最大化与还原的切换：图标与真实状态不一致会让用户误判当前模式，双向绑定写错
 * 会让按钮点了毫无反应。用例用真实双向绑定挂载按钮，点击后断言真实图标与绑定值同步翻转。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { describe, expect, it } from 'vitest';

import ToolScreen from '../tool-screen.vue';

/**
 * 挂载带真实双向绑定的全屏按钮宿主。
 * @param initial 首屏传入的全屏状态。
 * @returns 已挂载的宿主包装器与状态读取函数。
 */
function mountScreen(initial: boolean) {
  const screen = ref(initial);
  const Host = defineComponent({
    name: 'ToolScreenHost',
    /**
     * 组装宿主：把真实全屏状态传给按钮，并接收按钮回写的状态。
     * @returns 渲染全屏按钮的渲染函数。
     */
    setup() {
      return /** 渲染带真实双向绑定的按钮，父级状态与按钮属性保持同步。 */ () =>
        h(ToolScreen, {
          /** 传入当前全屏状态，形成真实双向绑定。 */
          screen: screen.value,
          /** 回写全屏状态，驱动按钮重渲染。 */
          'onUpdate:screen': (value: boolean | undefined) => {
            screen.value = value ?? false;
          },
        });
    },
  });
  const wrapper = mount(Host);
  return {
    /** 读取宿主持有的真实全屏状态。 */
    read: () => screen.value,
    /** 已挂载的宿主包装器。 */
    wrapper,
  };
}

describe('页签全屏按钮', /** 图标与状态相反会让用户找不到退出或进入全屏的入口。 */ () => {
  it('未全屏时渲染进入全屏图标', /** 首屏图标读错会让按钮语义与真实状态相反。 */ () => {
    const { read, wrapper } = mountScreen(false);

    expect(wrapper.find('svg.lucide-fullscreen').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-minimize-2').exists()).toBe(false);
    expect(read()).toBe(false);
  });

  it('已全屏时渲染还原图标', /** 从全屏状态挂载时图标错位会让用户无法还原窗口。 */ () => {
    const { wrapper } = mountScreen(true);

    expect(wrapper.find('svg.lucide-minimize-2').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-fullscreen').exists()).toBe(false);
  });

  it('点击后状态翻转并同步图标', /** 双向绑定断裂会让按钮点击后毫无变化。 */ async () => {
    const { read, wrapper } = mountScreen(false);

    await wrapper.trigger('click');
    expect(read()).toBe(true);
    expect(wrapper.find('svg.lucide-minimize-2').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-fullscreen').exists()).toBe(false);

    await wrapper.trigger('click');
    expect(read()).toBe(false);
    expect(wrapper.find('svg.lucide-fullscreen').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-minimize-2').exists()).toBe(false);
  });
});
