/**
 * 请求客户端参数编码、基础地址、排序字段与业务失败解包（request-client.ts）的公开契约回归。
 *
 * 这些行为分别影响列表查询的实际 URL、跨环境基地址、后端排序参数与错误链的最终抛出物：
 * 参数编码写错会让后端解析不到数组，业务失败解包写错会让调用方拿到 Axios 外壳而不是业务码。
 * 用例使用真实 Axios 实例与真实拦截器，只在传输边界使用 axios-mock-adapter。
 */
import type { AxiosRequestConfig } from 'axios';

import MockAdapter from 'axios-mock-adapter';
import { describe, expect, it } from 'vitest';

import { defaultResponseInterceptor } from './preset-interceptors';
import { buildSortingField, RequestClient } from './request-client';

/** 读取实例上真实生效的参数编码函数；未配置函数时直接失败，避免静默跳过断言。 */
function readParamsSerializer(client: RequestClient) {
  const serializer = client.instance.defaults.paramsSerializer;
  if (typeof serializer !== 'function') {
    throw new TypeError('实例未配置参数编码函数');
  }
  return serializer;
}

/** 用例统一的数组参数夹具，用于区分四种数组编码风格。 */
const arrayParams = { ids: [1, 2], name: 'a' };

describe('参数序列化预设', /** 编码风格必须与后端约定一致，写错会让数组参数解析失败。 */ () => {
  it.each([
    ['brackets', 'ids%5B%5D=1&ids%5B%5D=2&name=a'],
    ['comma', 'ids=1%2C2&name=a'],
    ['indices', 'ids%5B0%5D=1&ids%5B1%5D=2&name=a'],
    ['repeat', 'ids=1&ids=2&name=a'],
  ])(
    '预设 %s 使用对应的 qs 数组编码',
    /** 逐项核对真实 qs 输出，避免预设名与编码风格错配。 */ (
      preset,
      expected,
    ) => {
      // axios 的 paramsSerializer 声明是函数与预设名的交叉类型，预设名在运行期受支持，
      // 类型上无法直接表达，这里按 axios 的配置类型收窄。
      const client = new RequestClient({
        paramsSerializer: preset as AxiosRequestConfig['paramsSerializer'],
      });

      expect(readParamsSerializer(client)(arrayParams)).toBe(expected);
    },
  );

  it('未启用参数序列化时默认使用重复键编码', /** 默认值变化会静默改变全部请求的查询串格式。 */ () => {
    const client = new RequestClient();

    expect(readParamsSerializer(client)(arrayParams)).toBe(
      'ids=1&ids=2&name=a',
    );
  });

  it('未知预设名与自定义编码函数原样交给 Axios', /** 不能把未识别的配置替换成默认编码，否则调用方的自定义逻辑被吞掉。 */ () => {
    const unknownPreset = new RequestClient({
      paramsSerializer: 'unknown' as AxiosRequestConfig['paramsSerializer'],
    });
    /** 自定义编码函数，用于确认实例配置保留调用方传入的引用。 */
    const custom = () => 'custom=1';
    const customClient = new RequestClient({ paramsSerializer: custom });

    expect(unknownPreset.instance.defaults.paramsSerializer).toBe('unknown');
    expect(customClient.instance.defaults.paramsSerializer).toBe(custom);
  });
});

describe('基础地址读取', /** getBaseUrl 供上传下载拼接绝对地址，读取错误会让资源请求打到错误域名。 */ () => {
  it('返回实例上真实生效的 baseURL', /** 断言读取结果而非传入值，证明读取的是 Axios 实例配置。 */ () => {
    const client = new RequestClient({ baseURL: '/admin-api' });

    expect(client.getBaseUrl()).toBe('/admin-api');
  });

  it('未配置基地址时返回 undefined', /** 相对地址请求依赖该空值语义，不能伪造空字符串。 */ () => {
    const client = new RequestClient();

    expect(client.getBaseUrl()).toBeUndefined();
  });
});

describe('表格排序字段转换', /** 后端按索引参数读取排序条件，索引错位会让排序作用到错误字段。 */ () => {
  it('空条件返回空对象', /** 未排序时不能向后端发送空索引参数。 */ () => {
    expect(buildSortingField([])).toEqual({});
  });

  it('无排序条件参数时同样返回空对象', /** 上层可能直接传入可选值，缺失时必须安全退回空条件。 */ () => {
    const missing = undefined as unknown as Parameters<
      typeof buildSortingField
    >[0];

    expect(buildSortingField(missing)).toEqual({});
  });

  it('按顺序生成带索引的字段与方向', /** 索引必须与数组顺序一致，并保留 null 方向表达默认排序。 */ () => {
    const sorts = [
      { field: 'createTime', order: 'desc' },
      { field: 'name', order: null },
    ];

    expect(buildSortingField(sorts)).toEqual({
      'sortingFields[0].field': 'createTime',
      'sortingFields[0].order': 'desc',
      'sortingFields[1].field': 'name',
      'sortingFields[1].order': null,
    });
    // 转换只读入参，不得改动调用方持有的排序条件。
    expect(sorts).toEqual([
      { field: 'createTime', order: 'desc' },
      { field: 'name', order: null },
    ]);
  });
});

describe('业务失败解包', /** 调用方依赖一致失败形态做提示与分支，解包错误会拿到无法识别的错误对象。 */ () => {
  it('业务码失败时抛出业务数据体', /** 标准业务失败必须解包为后端返回体，而不是保留 Axios 外壳。 */ async () => {
    const client = new RequestClient({ responseReturn: 'data' });
    const transport = new MockAdapter(client.instance);
    client.addResponseInterceptor(
      defaultResponseInterceptor({
        codeField: 'code',
        dataField: 'data',
        successCode: 0,
      }),
    );
    transport.onGet('/business').reply(200, { code: 500, message: '业务失败' });

    await expect(client.get('/business')).rejects.toEqual({
      code: 500,
      message: '业务失败',
    });
    transport.restore();
  });

  it('非业务对象的传输失败保留原始 Axios 错误', /** 字符串或字节体不能替代传输异常，否则调用方丢失状态码。 */ async () => {
    const client = new RequestClient();
    const transport = new MockAdapter(client.instance);
    transport.onGet('/server-error').reply(500, 'server down');

    await expect(client.get('/server-error')).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 500 },
    });
    transport.restore();
  });
});
