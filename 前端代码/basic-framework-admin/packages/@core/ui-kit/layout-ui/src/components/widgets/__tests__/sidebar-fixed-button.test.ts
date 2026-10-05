/**
 * 侧边栏固定按钮（layout-ui 的 widgets/sidebar-fixed-button）状态与图标切换回归。
 *
 * 固定按钮决定鼠标悬停是否自动展开侧栏：图钉状态与绑定值不一致会让用户以为已经固定，
 * 双向绑定写错会让悬停展开策略无法切换。用例用真实双向绑定挂载按钮并派发真实点击。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { describe, expect, it } from 'vitest';

import SidebarFixedButton from '../sidebar-fixed-button.vue';

/**
 * 挂载带真实双向绑定的固定按钮宿主。
 * @param initial 首屏传入的悬停展开状态。
 * @returns 已挂载的宿主包装器与状态读取函数。
 */
function mountFixedButton(initial: boolean) {
  const expandOnHover = ref(initial);
  const Host = defineComponent({
    name: 'SidebarFixedButtonHost',
    /**
     * 组装宿主：把真实悬停展开状态传给按钮，并接收按钮回写的状态。
     * @returns 渲染固定按钮的渲染函数。
     */
    setup() {
      return /** 渲染带真实双向绑定的按钮，父级状态与按钮属性保持同步。 */ () =>
        h(SidebarFixedButton, {
          /** 固定的选择器类名，供用例精确定位按钮本体。 */
          class: 'fixed-button',
          /** 传入当前悬停展开状态，形成真实双向绑定。 */
          expandOnHover: expandOnHover.value,
          /** 回写悬停展开状态，驱动按钮重渲染。 */
          'onUpdate:expandOnHover': (value: boolean | undefined) => {
            expandOnHover.value = value ?? false;
          },
        });
    },
  });
  const wrapper = mount(Host);
  return {
    /** 读取宿主持有的真实悬停展开状态。 */
    read: () => expandOnHover.value,
    /** 已挂载的宿主包装器。 */
    wrapper,
  };
}

describe('侧边栏固定按钮', /** 图钉状态读错会让用户误判悬停是否会自动展开侧栏。 */ () => {
  it('未开启悬停展开时渲染取消固定图标', /** 初始图标读错会让按钮与真实策略相反。 */ () => {
    const { read, wrapper } = mountFixedButton(false);

    expect(wrapper.find('svg.lucide-pin-off').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-pin').exists()).toBe(false);
    expect(read()).toBe(false);
  });

  it('点击后状态翻转并切换为固定图标', /** 双向绑定断裂会让悬停展开策略无法切换。 */ async () => {
    const { read, wrapper } = mountFixedButton(false);

    await wrapper.find('.fixed-button').trigger('click');

    expect(read()).toBe(true);
    expect(wrapper.find('svg.lucide-pin').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-pin-off').exists()).toBe(false);
  });

  it('已固定时点击恢复为取消固定', /** 无法取消固定会让侧栏一直处于悬停展开状态。 */ async () => {
    const { read, wrapper } = mountFixedButton(true);

    expect(wrapper.find('svg.lucide-pin').exists()).toBe(true);

    await wrapper.find('.fixed-button').trigger('click');

    expect(read()).toBe(false);
    expect(wrapper.find('svg.lucide-pin-off').exists()).toBe(true);
  });
});
