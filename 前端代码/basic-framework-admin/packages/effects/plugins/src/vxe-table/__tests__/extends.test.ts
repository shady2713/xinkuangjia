/**
 * 表格代理扩展的真实行为回归：搜索表单值注入、刷新按钮参数剔除与默认格式化器注册。
 *
 * 扩展层决定「点刷新按钮是否带上当前筛选条件」：包装函数必须在每次请求时重新读取
 * 表单值（而不是初始化快照），并在 vxe-table 用 PointerEvent 触发刷新时剔除该事件对象，
 * 否则请求参数会混入事件的内部字段。原回调缺失时不得改写配置，原回调抛错不得被吞掉。
 */
import type { VxeUIExport } from 'vxe-table';

import { formatDate, formatDateTime } from '@vben/utils';

import { describe, expect, it, vi } from 'vitest';

import { VxeGridApi } from '../api';
import { extendProxyOptions, extendsDefaultFormatter } from '../extends';

/**
 * 包装后的代理回调签名：接收请求参数、自定义参数与其余位置参数。
 *
 * 自定义参数与其余位置参数按运行期真实取值声明为 unknown：刷新按钮会把
 * PointerEvent 作为自定义参数传入，用例需要验证包装层剔除该事件对象。
 */
type WrappedAjaxHandler = (
  params: Record<string, unknown>,
  customValues: unknown,
  ...args: unknown[]
) => Promise<unknown>;

/**
 * 表格单元格格式化实现：vxe-table 通过 `tableCellFormatMethod` 读取展示文本。
 */
interface TableCellFormatter {
  /** 按 vxe-table 传入的单元格上下文返回展示文本。 */
  tableCellFormatMethod: (params: { cellValue: unknown }) => string;
}

/** `extendProxyOptions` 的网格配置入参类型，测试夹具按它收窄。 */
type ProxyOptions = Parameters<typeof extendProxyOptions>[1];

/**
 * 构造只记录调用的代理 ajax 回调，供包装函数转发断言。
 * @returns 记录参数并可改写实现的 ajax 回调替身。
 */
function createAjaxHandler() {
  return vi.fn(
    /**
     * 记录 vxe-table 转交的请求参数与自定义参数。
     * @param _params vxe-table 组装的请求参数。
     * @param _customValues 触发本次请求的自定义参数。
     * @returns 可识别的响应结果，用于断言包装函数原样返回。
     */
    async (
      _params: Record<string, unknown>,
      _customValues: Record<string, unknown>,
    ) => ({ ok: true }),
  );
}

/**
 * 读取包装后写回 API 状态的代理回调。
 * @param api 已完成代理扩展的真实 API 实例。
 * @param key 要读取的 ajax 回调名。
 * @returns 可直接调用的包装回调；该键未被包装时为 undefined。
 */
function readWrapped(api: VxeGridApi, key: string) {
  const ajax = (
    api.state?.gridOptions?.proxyConfig as
      | undefined
      | { ajax?: Record<string, unknown> }
  )?.ajax;
  return ajax?.[key] as undefined | WrappedAjaxHandler;
}

