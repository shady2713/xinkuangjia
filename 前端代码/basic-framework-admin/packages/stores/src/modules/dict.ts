/**
 * 字典缓存 Pinia Store：按 dictType 分组维护字典项，提供空值安全读取与请求失败隔离加载。
 */
import { logError } from '@vben-core/shared/utils';

import { acceptHMRUpdate, defineStore } from 'pinia';

/** 字典项数据结构 */
export interface DictItem {
  colorType?: string;
  cssClass?: string;
  label: string;
  value: string;
}

/** 字典类型到字典项数组的映射 */
export type Dict = Record<string, DictItem[]>;

interface DictState {
  dictCache: Dict;
}

/** 全局字典缓存 Store，供权限初始化、表单选项渲染及 DictTag 查询使用。 */
export const useDictStore = defineStore('core-dict', {
  actions: {
    /**
     * 按字典类型和值检索单个字典项；任一入参为空或类型缺失时安全返回 undefined。
     *
     * @param dictType 字典类型编码
     * @param value 待匹配的字典键值（可空）
     * @returns 命中的字典项或 undefined
     */
    getDictData(dictType: string, value: any): DictItem | undefined {
      if (!dictType || value === null || value === undefined) {
        return undefined;
      }
      const dict = this.dictCache[dictType];
      if (!dict) {
        return undefined;
      }
      const normalizedValue = String(value);
      return (
        dict.find((d) => d.value === value || d.value === normalizedValue) ??
        undefined
      );
    },
    /**
     * 读取指定字典类型下的全部字典项列表，不存在时返回空数组。
     *
     * @param dictType 字典类型编码
     * @returns 字典项数组
     */
    getDictOptions(dictType: string): DictItem[] {
      const dictOptions = this.dictCache[dictType];
      if (!dictOptions) {
        return [];
      }
      return dictOptions;
    },
    /**
     * 整体覆盖字典本地缓存映射。
     *
     * @param dicts 以字典类型为键的分组字典项集合
     */
    setDictCache(dicts: Dict) {
      this.dictCache = dicts;
    },
    /**
     * 调用后端精简字典接口并按 dictType 单次分组写入缓存，异常时捕获记录并保留原有缓存。
     *
     * @param api 拉取字典数据的异步接口函数
     * @param params 查询参数
     * @param labelField 标签字段名
     * @param valueField 键值字段名
     * @returns 拉取并更新成功返回 true，请求或数据异常时返回 false
     */
    async setDictCacheByApi(
      api: (params: Record<string, any>) => Promise<Record<string, any>[]>,
      params: Record<string, any> = {},
      labelField: string = 'label',
      valueField: string = 'value',
    ): Promise<boolean> {
      try {
        const dicts = await api(params);
        if (!Array.isArray(dicts)) {
          return false;
        }
        const dictCacheData: Dict = {};
        for (const d of dicts) {
          const type = d?.dictType;
          if (!type) {
            continue;
          }
          if (!dictCacheData[type]) {
            dictCacheData[type] = [];
          }
          dictCacheData[type].push({
            colorType: d.colorType,
            cssClass: d.cssClass,
            label: d[labelField],
            value: d[valueField],
          });
        }
        this.setDictCache(dictCacheData);
        return true;
      } catch (error) {
        logError('store:dict:load', error);
        return false;
      }
    },
  },
  persist: {
    // 持久化
    pick: ['dictCache'],
  },
  state: (): DictState => ({
    dictCache: {},
  }),
});

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useDictStore, hot));
}
