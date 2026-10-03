/** 验证请求默认 unknown 暴露出的部门及任务时间接口边界。 */
import { describe, expect, it, vi } from 'vitest';

import { getSimpleDictDataList, getSimpleDictTypeList } from './core/dict';
import { getJobNextTimes } from './infra/job';
import { getDeptList } from './system/dept';

const get = vi.hoisted(/** 只替换 HTTP 读取边界。 */ () => vi.fn());
vi.mock(
  '#/api/request',
  /** 保留真实 API 的解析与失败行为。 */ () => ({ requestClient: { get } }),
);

describe('列表和时间运行时契约', /** 错误传输值必须在进入组件或树工具前拒绝。 */ () => {
  it('精简字典不要求完整管理接口字段，样式 null 转为空值', /** 实际 VO 只有字典标识、标签、值及样式。 */ async () => {
    get.mockResolvedValueOnce([
      {
        dictType: 'state',
        label: 'Ready',
        value: '0',
        colorType: null,
        cssClass: null,
      },
    ]);
    await expect(getSimpleDictDataList()).resolves.toEqual([
      {
        dictType: 'state',
        label: 'Ready',
        value: '0',
        colorType: '',
        cssClass: '',
      },
    ]);
    get.mockResolvedValueOnce([{ id: 1, name: 'State', type: 'state' }]);
    await expect(getSimpleDictTypeList()).resolves.toEqual([
      { id: 1, name: 'State', type: 'state' },
    ]);
  });
  it('字典值和类型编号无效时拒绝整个精简响应', /** 禁止用泛型把对象、布尔值或失真编号交给缓存与选择器。 */ async () => {
    get.mockResolvedValueOnce([
      { dictType: 'state', label: 'Ready', value: false },
    ]);
    await expect(getSimpleDictDataList()).rejects.toThrow('精简字典字段无效');
    get.mockResolvedValueOnce([
      { id: Number.MAX_SAFE_INTEGER + 1, name: 'State', type: 'state' },
    ]);
    await expect(getSimpleDictTypeList()).rejects.toThrow(
      '精简字典类型字段无效',
    );
  });
  it('部门完整列表保留毫秒时间并规范化可空展示字段', /** 后端没有返回 Date 实例，也不保证空展示字段是字符串。 */ async () => {
    get.mockResolvedValueOnce([
      {
        id: 1,
        parentId: 0,
        name: 'Dept',
        status: 0,
        sort: 1,
        leaderUserId: null,
        phone: null,
        email: null,
        createTime: 1_900_000_000_000,
      },
    ]);
    await expect(getDeptList()).resolves.toEqual([
      {
        id: 1,
        parentId: 0,
        name: 'Dept',
        status: 0,
        sort: 1,
        leaderUserId: null,
        phone: '',
        email: '',
        createTime: 1_900_000_000_000,
      },
    ]);
  });
  it.each([{}, [null], [{ id: Number.MAX_SAFE_INTEGER + 1 }]])(
    '拒绝无法用于部门树的结果：%s',
    /** 数组与单项记录都需要验证。 */ async (value) => {
      get.mockResolvedValueOnce(value);
      await expect(getDeptList()).rejects.toBeInstanceOf(TypeError);
    },
  );
  it('后续任务时间接受空列表和毫秒整数', /** 任务不存在的合法空结果不应误报失败。 */ async () => {
    get.mockResolvedValueOnce([]).mockResolvedValueOnce([1_900_000_000_000]);
    await expect(getJobNextTimes(1)).resolves.toEqual([]);
    await expect(getJobNextTimes(1)).resolves.toEqual([1_900_000_000_000]);
  });
  it.each([null, ['2026-10-02'], [1.5], [Number.MAX_SAFE_INTEGER + 1]])(
    '拒绝非毫秒时间结果：%s',
    /** 接口声明不能把任意数据伪装成日期数组。 */ async (value) => {
      get.mockResolvedValueOnce(value);
      await expect(getJobNextTimes(1)).rejects.toBeInstanceOf(TypeError);
    },
  );
});
