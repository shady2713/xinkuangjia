/**
 * VxeGridApi 的状态与代理调用契约回归。
 *
 * 表格 API 是业务页面驱动真实 vxe-grid 的唯一入口：查询参数必须以去响应式代理后的
 * 原始对象交给 `commitProxy`，失败要记录日志而不能把异常抛给页面；加载态、gridOptions
 * 覆盖与搜索表单开关必须真实写进内部状态，否则页面点了按钮没有反应。
 * 用例实例化真实 API，只替换第三方表格边界（记录型 commitProxy 替身）。
 */
import type { VxeGridInstance } from 'vxe-table';

import { isReactive, reactive } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { VxeGridApi } from '../api';

/**
 * 安装只记录调用的表格替身，避免引入真实 vxe-table 渲染。
 * @param api 待安装替身的真实 API 实例，行类型由调用方决定。
 * @returns 记录代理类型与参数的 commitProxy 替身，用例可改写实现模拟失败。
 */
function installGrid<T extends object>(api: VxeGridApi<T>) {
  const commitProxy = vi.fn(
    /**
     * 默认异步返回空结果，仅用于让成功分支可被断言。
     * @param _type vxe-table 的代理类型。
     * @param _params API 转交的代理参数。
     * @returns 空代理结果。
     */
    async (_type: string, _params: Record<string, unknown>) => ({}),
  );
  api.grid = { commitProxy } as unknown as VxeGridInstance;
  return commitProxy;
}

/**
 * 屏蔽并记录 console.error，用于断言失败分支既被记录又不外抛。
 * @returns 可断言的 console.error 替身。
 */
function spyConsoleError() {
  return vi
    .spyOn(console, 'error')
    .mockImplementation(
      /** 失败日志不是本用例的断言目标，避免向测试输出噪音。 */ () => {},
    );
}