describe('extendProxyOptions', /** 代理扩展决定刷新按钮与首屏查询是否使用同一份筛选条件。 */ () => {
  it('包装期不请求，调用时读取最新表单值并合并自定义参数', /** 初始化快照会让刷新按钮退回旧条件，条件更新后必须读到新值。 */ async () => {
    const api = new VxeGridApi();
    const original = createAjaxHandler();
    let formValues: Record<string, unknown> = { keyword: '第一版' };

    extendProxyOptions(
      api,
      {
        proxyConfig: { ajax: { query: original } },
      } as unknown as ProxyOptions,
      /** 返回当前搜索表单值。 */ () => formValues,
    );

    expect(original).not.toHaveBeenCalled();
    const wrapped = readWrapped(api, 'query');
    expect(wrapped).toBeTypeOf('function');
    expect(wrapped).not.toBe(original);

    await expect(wrapped?.({ page: 1 }, { extra: 'keep' })).resolves.toEqual({
      ok: true,
    });
    expect(original).toHaveBeenLastCalledWith(
      { page: 1 },
      {
        extra: 'keep',
        keyword: '第一版',
      },
    );

    formValues = { keyword: '第二版' };
    await wrapped?.({ page: 2 }, {});
    expect(original).toHaveBeenLastCalledWith(
      { page: 2 },
      {
        keyword: '第二版',
      },
    );
  });

  it('刷新按钮传来的 PointerEvent 不并入请求参数', /** PointerEvent 自带大量内部字段，直接展开会污染后端查询条件。 */ async () => {
    const api = new VxeGridApi();
    const original = createAjaxHandler();

    extendProxyOptions(
      api,
      {
        proxyConfig: { ajax: { query: original } },
      } as unknown as ProxyOptions,
      /** 固定返回一条筛选条件，便于识别表单值是否单独注入。 */ () => ({
        keyword: '预算',
      }),
    );

    const pointerEvent = new PointerEvent('pointerdown');
    await readWrapped(api, 'query')?.({ page: 1 }, pointerEvent);

    const received = original.mock.calls[0]?.[1];
    expect(received).toEqual({ keyword: '预算' });
    expect(received).not.toBe(pointerEvent);
  });

  it('其余位置参数原样透传', /** 代理回调的额外参数属于 vxe-table 约定，包装层不能截断。 */ async () => {
    const api = new VxeGridApi();
    const original = createAjaxHandler();

    extendProxyOptions(
      api,
      {
        proxyConfig: { ajax: { query: original } },
      } as unknown as ProxyOptions,
      /** 本用例不注入表单条件，聚焦位置参数透传。 */ () => ({}),
    );

    await readWrapped(api, 'query')?.({ page: 3 }, {}, { from: 'refresh' });

    expect(original).toHaveBeenLastCalledWith(
      { page: 3 },
      {},
      {
        from: 'refresh',
      },
    );
  });

  it('原回调抛错时原样向上传递', /** 吞掉后端错误会让页面误判请求成功。 */ async () => {
    const api = new VxeGridApi();
    const failure = new Error('后端拒绝查询');
    const original = vi.fn(
      /** 直接抛出后端失败，验证包装层不吞异常。 */ async () => {
        throw failure;
      },
    );

    extendProxyOptions(
      api,
      {
        proxyConfig: { ajax: { query: original } },
      } as unknown as ProxyOptions,
      /** 本用例不注入表单条件。 */ () => ({}),
    );

    await expect(readWrapped(api, 'query')?.({}, {})).rejects.toBe(failure);
  });

  it('六条代理链路都被包装，缺失的回调不写入状态', /** 少包装一条会让该链路的请求丢失筛选条件，缺失回调则不应凭空创建。 */ () => {
    const api = new VxeGridApi();
    const ajax = {
      query: createAjaxHandler(),
      queryAll: createAjaxHandler(),
      queryAllError: createAjaxHandler(),
      queryAllSuccess: createAjaxHandler(),
      queryError: createAjaxHandler(),
      querySuccess: createAjaxHandler(),
    };

    extendProxyOptions(
      api,
      { proxyConfig: { ajax } } as unknown as ProxyOptions,
      /** 本用例只验证包装结果，不注入表单条件。 */ () => ({}),
    );

    for (const [key, original] of Object.entries(ajax)) {
      expect(readWrapped(api, key)).toBeTypeOf('function');
      expect(readWrapped(api, key)).not.toBe(original);
    }

    const apiWithoutHandler = new VxeGridApi();
    extendProxyOptions(
      apiWithoutHandler,
      {
        proxyConfig: { ajax: { query: createAjaxHandler() } },
      } as unknown as ProxyOptions,
      /** 本用例只验证缺失回调不被创建。 */ () => ({}),
    );
    expect(
      (
        apiWithoutHandler.state?.gridOptions?.proxyConfig as {
          ajax?: Record<string, unknown>;
        }
      )?.ajax?.querySuccess,
    ).toBeUndefined();
  });

  it('没有 proxyConfig 时不做任何改写', /** 未配置代理的表格不能因为扩展抛错或写入空配置。 */ () => {
    const api = new VxeGridApi({
      gridOptions: { columns: [{ field: 'name', title: '部门' }] },
    });

    expect(
      /** 未配置代理时扩展不应抛出，也不应写入空配置。 */
      () =>
        extendProxyOptions(
          api,
          {} as ProxyOptions,
          /** 本用例不注入表单条件。 */ () => ({}),
        ),
    ).not.toThrow();
    expect(api.state?.gridOptions?.proxyConfig).toBeUndefined();
    expect(api.state?.gridOptions?.columns).toEqual([
      { field: 'name', title: '部门' },
    ]);
  });
});

describe('extendsDefaultFormatter', /** 默认格式化器决定日期列在表格里的显示口径。 */ () => {
  it('注册日期与日期时间格式化器并返回真实格式化结果', /** 注册名写错会让列配置里的 formatter 失效，日期列显示原始值。 */ () => {
    const registrations = new Map<string, TableCellFormatter>();

    /**
     * 记录格式化器注册，供断言注册名与真实格式化结果。
     * @param name 格式化器注册名。
     * @param handler 该格式化器的表格单元格实现。
     */
    function registerFormatter(name: string, handler: TableCellFormatter) {
      registrations.set(name, handler);
    }

    const vxeUI = { formats: { add: registerFormatter } };

    extendsDefaultFormatter(vxeUI as unknown as VxeUIExport);

    expect([...registrations.keys()]).toEqual(['formatDate', 'formatDateTime']);

    const cellValue = '2024-03-05 06:07:08';
    expect(
      registrations.get('formatDate')?.tableCellFormatMethod({ cellValue }),
    ).toBe(formatDate(cellValue));
    expect(
      registrations.get('formatDateTime')?.tableCellFormatMethod({ cellValue }),
    ).toBe(formatDateTime(cellValue));

    // 空值边界：无日期时返回空串，而不是 "Invalid Date"。
    expect(
      registrations.get('formatDate')?.tableCellFormatMethod({ cellValue: '' }),
    ).toBe('');
  });
});
