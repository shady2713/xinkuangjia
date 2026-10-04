/**
 * vxe 原生工具栏挂载封装（use-vxe-toolbar）的真实行为回归。
 *
 * 表格与工具栏是两个独立组件，必须在两者都就绪后延迟连接，否则工具栏按钮不会跟随表格：
 * 过早连接会拿到未挂载的工具栏引用，缺少就绪判断会让连接静默失败，重复连接会重复注册
 * 工具栏事件。用例在真实组件中调用该封装，用可控的表格/工具栏替身驱动真实定时器与
 * watch，只替换第三方组件实例本身。
 */
import type { VxeTableInstance } from 'vxe-table';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTableToolbar } from '../use-vxe-toolbar';

/** 被测封装返回的引用集合。 */
type ToolbarHandle = ReturnType<typeof useTableToolbar>;

/**
 * 在真实组件中调用 useTableToolbar。
 * @returns 挂载包装器与已就绪的句柄。
 * @throws {Error} 组合式函数未在挂载期返回句柄时抛出，避免用例静默通过。
 */
function mountToolbar() {
  const captured: { handle?: ToolbarHandle } = {};
  const Host = defineComponent({
    name: 'ToolbarHost',
    /** 在真实组件实例中调用被测封装，挂载过程即执行 immediate watch。
     * @returns 渲染空容器的渲染函数。
     */
    setup() {
      captured.handle = useTableToolbar();
      /** 渲染可定位的空容器，容器本身不参与连接逻辑。 */
      const renderHost = () => h('div', { class: 'toolbar-host' });
      return renderHost;
    },
  });
  const wrapper = mount(Host);
  if (!captured.handle) throw new Error('useTableToolbar 未在挂载期返回句柄');
  return { handle: captured.handle, wrapper };
}

/**
 * 建立只记录连接调用的表格替身。
 * @returns 连接调用记录与可直接赋给 tableRef 的替身实例。
 */
function createTableStub() {
  const connectToolbar = vi.fn();
  return {
    connectToolbar,
    table: { connectToolbar } as unknown as VxeTableInstance,
  };
}

describe('useTableToolbar', /** 工具栏连接的就绪条件、延迟与去重。 */ () => {
  beforeEach(
    /** 用可控时钟驱动 1 秒延迟，避免用例真实等待。 */ () => {
      vi.useFakeTimers();
    },
  );

  afterEach(
    /** 还原时钟与被替换的控制台输出。 */ () => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    },
  );

  it('工具栏引用尚未就绪时不建立连接', /** 工具栏未挂载就连接会拿到空引用，必须等两者都就绪。 */ async () => {
    const { handle } = mountToolbar();
    const { connectToolbar, table } = createTableStub();

    handle.tableRef.value = table;
    await nextTick();
    await vi.advanceTimersByTimeAsync(1000);

    expect(connectToolbar).not.toHaveBeenCalled();
  });

  it('表格与工具栏都就绪后延迟连接工具栏', /** 立即连接会拿到尚未挂载的工具栏，延迟是真实契约的一部分。 */ async () => {
    const { handle } = mountToolbar();
    const { connectToolbar, table } = createTableStub();
    const toolbar = { name: 'toolbar' };

    handle.tableToolbarRef.value = {
      /** 交出真实工具栏实例，模拟已挂载的工具栏组件。 */
      getToolbarRef: () => toolbar,
    } as never;
    handle.tableRef.value = table;
    await nextTick();

    // 延迟未到之前不得连接。
    await vi.advanceTimersByTimeAsync(999);
    expect(connectToolbar).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(connectToolbar).toHaveBeenCalledTimes(1);
    expect(connectToolbar).toHaveBeenCalledWith(toolbar);
  });

  it('工具栏引用缺失时告警并仍然按约定连接', /** 静默失败会让工具栏按钮失效且没有任何线索。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 静默预期内的告警，避免污染测试输出。 */ () => {});
    const { handle } = mountToolbar();
    const { connectToolbar, table } = createTableStub();

    handle.tableToolbarRef.value = {
      /** 模拟工具栏组件已挂载但尚未取得内部实例。 */
      getToolbarRef: () => undefined,
    } as never;
    handle.tableRef.value = table;
    await nextTick();
    await vi.advanceTimersByTimeAsync(1000);

    expect(consoleError).toHaveBeenCalledWith(
      '[toolbar 挂载失败] Table toolbar not found',
    );
    expect(connectToolbar).toHaveBeenCalledWith(undefined);
  });

  it('完成绑定后更换表格实例不再重复连接', /** 重复连接会重复注册工具栏事件，必须由已绑定标记拦住。 */ async () => {
    const { handle } = mountToolbar();
    const first = createTableStub();
    const second = createTableStub();

    handle.tableToolbarRef.value = {
      /** 交出真实工具栏实例，模拟已挂载的工具栏组件。 */
      getToolbarRef: () => ({ name: 'toolbar' }),
    } as never;
    handle.tableRef.value = first.table;
    await nextTick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.connectToolbar).toHaveBeenCalledTimes(1);

    handle.tableRef.value = second.table;
    await nextTick();
    await vi.advanceTimersByTimeAsync(1000);

    expect(second.connectToolbar).not.toHaveBeenCalled();
  });
});
