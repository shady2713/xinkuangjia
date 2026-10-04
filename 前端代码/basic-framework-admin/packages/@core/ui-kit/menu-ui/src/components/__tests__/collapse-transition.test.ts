/**
 * 折叠过渡（menu-ui 的 collapse-transition）真实过渡钩子回归。
 *
 * 该组件用高度与内边距动画承载子菜单展开收起：进入前不记录原始内边距会让展开后无法还原，
 * 离开前不固定当前高度会让收起没有过渡，离开后不还原原始样式会把菜单永久压扁，取消过渡时
 * 不重置样式会在快速点击后留下错误高度。用例挂载真实过渡组件与真实元素，只把浏览器布局与
 * CSS 过渡引擎替换成确定替身（happy-dom 不实现布局与过渡），过渡钩子、数据集记录与样式
 * 写入全部按组件真实实现执行。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref, vShow, withDirectives } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CollapseTransition from '../collapse-transition.vue';

/** 面板元素的滚动高度替身；由用例设置，用于驱动需要非零高度的分支。 */
const layoutProbe = vi.hoisted(
  /** 建立可逐例重置的滚动高度容器。 */ () => ({ scrollHeight: 0 }),
);

/** 过渡时长替身；非零时 Vue 会等待 transitionend，从而留出取消窗口。 */
const transitionProbe = vi.hoisted(
  /** 建立可逐例切换的过渡时长容器。 */ () => ({ duration: '0s' }),
);

/**
 * 安装布局与过渡替身。
 * @returns 无返回值；替身由 afterEach 统一还原。
 */
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    /** 返回用例设置的滚动高度，替代 happy-dom 未实现的布局。 */ () =>
      layoutProbe.scrollHeight,
  );
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    /**
     * 只把过渡相关属性替换成确定值，其余样式仍读取真实计算结果。
     * @param element 要读取样式的元素。
     * @returns 带确定过渡时长的样式声明。
     */
    (element: Element) => {
      const style = realGetComputedStyle(element);
      return new Proxy(style, {
        /**
         * 拦截过渡属性读取，其余属性透传真实样式。
         * @param target 真实样式声明。
         * @param property 被读取的属性名。
         * @returns 确定的过渡属性或真实属性值。
         */
        get(target, property) {
          const key = String(property);
          if (key === 'transitionDuration') return transitionProbe.duration;
          if (key === 'transitionProperty') {
            return transitionProbe.duration === '0s' ? 'all' : 'max-height';
          }
          return Reflect.get(target, property) as unknown;
        },
      });
    },
  );
}

/**
 * 挂载带折叠过渡的面板。
 * @param initialVisible 初始是否显示面板内容。
 * @param inlineHeight 面板声明的内联高度，用于验证沿用既有高度的分支。
 * @param useVShow 是否用 v-show 控制显隐；同一元素上的显隐切换才能触发过渡取消。
 * @returns 已挂载的包装器、切换显示状态的方法与面板元素读取函数。
 */
function mountCollapse(
  initialVisible = true,
  inlineHeight?: string,
  useVShow = false,
) {
  const visible = ref(initialVisible);
  const Host = defineComponent({
    name: 'CollapseTransitionHost',
    /**
     * 渲染真实过渡组件与可切换显示的面板。
     * @returns 渲染折叠面板的渲染函数。
     */
    setup() {
      return /** 按显示状态渲染面板内容。 */ () =>
        h(
          CollapseTransition,
          {},
          {
            /**
             * 过渡组件的默认插槽：显示状态为真时渲染面板。
             * @returns 面板节点数组；隐藏时返回空数组。
             */
            default: () => {
              const panelNode = h(
                'div',
                {
                  'data-test': 'panel',
                  style: inlineHeight ? { height: inlineHeight } : undefined,
                },
                '面板内容',
              );
              if (useVShow) {
                // v-show 与过渡组件配合时会在同一元素上真实触发进入与离开。
                return [withDirectives(panelNode, [[vShow, visible.value]])];
              }
              return visible.value ? [panelNode] : [];
            },
          },
        );
    },
  });
  const wrapper = mount(Host, {
    // 关闭测试工具对内置过渡组件的默认替身，真实执行过渡钩子。
    global: { stubs: { transition: false } },
  });
  return {
    /**
     * 读取当前面板元素。
     * @returns 面板元素；已移除时返回 null。
     */
    panel() {
      const found = wrapper.find('[data-test="panel"]');
      return found.exists() ? (found.element as HTMLElement) : null;
    },
    /**
     * 切换面板显示状态，触发一次真实过渡。
     * @param next 目标显示状态。
     * @returns 渲染收敛后兑现的 Promise。
     */
    async toggle(next: boolean) {
      visible.value = next;
      await nextTick();
      await nextTick();
    },
    /** 已挂载的宿主包装器。 */
    wrapper,
  };
}

beforeEach(
  /** 每例从零滚动高度与无过渡时长出发，并安装布局替身。 */ () => {
    layoutProbe.scrollHeight = 0;
    transitionProbe.duration = '0s';
    stubLayout();
  },
);

afterEach(
  /** 还原布局替身与计时器。 */ () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  },
);

