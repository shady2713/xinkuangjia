/**
 * 字典读取工具：从字典 store 的本地缓存取标签、字典项与下拉选项。
 *
 * 只读缓存并做值类型转换，不发起字典请求；
 * 缓存由路由守卫在权限校验后写入，字典的增删改查接口在 system/dict 模块。
 */
import { useDictStore } from '@vben/stores';
import { isObject } from '@vben/utils';

/** 字典项在界面上的语义色，与 Element Plus 标签的 type 取值一致。 */
type ColorType = 'error' | 'info' | 'success' | 'warning';

/** 字典项的通用结构：value 为存储值，label 为展示文本，colorType 与 cssClass 控制样式。 */
export interface DictDataType {
  dictType?: string;
  label: string;
  value: boolean | number | string;
  colorType?: ColorType;
  cssClass?: string;
}

/** value 已收窄为数字的字典项，可直接参与数值比较与计算。 */
export interface NumberDictDataType extends DictDataType {
  value: number;
}

/** value 已收窄为字符串的字典项，可直接用于文本比较与展示。 */
export interface StringDictDataType extends DictDataType {
  value: string;
}

/**
 * 获取字典标签
 *
 * @param dictType 字典类型
 * @param value 字典值
 * @returns 字典标签
 */
export function getDictLabel(dictType: string, value: unknown) {
  const dictStore = useDictStore();
  const dictObj = dictStore.getDictData(dictType, value);
  return isObject(dictObj) ? dictObj.label : '';
}

/**
 * 获取字典对象
 *
 * @param dictType 字典类型
 * @param value 字典值
 * @returns 字典对象
 */
export function getDictObj(dictType: string, value: unknown) {
  const dictStore = useDictStore();
  const dictObj = dictStore.getDictData(dictType, value);
  return isObject(dictObj) ? dictObj : null;
}

/**
 * 获取字典数组 用于select radio 等
 *
 * @param dictType 字典类型
 * @param valueType 字典值类型，默认 string 类型
 * @returns 字典数组
 */
export function getDictOptions(
  dictType: string,
  valueType: 'boolean' | 'number' | 'string' = 'string',
): DictDataType[] {
  const dictStore = useDictStore();
  const dictOpts = dictStore.getDictOptions(dictType);
  const dictOptions: DictDataType[] = [];
  if (dictOpts.length > 0) {
    let dictValue: boolean | number | string = '';
    dictOpts.forEach((d) => {
      switch (valueType) {
        case 'boolean': {
          dictValue = `${d.value}` === 'true';
          break;
        }
        case 'number': {
          dictValue = Number.parseInt(`${d.value}`);
          break;
        }
        case 'string': {
          dictValue = `${d.value}`;
          break;
        }
        // No default
      }
      dictOptions.push({
        value: dictValue,
        label: d.label,
      });
    });
  }
  return dictOptions.length > 0 ? dictOptions : [];
}
