/**
 * useTabsDrag 的拖拽配置与排序事件测试。
 *
 * 用 mock 接管 useSortable，捕获其配置后直接驱动 sortable 的 filter/onMove/onStart/onEnd，
 * 从而在没有真实拖拽交互的前提下验证拦截条件、拖拽态标记、sortTabs 的发出条件、
 * 样式切换重建与卸载销毁时机。用例只替换第三方拖拽库与移动端判定，其余实现保持真实。
 */
import type { SortableOptions } from 'sortablejs';

import type { TabsProps } from '../src/types';

import { mount } from '@vue/test-utils';
import { defineComponent, h, reactive, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTabsDrag } from '../src/use-tabs-drag';

/** 捕获 useSortable 收到的配置，用于直接驱动 sortable 的回调。 */
let capturedOptions: null | SortableOptions = null;
/** 记录 sortable 实例是否被销毁。 */
const destroyMock = vi.fn();
/** 可被用例逐例切换的移动端判定结果，避免真实媒体查询影响分支选择。 */
const mobileFlag = vi.hoisted(
  /** 建立用例可写的移动端标记容器。 */ () => ({ value: false }),
);

vi.mock(
  '@vben-core/composables',
  /**
   * 接管 composables：保留其余实现，只替换移动端判定与 sortable 创建。
   * @param importOriginal 原始模块加载器，用于取回未替换的实现。
   * @returns 合并后的模块替身。
   */
  async (importOriginal) => {
    const actual =
      await importOriginal<typeof import('@vben-core/composables')>();
    return {
      ...actual,
      /** 按用例设置返回移动端判定，缺省为非移动端以走可拖拽分支。 */
      useIsMobile: () => ({ isMobile: ref(mobileFlag.value) }),
      /**
       * 接管 sortable 创建：只记录配置与销毁句柄，不建立真实拖拽。
       * @param _element sortable 目标元素，此处不使用。
       * @param options useTabsDrag 传入的配置。
       * @returns 带初始化方法的替身。
       */
      useSortable: (
        /** sortable 目标元素，此处不使用。 */
        _element: HTMLElement,
        /** useTabsDrag 传入的配置。 */
        options: SortableOptions = {},
      ) => {
        capturedOptions = options;
        return {
          /**
           * 交出可被断言的销毁句柄，用例据此验证卸载确实销毁了 sortable。
           * @returns 带 destroy 的 sortable 实例。
           */
          initializeSortable: async () => ({ destroy: destroyMock }),
        };
      },
    };
  },
);

/** sortable onEnd 的入参形状：只保留 useTabsDrag 真正读取的字段。 */
type EndEvent = {
  newIndex?: number;
  oldIndex?: number;
  originalEvent?: { srcElement?: HTMLElement };
};

/** sortable onMove 的入参形状：只保留 useTabsDrag 真正读取的字段。 */
type MoveEvent = {
  dragged: HTMLElement;
  related: HTMLElement;
};

const props: TabsProps = {
  contentClass: 'tabs-content',
  draggable: true,
  styleType: 'card',
};