describe('展开过渡', /** 展开动画决定子菜单是否平滑出现并能还原原始样式。 */ () => {
  it('进入前把高度与内外边距压平', /** 不压平会让展开瞬间跳动。 */ async () => {
    transitionProbe.duration = '0.3s';
    layoutProbe.scrollHeight = 120;
    const { panel, toggle } = mountCollapse(false);
    expect(panel()).toBeNull();

    await toggle(true);
    const element = panel();

    expect(element?.style.maxHeight).toBe('0');
    expect(element?.style.marginTop).toBe('0px');
    expect(element?.style.marginBottom).toBe('0px');
  });

  it('进入动画帧里按滚动高度设置最大高度并隐藏溢出', /** 不设置高度会让展开没有过渡。 */ async () => {
    vi.useFakeTimers();
    transitionProbe.duration = '0.3s';
    layoutProbe.scrollHeight = 120;
    const { panel, toggle } = mountCollapse(false);

    await toggle(true);
    const element = panel();
    vi.advanceTimersByTime(50);
    await nextTick();

    expect(element?.style.maxHeight).toBe('120px');
    expect(element?.style.overflow).toBe('hidden');
  });

  it('面板已声明高度时沿用该高度', /** 已声明高度的面板不能被滚动高度覆盖。 */ async () => {
    vi.useFakeTimers();
    transitionProbe.duration = '0.3s';
    layoutProbe.scrollHeight = 120;
    const { panel, toggle } = mountCollapse(false, '200px');

    await toggle(true);
    const element = panel();
    vi.advanceTimersByTime(50);
    await nextTick();

    expect(element?.dataset.elExistsHeight).toBe('200px');
    expect(element?.style.maxHeight).toBe('200px');
  });

  it('滚动高度为 0 时最大高度归零', /** 空面板不应被撑出高度，否则会出现空白动画。 */ async () => {
    vi.useFakeTimers();
    transitionProbe.duration = '0.3s';
    const { panel, toggle } = mountCollapse(false);

    await toggle(true);
    const element = panel();
    vi.advanceTimersByTime(50);
    await nextTick();

    expect(element?.style.maxHeight).toBe('0');
    expect(element?.style.overflow).toBe('hidden');
  });
});

describe('收起过渡', /** 收起动画决定子菜单是否平滑消失并恢复原始样式。 */ () => {
  it('离开前固定当前高度，离开后按原始样式还原', /** 不还原原始样式会把菜单永久压扁。 */ async () => {
    vi.useFakeTimers();
    transitionProbe.duration = '0.3s';
    layoutProbe.scrollHeight = 120;
    const { panel, toggle } = mountCollapse(false);
    await toggle(true);
    const element = panel();
    vi.advanceTimersByTime(50);
    element?.dispatchEvent(new Event('transitionend'));
    vi.advanceTimersByTime(50);

    await toggle(false);
    // 离开过渡进行中：高度从当前滚动高度收拢到 0，内边距与外边距同步归零。
    vi.advanceTimersByTime(50);
    expect(element?.style.maxHeight).toBe('0');
    expect(element?.style.marginTop).toBe('0px');

    element?.dispatchEvent(new Event('transitionend'));
    vi.advanceTimersByTime(50);

    // 过渡结束后还原最大高度与溢出，只保留归零的外边距。
    expect(element?.style.maxHeight).toBe('');
    expect(element?.style.overflow).toBe('');
  });

  it('滚动高度为 0 时不写入高度归零', /** 空面板没有可收起的空间，写入归零会产生无意义动画。 */ async () => {
    vi.useFakeTimers();
    transitionProbe.duration = '0.3s';
    const { panel, toggle } = mountCollapse(false);
    await toggle(true);
    const element = panel();
    vi.advanceTimersByTime(50);
    element?.dispatchEvent(new Event('transitionend'));
    vi.advanceTimersByTime(50);

    await toggle(false);
    vi.advanceTimersByTime(50);

    // 离开前记录的高度为 0，离开钩子不再写入归零，外边距保持未设置。
    expect(element?.style.maxHeight).toBe('0px');
    expect(element?.style.marginTop).toBe('');
  });
});

describe('过渡取消', /** 快速切换时被取消的过渡必须把样式还原，否则面板高度会卡住。 */ () => {
  it('展开过程中被收起时按收起口径继续', /** 进入取消不重置会在快速点击后留下 0 高度。 */ async () => {
    transitionProbe.duration = '0.3s';
    layoutProbe.scrollHeight = 120;
    const { panel, toggle } = mountCollapse(false);

    await toggle(true);
    const element = panel();
    // 过渡未结束就切回收起，Vue 会取消进入并调用进入取消钩子。
    await toggle(false);

    expect(element?.style.maxHeight).toBe('0');
    expect(element?.style.marginTop).toBe('0px');
  });

  it('收起过程中被展开时按展开口径继续', /** 离开取消不重置会在快速点击后留下固定高度。 */ async () => {
    transitionProbe.duration = '0.3s';
    layoutProbe.scrollHeight = 120;
    const { panel, toggle } = mountCollapse(true, undefined, true);

    const element = panel();
    await toggle(false);
    // 离开过渡未结束就切回展开，Vue 会取消离开并调用离开取消钩子。
    await toggle(true);
    await nextTick();

    expect(element?.style.marginTop).toBe('0px');
    expect(element?.style.maxHeight).not.toBe('120px');
  });
});
