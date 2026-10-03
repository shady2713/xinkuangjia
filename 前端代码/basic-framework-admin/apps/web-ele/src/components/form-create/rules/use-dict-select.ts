/** 字典选择器的设计器规则：字典类型下拉需要异步加载，因此不复用通用选择器规则。 */
import type { SystemDictTypeApi } from '#/api/core/dict';
import type { FormCreatePropsContext } from '#/components/form-create/typing';

import { onMounted, ref } from 'vue';

import { buildUUID, cloneDeep } from '@vben/utils';

import { getSimpleDictTypeList } from '#/api/core/dict';
import {
  localeProps,
  makeRequiredRule,
} from '#/components/form-create/helpers';
import { selectRule } from '#/components/form-create/rules/data';

/**
 * 字典选择器规则，如果规则使用到动态数据则需要单独配置不能使用 useSelectRule
 * @returns form-create 设计器注册项；挂载时会拉取字典类型列表填充属性面板下拉
 */
export function useDictSelectRule() {
  const label = '字典选择器';
  const name = 'DictSelect';
  const rules = cloneDeep(selectRule);
  const dictOptions = ref<{ label: string; value: string }[]>([]); // 字典类型下拉数据
  onMounted(async () => {
    const data = await getSimpleDictTypeList();
    if (!data || data.length === 0) {
      return;
    }
    dictOptions.value =
      data?.map((item: SystemDictTypeApi.DictType) => ({
        label: item.name,
        value: item.type,
      })) ?? [];
  });
  return {
    icon: 'icon-descriptions',
    label,
    name,
    rule() {
      return {
        type: name,
        field: buildUUID(),
        title: label,
        info: '',
        $required: false,
        modelField: 'model-value', // 当前表单运行时使用 model-value 作为字段绑定名
      };
    },
    /**
     * 生成字典选择器的属性面板配置行。
     * @param _name form-create 传入的目标组件名，本工程按闭包中的 name 取配置故不使用
     * @param context 设计器上下文，只取其中的 t 翻译函数
     * @returns 已完成文案国际化的属性面板配置行数组，字典类型下拉取自接口数据
     */
    props(_name: string, context: FormCreatePropsContext) {
      const { t } = context;
      return localeProps(t, `${name}.props`, [
        makeRequiredRule(),
        {
          type: 'select',
          field: 'dictType',
          title: '字典类型',
          value: '',
          options: dictOptions.value,
        },
        {
          type: 'select',
          field: 'valueType',
          title: '字典值类型',
          value: 'str',
          options: [
            { label: '数字', value: 'int' },
            { label: '字符串', value: 'str' },
            { label: '布尔值', value: 'bool' },
          ],
        },
        ...rules,
      ]);
    },
  };
}
