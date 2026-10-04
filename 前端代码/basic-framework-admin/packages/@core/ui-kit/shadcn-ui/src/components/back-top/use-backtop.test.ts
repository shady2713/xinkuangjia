/**
 * 回到顶部组合式函数（back-top/use-backtop）的真实行为回归。
 *
 * 该组合式函数决定按钮"何时出现"与"点击滚到哪里"：监听容器选错会让页面滚动不更新按钮，
 * 阈值判断写反会让按钮常驻或永不出现，点击不滚动或滚错容器会让用户回到页面顶部失败。
 * 用例在真实组件中调用它，通过真实 DOM 滚动事件与真实 Element 的 scrollTo 断言行为，
 * 不替换 vueuse 的事件监听与节流实现（节流为前缘执行、窗口内事件延后到尾缘执行）。
 */
import type { BacktopProps } from './backtop';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBackTop } from './use-backtop';

/** 被测组合式函数返回的可见状态与点击句柄。 */
type BackTopHandle = ReturnType<typeof useBackTop>;

/**
 * 在真实组件中调用 useBackTop，返回挂载结果与已就绪的句柄。
 * @param props 回到顶部按钮属性，决定触发阈值与滚动容器。
 * @returns 挂载包装器与句柄。
 * @throws {Error} 组合式函数未在挂载期返回句柄时抛出，避免用例静默通过。
 */
function mountBackTop(props: BacktopProps) {
  const captured: { handle?: BackTopHandle } = {};
  const Host = defineComponent({
    name: 'BackTopHost',
    /** 在真实组件实例中调用被测组合式函数，挂载过程即执行 onMounted 初始化。
     * @returns 渲染空容器的渲染函数。
     */
    setup() {
      captured.handle = useBackTop(props);
      /** 渲染可定位的空容器，容器本身不参与滚动逻辑。 */
      const renderHost = () => h('div', { class: 'back-top-host' });
      return renderHost;
    },
  });
  const wrapper = mount(Host);
  if (!captured.handle) throw new Error('useBackTop 未在挂载期返回句柄');
  return { handle: captured.handle, wrapper };
}

describe('useBackTop', /** 可见状态判定与点击滚动目标必须由真实滚动容器决定。 */ () => {
  afterEach(
    /** 还原被替换的滚动实现与文档滚动位置，并清理用例创建的元素。 */ () => {
      vi.restoreAllMocks();
      document.documentElement.scrollTop = 0;
      document.querySelectorAll('.scroll-target').forEach(
        /** 删除用例创建的滚动容器，避免影响后续用例。 */ (el) => {
          el.remove();
        },
      );
    },
  );

  it('页面滚动后按阈值更新可见状态', /** 监听容器写错会让按钮不跟随页面滚动出现或消失。 */ async () => {
    document.documentElement.scrollTop = 0;
    const { handle } = mountBackTop({ visibilityHeight: 200 });
    // 事件监听在挂载后的首个刷新周期内注册，先等待注册完成再制造滚动。
    await nextTick();

    expect(handle.visible.value).toBe(false);

    // 节流窗口外的首次滚动由前缘立即处理。
    document.documentElement.scrollTop = 300;
    document.dispatchEvent(new Event('scroll'));
    expect(handle.visible.value).toBe(true);

    // 窗口内的第二次滚动延后到尾缘处理，等待其真正生效。
    document.documentElement.scrollTop = 100;
    document.dispatchEvent(new Event('scroll'));
    await vi.waitFor(
      /** 等待节流尾缘回调更新可见状态。 */ () => {
        expect(handle.visible.value).toBe(false);
      },
    );
  });

  it('阈值缺省为 0 时滚动位置为零也可见', /** 缺省阈值必须按 0 处理，改成其它值会让直接调用方行为变化。 */ () => {
    document.documentElement.scrollTop = 0;
    const { handle } = mountBackTop({});

    expect(handle.visible.value).toBe(true);
  });

  it('点击回到顶部在文档元素上执行平滑滚动', /** 滚动目标或行为写错会让点击没有反应或直接跳变。 */ () => {
    document.documentElement.scrollTop = 300;
    const scrollTo = vi
      .spyOn(document.documentElement, 'scrollTo')
      .mockImplementation(
        /** 只记录滚动调用，避免用例真的改变文档位置。 */ () => {},
      );
    const { handle } = mountBackTop({ visibilityHeight: 200 });

    handle.handleClick();

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 0 });
  });

  it('指定 target 时以目标元素为滚动容器', /** 容器仍是文档会让目标区域内的滚动不更新按钮，点击也不会滚回该区域顶部。 */ async () => {
    const container = document.createElement('div');
    container.className = 'scroll-target';
    container.scrollTop = 400;
    document.body.append(container);
    const scrollTo = vi
      .spyOn(container, 'scrollTo')
      .mockImplementation(
        /** 只记录滚动调用，避免用例真的改变容器位置。 */ () => {},
      );

    const { handle } = mountBackTop({
      target: '.scroll-target',
      visibilityHeight: 200,
    });
    // 事件监听在挂载后的首个刷新周期内注册，先等待注册完成再制造滚动。
    await nextTick();

    // 挂载时按目标元素当前位置给出初始可见状态。
    expect(handle.visible.value).toBe(true);

    handle.handleClick();
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 0 });

    // 只有目标元素上的滚动事件才会更新可见状态。
    container.scrollTop = 0;
    container.dispatchEvent(new Event('scroll'));
    expect(handle.visible.value).toBe(false);
  });

  it('target 不存在时抛出包含选择器的错误', /** 静默失败会让调用方以为按钮已可用，必须显式暴露配置错误。 */ () => {
    expect(
      /** 挂载不存在的目标必须直接失败，不能静默忽略配置错误。 */ () =>
        mountBackTop({ target: '#missing-backtop-target' }),
    ).toThrow('target does not exist: #missing-backtop-target');
  });
});
