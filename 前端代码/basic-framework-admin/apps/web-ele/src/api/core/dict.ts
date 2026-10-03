/**
 * 字典精简查询接口：供路由守卫、表单设计器等核心功能加载字典缓存。
 * 核心组件通过此模块加载字典，系统管理页面的增删改接口仍由 system/dict 模块提供。
 */
import { isRecord } from '@vben/request';

import { requestClient } from '#/api/request';

/** 路由字典缓存使用的精简字典数据契约。 */
export namespace SystemDictDataApi {
  /** 字典数据 */
  export type DictData = {
    colorType: string;
    cssClass: string;
    dictType: string;
    label: string;
    value: string;
  };
}

/** 表单设计器字典选择器使用的字典类型契约。 */
export namespace SystemDictTypeApi {
  /** 字典类型 */
  export type DictType = {
    id: number;
    name: string;
    type: string;
  };
}

/**
 * 查询路由缓存所需的精简字典数据；请求失败由统一请求客户端处理。
 *
 * @returns 字典数据列表；无可用字典时返回空数组
 * @throws {TypeError} 传输结果不符合精简字典的实际字段契约。
 */
export async function getSimpleDictDataList(): Promise<
  SystemDictDataApi.DictData[]
> {
  const values = await requestClient.get<unknown>(
    '/system/dict-data/simple-list',
  );
  if (!Array.isArray(values)) throw new TypeError('字典数据必须是数组');
  return values.map(
    /** 只返回真实精简 VO 中存在的字典字段。
     * @param value 未验证的字典项。
     * @returns 样式字段已经规范化的字典项。
     * @throws {TypeError} 字典类型、标签、值或样式字段无效。
     */ (value: unknown) => {
      if (
        !isRecord(value) ||
        typeof value.dictType !== 'string' ||
        typeof value.label !== 'string' ||
        typeof value.value !== 'string' ||
        (value.colorType !== undefined &&
          value.colorType !== null &&
          typeof value.colorType !== 'string') ||
        (value.cssClass !== undefined &&
          value.cssClass !== null &&
          typeof value.cssClass !== 'string')
      )
        throw new TypeError('精简字典字段无效');
      return {
        dictType: value.dictType,
        label: value.label,
        value: value.value,
        colorType: value.colorType ?? '',
        cssClass: value.cssClass ?? '',
      };
    },
  );
}

/**
 * 查询表单设计器可选的字典类型；请求失败由统一请求客户端处理。
 *
 * @returns 字典类型列表；无可用类型时返回空数组
 * @throws {TypeError} 传输结果不符合精简类型字段契约。
 */
export async function getSimpleDictTypeList(): Promise<
  SystemDictTypeApi.DictType[]
> {
  const values = await requestClient.get<unknown>(
    '/system/dict-type/list-all-simple',
  );
  if (!Array.isArray(values)) throw new TypeError('字典类型必须是数组');
  return values.map(
    /** 对精简类型逐项确认编号与展示字段。
     * @param value 未验证的字典类型。
     * @returns 可供类型选择器使用的真实精简模型。
     * @throws {TypeError} 编号或文本字段无效。
     */ (value: unknown) => {
      if (
        !isRecord(value) ||
        typeof value.id !== 'number' ||
        !Number.isSafeInteger(value.id) ||
        value.id <= 0 ||
        typeof value.name !== 'string' ||
        typeof value.type !== 'string'
      )
        throw new TypeError('精简字典类型字段无效');
      return { id: value.id, name: value.name, type: value.type };
    },
  );
}
