/**
 * 字典精简查询接口：供路由守卫、表单设计器等核心功能加载字典缓存。
 * 核心组件通过此模块加载字典，系统管理页面的增删改接口仍由 system/dict 模块提供。
 */
import { requestClient } from '#/api/request';

/** 路由字典缓存使用的精简字典数据契约。 */
export namespace SystemDictDataApi {
  /** 字典数据 */
  export type DictData = {
    colorType: string;
    createTime: Date;
    cssClass: string;
    dictType: string;
    id?: number;
    label: string;
    remark: string;
    sort?: number;
    status: number;
    value: string;
  };
}

/** 表单设计器字典选择器使用的字典类型契约。 */
export namespace SystemDictTypeApi {
  /** 字典类型 */
  export type DictType = {
    createTime: Date;
    id?: number;
    name: string;
    remark: string;
    status: number;
    type: string;
  };
}

/**
 * 查询路由缓存所需的精简字典数据；请求失败由统一请求客户端处理。
 *
 * @returns 字典数据列表；无可用字典时返回空数组
 */
export function getSimpleDictDataList() {
  return requestClient.get<SystemDictDataApi.DictData[]>(
    '/system/dict-data/simple-list',
  );
}

/**
 * 查询表单设计器可选的字典类型；请求失败由统一请求客户端处理。
 *
 * @returns 字典类型列表；无可用类型时返回空数组
 */
export function getSimpleDictTypeList() {
  return requestClient.get<SystemDictTypeApi.DictType[]>(
    '/system/dict-type/list-all-simple',
  );
}
