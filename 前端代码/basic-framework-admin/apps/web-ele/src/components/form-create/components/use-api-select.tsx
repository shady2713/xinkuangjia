import type { ApiSelectProps } from '#/components/form-create/typing';

import { defineComponent, onMounted, ref, useAttrs } from 'vue';

import { useUserStore } from '@vben/stores';
import { isEmpty, logWarn } from '@vben/utils';

import {
  ElCheckbox,
  ElCheckboxGroup,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
} from 'element-plus';

import { requestClient } from '#/api/request';

import {
  mapApiSelectOptions,
  parseApiSelectMapping,
} from './api-select-mapping';

/**
 * 创建由接口数据驱动的选择组件。
 * @param option 组件名称、接口和默认字段配置
 * @return Vue 选择组件定义；请求失败由统一请求客户端处理
 */
export function useApiSelect(option: ApiSelectProps) {
  return defineComponent({
    name: option.name,
    props: {
      // 选项标签
      labelField: {
        type: String,
        default: () => option.labelField ?? 'label',
      },
      // 选项的值
      valueField: {
        type: String,
        default: () => option.valueField ?? 'value',
      },
      // api 接口
      url: {
        type: String,
        default: () => option.url ?? '',
      },
      // 请求类型
      method: {
        type: String,
        default: 'GET',
      },
      // 选项解析函数
      parseFunc: {
        type: String,
        default: '',
      },
      // 请求参数
      data: {
        type: String,
        default: '',
      },
      // 选择器类型，下拉框 select、多选框 checkbox、单选框 radio
      selectType: {
        type: String,
        default: 'select',
      },
      // 是否多选
      multiple: {
        type: Boolean,
        default: false,
      },
      // 是否远程搜索
      remote: {
        type: Boolean,
        default: false,
      },
      // 远程搜索时携带的参数
      remoteField: {
        type: String,
        default: 'label',
      },
      // 返回值类型（用于部门选择器等）：id 返回 ID，name 返回名称
      returnType: {
        type: String,
        default: 'id',
      },
      // 是否默认选中当前用户（仅用于 UserSelect）
      defaultCurrentUser: {
        type: Boolean,
        default: false,
      },
    },
    setup(props, { emit }) {
      const attrs = useAttrs();
      const options = ref<any[]>([]); // 下拉数据
      const loading = ref(false); // 是否正在从远程获取数据
      const queryParam = ref<any>(); // 当前输入的值
      let hasWarnedLegacyMapping = false;
      const warn = (message: string) => {
        if (!import.meta.env.DEV) {
          return;
        }
        logWarn('api-select', message);
      };

      // 检查是否有有效的预设值
      function hasValidPresetValue(): boolean {
        const value = attrs.modelValue;
        if (value === undefined || value === null || value === '') {
          return false;
        }
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        return true;
      }

      // 设置默认当前用户
      function setDefaultCurrentUser(): void {
        if (option.name !== 'UserSelect' || !props.defaultCurrentUser) {
          return;
        }
        if (hasValidPresetValue()) {
          return;
        }
        const userStore = useUserStore();
        const currentUserId = userStore.userInfo?.id;
        if (currentUserId) {
          const defaultValue = props.multiple ? [currentUserId] : currentUserId;
          emit('update:modelValue', defaultValue);
        }
      }

      function parseExpression(data: any, template: string) {
        // 检测是否使用了表达式
        if (!template.includes('${')) {
          return data[template];
        }
        // 正则表达式匹配模板字符串中的 ${...}
        const pattern = /\$\{([^}]*)\}/g;
        // 使用 replace 函数配合正则表达式和回调函数来进行替换
        return template.replaceAll(pattern, (_, expr) => {
          // expr 是匹配到的 ${} 内的表达式（这里是属性名），从 data 中获取对应的值
          const result = data[expr.trim()]; // 去除前后空白，以防用户输入带空格的属性名
          if (!result) {
            warn(
              `接口选择器模板[${template}] 解析字段[${expr.trim()}] 失败，请检查接口返回值字段是否存在`,
            );
          }
          return result;
        });
      }

      function parseOptions0(data: any[]) {
        if (Array.isArray(data)) {
          options.value = data.map((item: any) => {
            const label = parseExpression(item, props.labelField);
            let value = parseExpression(item, props.valueField);

            // 根据 returnType 决定返回值
            // 如果设置了 returnType 为 'name'，则返回 label 作为 value
            if (props.returnType === 'name') {
              value = label;
            }

            return {
              label,
              value,
            };
          });
          return;
        }
        warn(`接口[${props.url}] 返回结果不是一个数组`);
      }

      function parseOptions(data: any) {
        // parseFunc 是历史持久化字段名；现在只解析声明式规则，绝不执行其中的 JavaScript。
        if (!isEmpty(props.parseFunc)) {
          const result = parseApiSelectMapping(props.parseFunc);
          if (!result.mapping) {
            options.value = [];
            warn(`接口选择器映射配置无效：${result.reason}`);
            return;
          }
          const mappedOptions = mapApiSelectOptions(data, result.mapping);
          if (!mappedOptions) {
            options.value = [];
            warn(
              `接口[${props.url}] 未在路径[${result.mapping.listPath || '根节点'}]找到数组`,
            );
            return;
          }
          options.value = mappedOptions;
          if (result.migrated && !hasWarnedLegacyMapping) {
            hasWarnedLegacyMapping = true;
            warn('已安全迁移旧版简单 map 配置，请保存为 JSON 字段映射');
          }
          return;
        }
        // 情况二：返回的直接是一个列表
        if (Array.isArray(data)) {
          parseOptions0(data);
          return;
        }
        // 情况三：返回的是分页数据，尝试读取 list
        data = data.list;
        if (!!data && Array.isArray(data)) {
          parseOptions0(data);
          return;
        }
        // 情况四：返回结果不符合默认约定
        warn(
          `接口[${props.url}] 返回结果不符合默认约定，建议使用自定义解析函数处理`,
        );
      }

      const getOptions = async () => {
        options.value = [];
        // 接口选择器
        if (isEmpty(props.url)) {
          return;
        }

        switch (props.method) {
          case 'GET': {
            let url: string = props.url;
            if (props.remote && queryParam.value !== undefined) {
              url = url.includes('?')
                ? `${url}&${props.remoteField}=${queryParam.value}`
                : `${url}?${props.remoteField}=${queryParam.value}`;
            }
            parseOptions(await requestClient.get(url));
            break;
          }
          case 'POST': {
            const data: any = JSON.parse(props.data);
            if (props.remote) {
              data[props.remoteField] = queryParam.value;
            }
            parseOptions(await requestClient.post(props.url, data));
            break;
          }
          default: {
            break;
          }
        }
      };

      const remoteMethod = async (query: any) => {
        if (!query) {
          return;
        }
        loading.value = true;
        try {
          queryParam.value = query;
          await getOptions();
        } finally {
          loading.value = false;
        }
      };

      onMounted(async () => {
        await getOptions();
        // 设置默认当前用户（仅用于 UserSelect）
        setDefaultCurrentUser();
      });

      const buildSelect = () => {
        if (props.multiple) {
          return (
            <ElSelect
              class="w-1/1"
              loading={loading.value}
              multiple
              {...attrs}
              filterable={props.remote}
              remote={props.remote}
              {...(props.remote && { remoteMethod })}
            >
              {options.value.map(
                (item: { label: any; value: any }, index: any) => (
                  <ElOption key={index} label={item.label} value={item.value} />
                ),
              )}
            </ElSelect>
          );
        }
        return (
          <ElSelect
            class="w-1/1"
            loading={loading.value}
            {...attrs}
            filterable={props.remote}
            remote={props.remote}
            {...(props.remote && { remoteMethod })}
          >
            {options.value.map(
              (item: { label: any; value: any }, index: any) => (
                <ElOption key={index} label={item.label} value={item.value} />
              ),
            )}
          </ElSelect>
        );
      };
      const buildCheckbox = () => {
        if (isEmpty(options.value)) {
          options.value = [
            { label: '选项1', value: '选项1' },
            { label: '选项2', value: '选项2' },
          ];
        }
        return (
          <ElCheckboxGroup class="w-1/1" {...attrs}>
            {options.value.map(
              (item: { label: any; value: any }, index: any) => (
                <ElCheckbox key={index} label={item.value}>
                  {item.label}
                </ElCheckbox>
              ),
            )}
          </ElCheckboxGroup>
        );
      };
      const buildRadio = () => {
        if (isEmpty(options.value)) {
          options.value = [
            { label: '选项1', value: '选项1' },
            { label: '选项2', value: '选项2' },
          ];
        }
        return (
          <ElRadioGroup class="w-1/1" {...attrs}>
            {options.value.map(
              (item: { label: any; value: any }, index: any) => (
                <ElRadio key={index} label={item.value}>
                  {item.label}
                </ElRadio>
              ),
            )}
          </ElRadioGroup>
        );
      };
      return () => (
        <>
          {(() => {
            switch (props.selectType) {
              case 'checkbox': {
                return buildCheckbox();
              }
              case 'radio': {
                return buildRadio();
              }
              case 'select': {
                return buildSelect();
              }
              default: {
                return buildSelect();
              }
            }
          })()}
        </>
      );
    },
  });
}
