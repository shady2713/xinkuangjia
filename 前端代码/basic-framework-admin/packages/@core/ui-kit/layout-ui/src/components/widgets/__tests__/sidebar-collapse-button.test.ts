/**
 * 侧边栏折叠按钮（layout-ui 的 widgets/sidebar-collapse-button）状态与冒泡回归。
 *
 * 折叠按钮负责侧边导航的收起与展开：图标与折叠状态不一致会让用户点错方向，点击冒泡到侧栏
 * 容器会让侧栏自身的交互被误触发。用例用真实双向绑定挂载按钮，点击后断言绑定值、真实图标
 * 同步翻转，且外层父节点的点击监听不被触发。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import SidebarCollapseButton from '../sidebar-collapse-button.vue';

/**
 * 挂载带真实双向绑定的折叠按钮宿主，并用父节点监听按钮点击是否冒泡。
 * @param initial 首屏传入的折叠状态。
 * @returns 已挂载的宿主包装器、状态读取函数与父节点点击记录。
 */
function mountCollapseButton(initial: boolean) {
  const collapsed = ref(initial);
  /** 记录外层父节点收到的点击次数，用于验证按钮点击不冒泡。 */
  const parentClick = vi.fn();
  const Host = defineComponent({
    name: 'SidebarCollapseButtonHost',
    /**
     * 组装宿主：把真实折叠状态传给按钮，并接收按钮回写的状态。
     * @returns 渲染父节点与折叠按钮的渲染函数。
     */
    setup() {
      return /** 渲染父节点包裹的按钮，父节点监听用于验证点击不冒泡。 */ () =>
        h('div', { class: 'parent', onClick: parentClick }, [
          h(SidebarCollapseButton, {
            /** 固定的选择器类名，供用例精确定位按钮本体。 */
            class: 'collapse-button',
            /** 传入当前折叠状态，形成真实双向绑定。 */
            collapsed: collapsed.value,
            /** 回写折叠状态，驱动按钮重渲染。 */
            'onUpdate:collapsed': (value: boolean | undefined) => {
              collapsed.value = value ?? false;
            },
          }),
        ]);
    },
  });
  const wrapper = mount(Host);
  return {
    /** 父节点点击记录，用于断言点击没有冒泡。 */
    parentClick,
    /** 读取宿主持有的真实折叠状态。 */
    read: () => collapsed.value,
    /** 已挂载的宿主包装器。 */
    wrapper,
  };
}

describe('侧边栏折叠按钮', /** 方向图标与折叠状态相反会让用户误判侧栏将如何变化。 */ () => {
  it('展开态渲染收起方向图标并在点击后折叠', /** 状态与图标不同步会让按钮看起来没有生效。 */ async () => {
    const { read, wrapper } = mountCollapseButton(false);

    expect(wrapper.find('svg.lucide-chevrons-left').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-chevrons-right').exists()).toBe(false);

    await wrapper.find('.collapse-button').trigger('click');

    expect(read()).toBe(true);
    expect(wrapper.find('svg.lucide-chevrons-right').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-chevrons-left').exists()).toBe(false);
  });

  it('折叠态渲染展开方向图标并在点击后展开', /** 从折叠态进入时图标错位会让用户找不到展开入口。 */ async () => {
    const { read, wrapper } = mountCollapseButton(true);

    expect(wrapper.find('svg.lucide-chevrons-right').exists()).toBe(true);

    await wrapper.find('.collapse-button').trigger('click');

    expect(read()).toBe(false);
    expect(wrapper.find('svg.lucide-chevrons-left').exists()).toBe(true);
  });

  it('点击不冒泡到外层父节点', /** 冒泡会让侧栏容器的点击逻辑被误触发。 */ async () => {
    const { parentClick, wrapper } = mountCollapseButton(false);

    await wrapper.find('.collapse-button').trigger('click');

    expect(wrapper.find('.parent').exists()).toBe(true);
    expect(parentClick).not.toHaveBeenCalled();
  });
});
