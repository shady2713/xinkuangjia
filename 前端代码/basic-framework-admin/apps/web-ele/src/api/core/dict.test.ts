/** 字典精简接口的响应契约测试：验证可空样式字段的规范化与必需字段的拒绝口径。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import { getSimpleDictDataList, getSimpleDictTypeList } from './dict';

vi.mock(
  '#/api/request',
  /** 只替换网络边界，保留接口自身的字段校验逻辑。 */ () => ({
    requestClient: { get: vi.fn() },
  }),
);

describe('getSimpleDictDataList 响应契约', /** 路由缓存依赖的字典数据必须字段完整、样式可空。 */ () => {
  beforeEach(
    /** 每例独立提供响应，不继承上例结果。 */ () => vi.resetAllMocks(),
  );

  it('保留字符串形式的下拉样式字段', /** colorType 与 cssClass 有值时必须原样交给路由缓存，不能被空串覆盖。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue([
      {
        colorType: 'success',
        cssClass: 'text-green-500',
        dictType: 'system_user_sex',
        label: '男',
        value: '1',
      },
    ]);

    await expect(getSimpleDictDataList()).resolves.toEqual([
      {
        colorType: 'success',
        cssClass: 'text-green-500',
        dictType: 'system_user_sex',
        label: '男',
        value: '1',
      },
    ]);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/dict-data/simple-list',
    );
  });

  it.each([
    ['colorType 为数字', { colorType: 1 }],
    ['cssClass 为对象', { cssClass: {} }],
  ])(
    '拒绝%s的字典项',
    /** 非字符串样式会让表格渲染出非法 class，必须在入口拒绝。 */ async (
      _name,
      patch,
    ) => {
      vi.mocked(requestClient.get).mockResolvedValue([
        {
          colorType: null,
          cssClass: null,
          dictType: 'system_user_sex',
          label: '男',
          value: '1',
          ...patch,
        },
      ]);

      await expect(getSimpleDictDataList()).rejects.toThrow('精简字典字段无效');
    },
  );

  it('拒绝缺少类型、标签或值的字典项', /** 精简 VO 的三个必需文本字段缺一不可。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue([{ label: '男' }]);

    await expect(getSimpleDictDataList()).rejects.toThrow('精简字典字段无效');
  });

  it('响应不是数组时拒绝', /** 传输值不能靠泛型声明保证是数组。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue({ data: [] });

    await expect(getSimpleDictDataList()).rejects.toThrow('字典数据必须是数组');
  });

  it('字典项不是对象时拒绝', /** 字符串等标量不能按字段读取。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue(['system_user_sex']);

    await expect(getSimpleDictDataList()).rejects.toThrow('精简字典字段无效');
  });
});

describe('getSimpleDictTypeList 响应契约', /** 表单设计器的字典类型选择器需要正整数编号与文本字段。 */ () => {
  beforeEach(
    /** 每例独立提供响应，不继承上例结果。 */ () => vi.resetAllMocks(),
  );

  it('接受正整数编号并只保留三个真实字段', /** 多余传输字段不能扩散到选择器数据。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue([
      {
        id: 7,
        name: '用户性别',
        type: 'system_user_sex',
        unexpected: 'ignored',
      },
    ]);

    await expect(getSimpleDictTypeList()).resolves.toEqual([
      { id: 7, name: '用户性别', type: 'system_user_sex' },
    ]);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/dict-type/list-all-simple',
    );
  });

  it.each([
    ['编号为零', { id: 0 }],
    ['编号为负数', { id: -1 }],
    ['编号超出安全整数', { id: Number.MAX_SAFE_INTEGER + 1 }],
    ['名称为数字', { name: 1 }],
    ['类型为对象', { type: {} }],
  ])(
    '拒绝%s的字典类型',
    /** 选择器依赖编号定位类型，非法编号会产生错误请求。 */ async (
      _name,
      patch,
    ) => {
      vi.mocked(requestClient.get).mockResolvedValue([
        { id: 7, name: '用户性别', type: 'system_user_sex', ...patch },
      ]);

      await expect(getSimpleDictTypeList()).rejects.toThrow(
        '精简字典类型字段无效',
      );
    },
  );

  it('响应不是数组时拒绝', /** 传输值不能靠泛型声明保证是数组。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue(null);

    await expect(getSimpleDictTypeList()).rejects.toThrow('字典类型必须是数组');
  });
});