describe('表格 API 实例', /** 表格 API 决定页面查询、刷新与加载态的真实行为。 */ () => {
  it('query 把去代理后的参数交给 query 链路', /** 传响应式代理会让 vxe-table 内部比对与序列化读到 Proxy，必须 toRaw 后再转交。 */ async () => {
    const api = new VxeGridApi<{ name: string }>();
    const commitProxy = installGrid(api);

    await api.query(reactive({ name: '研发部' }));

    expect(commitProxy).toHaveBeenCalledTimes(1);
    expect(commitProxy.mock.calls[0]?.[0]).toBe('query');
    const received = commitProxy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(received).toEqual({ name: '研发部' });
    expect(isReactive(received)).toBe(false);
  });

  it('query 缺省参数也发出空条件请求', /** 无筛选条件时仍要触发一次查询，否则首屏拿不到数据。 */ async () => {
    const api = new VxeGridApi();
    const commitProxy = installGrid(api);

    await api.query();

    expect(commitProxy).toHaveBeenCalledWith('query', {});
  });

  it('query 失败时记录错误且不向调用方抛出', /** 查询失败由表格展示空态，页面事件回调不应收到未处理异常。 */ async () => {
    const api = new VxeGridApi();
    const commitProxy = installGrid(api);
    const failure = new Error('查询后端不可用');
    commitProxy.mockRejectedValueOnce(failure);
    const error = spyConsoleError();

    await expect(api.query({ page: 1 })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      'Error occurred while querying:',
      failure,
    );
  });

  it('reload 用 reload 链路并同样兜住失败', /** 刷新按钮走 reload 而不是 query，混用会把参数并入而不是替换筛选条件。 */ async () => {
    const api = new VxeGridApi();
    const commitProxy = installGrid(api);

    await api.reload({ keyword: '预算' });
    expect(commitProxy).toHaveBeenCalledWith('reload', { keyword: '预算' });

    const failure = new Error('刷新后端不可用');
    commitProxy.mockRejectedValueOnce(failure);
    const error = spyConsoleError();
    await expect(api.reload()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      'Error occurred while reloading:',
      failure,
    );
  });

  it('setLoading 写入加载态并保留已有 gridOptions', /** 加载态覆盖式写入会丢掉列定义，页面表格会突然空掉。 */ () => {
    const api = new VxeGridApi({
      gridOptions: { columns: [{ field: 'name', title: '部门' }] },
    });

    api.setLoading(true);
    expect(api.state?.gridOptions).toEqual({
      columns: [{ field: 'name', title: '部门' }],
      loading: true,
    });

    api.setLoading(false);
    expect(api.state?.gridOptions?.loading).toBe(false);
    expect(api.state?.gridOptions?.columns).toEqual([
      { field: 'name', title: '部门' },
    ]);
  });

  it('setGridOptions 覆盖同名字段而不是拼接数组', /** 数组拼接会让新旧列同时渲染，覆盖式更新才是真实契约。 */ () => {
    const api = new VxeGridApi();
    api.setGridOptions({ columns: [{ field: 'old', title: '旧列' }] });

    api.setGridOptions({ columns: [{ field: 'new', title: '新列' }] });

    expect(api.state?.gridOptions?.columns).toEqual([
      { field: 'new', title: '新列' },
    ]);
  });

  it('toggleSearchForm 无参时取反并返回新值', /** 返回值是页面读取折叠状态的唯一来源，写错会让按钮状态与实际相反。 */ () => {
    const api = new VxeGridApi();
    expect(api.state?.showSearchForm).toBe(true);

    expect(api.toggleSearchForm()).toBe(false);
    expect(api.state?.showSearchForm).toBe(false);

    expect(api.toggleSearchForm()).toBe(true);
    expect(api.state?.showSearchForm).toBe(true);
  });

  it('toggleSearchForm 显式传布尔时按传入值', /** 外部同步折叠状态时必须幂等，不能被取反逻辑反转。 */ () => {
    const api = new VxeGridApi();

    expect(api.toggleSearchForm(false)).toBe(false);
    expect(api.toggleSearchForm(false)).toBe(false);
    expect(api.toggleSearchForm(true)).toBe(true);
  });

  it('setState 函数式更新基于前一个状态计算', /** 函数式更新是折叠、分页等联动状态的基础，必须读到最新状态。 */ () => {
    const api = new VxeGridApi();

    api.setState(
      /** 依据前一个状态的搜索表单开关取反。 */ (prev) => ({
        showSearchForm: !prev.showSearchForm,
      }),
    );
    expect(api.state?.showSearchForm).toBe(false);

    api.setState(
      /** 再次取反，验证第二次读取到的是上一次写入后的状态。 */ (prev) => ({
        showSearchForm: !prev.showSearchForm,
      }),
    );
    expect(api.state?.showSearchForm).toBe(true);
  });

  it('mount 只接受首次挂载，unmount 后允许重新挂载', /** 重复挂载不得换掉当前表格实例，卸载后必须能重新接管新实例。 */ () => {
    const api = new VxeGridApi();
    const firstGrid = { commitProxy: vi.fn() } as unknown as VxeGridInstance;
    const secondGrid = { commitProxy: vi.fn() } as unknown as VxeGridInstance;
    const firstFormApi = { id: 'first' };
    const secondFormApi = { id: 'second' };

    api.mount(null, firstFormApi as never);
    expect(api.grid).toEqual({});

    api.mount(firstGrid, firstFormApi as never);
    expect(api.grid).toBe(firstGrid);
    expect(api.formApi).toBe(firstFormApi);

    api.mount(secondGrid, secondFormApi as never);
    expect(api.grid).toBe(firstGrid);
    expect(api.formApi).toBe(firstFormApi);

    api.unmount();
    api.mount(secondGrid, secondFormApi as never);
    expect(api.grid).toBe(secondGrid);
    expect(api.formApi).toBe(secondFormApi);
  });
});
