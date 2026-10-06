/** 验证并缓存字典展示值；异步更新维持身份所有权且拒绝部分非法结果。 */
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

/** 已按字典类型分组的本地缓存。 */
interface DictState {
  dictCache: Dict;
}

/** 按字典类型缓存展示数据，异步写入可绑定调用会话。 */
export const useDictStore = defineStore('core-dict', {
  actions: {
    /** 查找可安全字符串化的字典值，空值及对象不会执行自定义转换。
     * @param dictType 字典类型标识。
     * @param value 表格或表单提供的未知展示值。
     * @returns 匹配的字典项，无有效原始值或没有匹配时返回 undefined。
     */
    getDictData(dictType: string, value: unknown) {
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      )
        return undefined;
      if (!Object.hasOwn(this.dictCache, dictType)) return undefined;
      const dict = this.dictCache[dictType];
      if (!dict) {
        return undefined;
      }
      return (
        dict.find(
          /** 用已确认的原始类型匹配服务端字符串值。 */ (d) =>
            d.value === String(value),
        ) ?? undefined
      );
    },
    /** 读取本缓存拥有的字典数组，继承属性不属于字典内容。
     * @param dictType 请求的字典类型。
     * @returns 已缓存的字典数组，缺失时为空数组。
     */
    getDictOptions(dictType: string) {
      if (!Object.hasOwn(this.dictCache, dictType)) return [];
      const dictOptions = this.dictCache[dictType];
      if (!dictOptions) {
        return [];
      }
      return dictOptions;
    },
    /**
     * 覆盖整个字典缓存，写入内容会随 persist 一并落到本地存储。
     * @param dicts - 字典类型到字典项数组的完整映射，直接替换而不合并；
     *   未出现在入参中的字典类型会被一并清空。
     */
    setDictCache(dicts: Dict) {
      this.dictCache = dicts;
    },
    /** 获取并转换字典，仅在调用者仍持有当前会话时写入。
     * @param api 获取原始字典项的接口。
     * @param params 接口查询条件。
     * @param labelField 展示文本字段。
     * @param valueField 字典值字段。
     * @param isCurrent 写入前的生命周期校验；过期结果直接丢弃。
     * @returns 请求与条件写入完成；请求失败由调用方处理。
     * @throws {TypeError} 响应不是数组或任一字典字段无效，保留原缓存。
     */
    async setDictCacheByApi(
      api: /** 依据查询参数获取原始字典列表。 */ (
        params: Record<string, unknown>,
      ) => Promise<unknown>,
      params: Record<string, unknown> = {},
      labelField: string = 'label',
      valueField: string = 'value',
      isCurrent: /** 写入前查询调用者的生命周期。 */ () => boolean = /** 无额外生命周期约束时允许当前调用写入。 */ () =>
        true,
    ) {
      const dicts = await api(params);
      if (isCurrent()) {
        if (!Array.isArray(dicts)) throw new TypeError('字典响应必须是数组');
        const groups = new Map<string, DictItem[]>();
        for (const dict of dicts) {
          const item: unknown = dict;
          if (typeof item !== 'object' || item === null || Array.isArray(item))
            throw new TypeError('字典项必须是对象');
          const fields: Record<string, unknown> = { ...item };
          const label = fields[labelField];
          const value = fields[valueField];
          if (
            typeof fields.dictType !== 'string' ||
            typeof label !== 'string' ||
            typeof value !== 'string' ||
            (fields.colorType !== undefined &&
              fields.colorType !== null &&
              typeof fields.colorType !== 'string') ||
            (fields.cssClass !== undefined &&
              fields.cssClass !== null &&
              typeof fields.cssClass !== 'string')
          )
            throw new TypeError('字典字段类型无效');
          const items = groups.get(fields.dictType) ?? [];
          items.push({
            label,
            value,
            colorType: fields.colorType ?? undefined,
            cssClass: fields.cssClass ?? undefined,
          });
          groups.set(fields.dictType, items);
        }
        if (isCurrent()) this.setDictCache(Object.fromEntries(groups));
      }
    },
  },
  persist: {
    // 持久化
    pick: ['dictCache'],
  },
  /** store 初始状态：空字典缓存，实际内容由 setDictCache 系列方法或持久化恢复填充。 */
  state: (): DictState => ({
    dictCache: {},
  }),
});

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useDictStore, hot));
}
