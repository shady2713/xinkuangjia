/**
 * useTabsDrag 的排序事件测试。
 *
 * 用 mock 接管 useSortable，捕获其配置后直接驱动 onEnd，
 * 从而在没有真实拖拽交互的前提下验证 sortTabs 的发出条件与销毁时机。
 */
import type { SortableOptions } from 'sortablejs';

import type { TabsProps } from '../src/types';

import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTabsDrag } from '../src/use-tabs-drag';

/** 捕获 useSortable 收到的配置，用于直接驱动 sortable 的回调。 */
let capturedOptions: null | SortableOptions = null;
/** 记录 sortable 实例是否被销毁。 */
const destroyMock = vi.fn();

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
      /** 固定为非移动端，确保走可拖拽分支。 */
      useIsMobile: () => ({ isMobile: ref(false) }),
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

const props: TabsProps = {
  contentClass: 'tabs-content',
  draggable: true,
  styleType: 'card',
};

describe('useTabsDrag 排序事件', /** sortTabs 的发出条件、非法输入处理与实例销毁。 */ () => {
  let emit: ReturnType<typeof vi.fn>;
  let host: HTMLElement;
  let draggableTab: HTMLElement;

  beforeEach(
    /** 每个用例重建容器与 emit 记录，避免 DOM 残留影响判断。 */
    () => {
      capturedOptions = null;
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
   * @returns 组件包装器，供卸载断言使用。
   */
  async function mountDrag() {
    const Host = defineComponent({
      /**
       * 组件本体：只调用 useTabsDrag 并渲染空节点，拖拽容器由文档中的 host 提供。
       * @returns 渲染函数。
       */
      setup() {
        useTabsDrag(props, emit as never);
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

  it('组件卸载时销毁 sortable 实例', /** 卸载必须销毁 sortable，避免事件监听残留在已销毁的 DOM 上。 */ async () => {
    const wrapper = await mountDrag();

    wrapper.unmount();

    expect(destroyMock).toHaveBeenCalled();
  });
});