describe('useTabsDrag', /** 拦截条件、拖拽态、排序事件、样式切换重建与销毁时机。 */ () => {
  let emit: ReturnType<typeof vi.fn>;
  let host: HTMLElement;
  let draggableTab: HTMLElement;

  beforeEach(
    /** 每个用例重建容器与 emit 记录，避免 DOM 残留影响判断。 */
    () => {
      capturedOptions = null;
      mobileFlag.value = false;
      destroyMock.mockClear();
      emit = vi.fn();

      // useTabsDrag 通过 document 查询容器，节点必须真实存在于文档中。
      host = document.createElement('div');
      host.className = 'tabs-content';
      host.innerHTML =
        '<div class="group draggable"><span class="tab-label">标签</span></div>';
      document.body.append(host);
      draggableTab = host.querySelector('.tab-label') as HTMLElement;
    },
  );

  afterEach(
    /** 移除本用例挂到文档上的容器。 */
    () => {
      host.remove();
    },
  );

  /**
   * 挂载真实组件，等待 onMounted 内的 nextTick 初始化完成。
   * @param dragProps 本次使用的标签页属性，缺省复用基线属性。
   * @returns 组件包装器，供卸载与属性变更断言使用。
   */
  async function mountDrag(dragProps: TabsProps = props) {
    const Host = defineComponent({
      /**
       * 组件本体：只调用 useTabsDrag 并渲染空节点，拖拽容器由文档中的 host 提供。
       * @returns 渲染函数。
       */
      setup() {
        useTabsDrag(dragProps, emit as never);
        return (
          /** 真实挂载一个空节点即可，拖拽容器由上面的 host 提供。 */
          () => h('div')
        );
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    return wrapper;
  }

  /**
   * 读取 sortable 的过滤回调，供用例直接驱动。
   * @returns 过滤回调；配置缺失时抛错，避免用例静默通过。
   */
  function getFilter() {
    const filter = capturedOptions?.filter;
    if (!filter) throw new Error('filter 回调未注册');
    return filter;
  }

  /**
   * 读取 sortable 的移动回调，供用例直接驱动。
   * @returns 移动回调；配置缺失时抛错，避免用例静默通过。
   */
  function getOnMove() {
    const onMove = capturedOptions?.onMove;
    if (!onMove) throw new Error('onMove 回调未注册');
    return onMove;
  }

  /**
   * 以指定的拖拽来源触发 sortable 的 onEnd。
   * @param event 旧索引、新索引与可选的来源节点。
   */
  function fireEnd(event: EndEvent) {
    capturedOptions?.onEnd?.({
      ...event,
      originalEvent: { srcElement: draggableTab, ...event.originalEvent },
      // @ts-expect-error sortable 的 onEnd 事件还带有其他字段，本用例只关心上面几个。
    } as never);
  }

  it('容器尚未渲染时只告警且不初始化拖拽', /** 找不到容器必须告警而不是抛错，等待下一次调用。 */ async () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 静默预期内的告警，避免污染测试输出。 */ () => {});
    host.remove();

    await mountDrag();

    expect(consoleWarn).toHaveBeenCalledWith(
      'Element not found for sortable initialization',
    );
    expect(capturedOptions).toBeNull();

    consoleWarn.mockRestore();
  });

  it('移动端不初始化拖拽排序', /** 移动端标签栏不支持拖拽，注册排序会干扰横向滑动。 */ async () => {
    mobileFlag.value = true;

    await mountDrag();

    expect(capturedOptions).toBeNull();
  });

  it('过滤回调按可拖拽标记决定是否拦截', /** 过滤语义写反会让整栏不可拖或让固定标签也被拖走。 */ async () => {
    await mountDrag();
    const filter = getFilter();
    const fixedGroup = document.createElement('div');
    fixedGroup.className = 'group';
    const fixedLabel = document.createElement('span');
    fixedLabel.className = 'fixed-label';
    fixedGroup.append(fixedLabel);
    host.append(fixedGroup);

    // 目标自身就是可拖拽分组：允许排序。
    expect(
      filter({} as never, host.querySelector('.group') as HTMLElement),
    ).toBe(false);
    // 目标落在不可拖拽分组内：拦截排序。
    expect(filter({} as never, fixedLabel)).toBe(true);
  });

  it('整栏禁用拖拽时过滤回调拦截所有目标', /** 只隐藏手柄而不拦截排序，仍会让用户拖动固定标签。 */ async () => {
    await mountDrag({ ...props, draggable: false });

    expect(getFilter()({} as never, draggableTab)).toBe(true);
  });

  it('拖拽开始时标记容器与当前分组为拖拽中', /** 缺少拖拽态会让用户看不出正在拖动哪一项。 */ async () => {
    await mountDrag();

    capturedOptions?.onStart?.({} as never);

    expect(host.style.cursor).toBe('grabbing');
    expect(
      host.querySelector('.draggable')?.classList.contains('dragging'),
    ).toBe(true);
  });

  it('移动回调只允许同类型标签之间互相拖动', /** 固定标签与普通标签互相拖动会破坏用户约定的固定顺序。 */ async () => {
    await mountDrag();
    const draggableGroup = host.querySelector('.draggable') as HTMLElement;
    const dragged = document.createElement('span');
    dragged.className = 'dragged';
    const related = document.createElement('span');
    related.className = 'related';
    draggableGroup.append(dragged, related);

    // 普通标签拖到普通标签：允许。
    expect(getOnMove()({ dragged, related } as MoveEvent as never)).toBe(true);

    // 固定标签拖到普通标签：拦截。
    dragged.classList.add('affix-tab');
    expect(getOnMove()({ dragged, related } as MoveEvent as never)).toBe(false);

    // 目标不在可拖拽分组内：拦截。
    const outsider = document.createElement('span');
    host.append(outsider);
    expect(
      getOnMove()({ dragged, related: outsider } as MoveEvent as never),
    ).toBe(false);
  });

  it('切换样式类型时销毁旧排序实例并按新容器重建', /** 旧实例残留在已移除的 DOM 上会让样式切换后拖拽失效。 */ async () => {
    const reactiveProps = reactive<TabsProps>({ ...props });
    const wrapper = await mountDrag(reactiveProps);
    const previousOptions = capturedOptions;

    reactiveProps.styleType = 'browser';
    await wrapper.vm.$nextTick();

    // 重建要经过两次 nextTick，等待新实例的配置真正写入后再断言。
    await vi.waitFor(
      /** 等待样式切换后的重建把新配置写入 sortable 替身。 */ () => {
        expect(capturedOptions).not.toBe(previousOptions);
      },
    );
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it('拖拽改变顺序时抛出 sortTabs 旧索引与新索引', /** 顺序真正改变时，必须按“旧索引、新索引”的顺序抛出事件。 */ async () => {
    await mountDrag();

    fireEnd({ newIndex: 2, oldIndex: 0 });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('sortTabs', 0, 2);
  });

  it('顺序未变化时不抛出 sortTabs', /** 落回原位属于无意义操作，不应让上层重新排序。 */ async () => {
    await mountDrag();

    fireEnd({ newIndex: 1, oldIndex: 1 });

    expect(emit).not.toHaveBeenCalled();
  });

  it('索引缺失或非法时不抛出 sortTabs', /** 索引缺失或非法时按“未改变顺序”处理，不能把 NaN 传给上层。 */ async () => {
    await mountDrag();

    fireEnd({});
    fireEnd({ newIndex: Number.NaN, oldIndex: 0 });
    fireEnd({ newIndex: 1, oldIndex: undefined });

    expect(emit).not.toHaveBeenCalled();
  });

  it('拖拽来源不在可拖拽 tab 上时不抛出 sortTabs', /** 拖拽来源必须落在可拖拽 tab 上，否则不触发上层排序。 */ async () => {
    const outsider = document.createElement('div');
    host.append(outsider);
    await mountDrag();

    capturedOptions?.onEnd?.({
      newIndex: 1,
      oldIndex: 0,
      // srcElement 落在没有 group/draggable 的节点上。
      originalEvent: { srcElement: outsider },
    } as never);

    expect(emit).not.toHaveBeenCalled();
  });

  it('拖拽来源落在固定标签上时不抛出 sortTabs', /** 固定标签不允许参与排序，必须复位拖拽态并放弃事件。 */ async () => {
    const fixedGroup = document.createElement('div');
    fixedGroup.className = 'group';
    const fixedSource = document.createElement('span');
    fixedSource.className = 'fixed-source';
    fixedGroup.append(fixedSource);
    host.append(fixedGroup);
    await mountDrag();

    capturedOptions?.onEnd?.({
      newIndex: 2,
      oldIndex: 0,
      originalEvent: { srcElement: fixedSource },
    } as never);

    expect(emit).not.toHaveBeenCalled();
    expect(host.style.cursor).toBe('default');
    expect(fixedGroup.classList.contains('dragging')).toBe(false);
  });

  it('缺少原生拖拽来源时不抛出 sortTabs', /** 取不到拖拽源时按“没有有效拖拽”处理，不能凭索引猜测顺序变化。 */ async () => {
    await mountDrag();

    capturedOptions?.onEnd?.({
      newIndex: 2,
      oldIndex: 0,
      originalEvent: {},
    } as never);

    expect(emit).not.toHaveBeenCalled();
  });

  it('组件卸载时销毁 sortable 实例', /** 卸载必须销毁 sortable，避免事件监听残留在已销毁的 DOM 上。 */ async () => {
    const wrapper = await mountDrag();

    wrapper.unmount();

    expect(destroyMock).toHaveBeenCalled();
  });
});
