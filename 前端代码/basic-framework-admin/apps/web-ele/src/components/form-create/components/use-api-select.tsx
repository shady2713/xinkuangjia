/**
 * 接口驱动的通用选择器组件工厂。
 *
 * 组件按 url/method 拉取列表，再按 labelField/valueField（或 parseFunc 声明式映射）归一化成选项，
 * 按 selectType 渲染成下拉、单选或多选。远程搜索时把关键词拼进 GET 查询串或 POST 请求体。
 */
import type { ApiSelectOption } from './api-select-mapping';

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
  isRecord,
  mapApiSelectOptions,
  parseApiSelectMapping,
} from './api-select-mapping';

/**
 * 归一化后的选项，label 已是可展示文本，value 已是 Element Plus 允许的绑定形态。
 * @description 与 ApiSelectOption 的区别是：本类型已完成渲染收窄，模板里不再需要判断。
 */
interface NormalizedApiSelectOption {
  label: string;
  value: boolean | number | object | string;
}

/**
 * 把接口返回的标签值收敛成 Element Plus 可渲染的文本。
 * @description 标签只用于展示，因此只放行字符串和数字、布尔等标量；
 * 对象、数组、函数等复合值降级为空串，避免界面出现 [object Object] 之类的脏文案。
 * @param value 接口返回的原始标签值
 * @return 可直接渲染的展示文本；不可展示时为空串
 */
function toOptionText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return String(value);
  }
  return '';
}

/**
 * 把接口返回的选项值收敛到 Element Plus 允许的绑定形态。
 * @description 选项值要参与 v-model 回传和表单提交，因此原样保留字符串、数字、布尔和对象；
 * null、undefined、函数等无法提交的类型退化为空串。这样选项仍可见、可取消选择，
 * 也不会让 undefined 参与选中态匹配而被意外选中。
 * @param value 接口返回的原始选项值
 * @return 可绑定到 ElOption/ElCheckbox 的值；无法提交时为空串
 */
function toOptionValue(value: unknown): boolean | number | object | string {
  if (
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    (typeof value === 'object' && value !== null)
  ) {
    return value;
  }
  return '';
}

/**
 * 取单选框可绑定的选项值。
 * @description ElRadio 的 label 不接受对象（它按值做等值匹配，对象语义无意义）；
 * 接口误配对象值时退化为该值的展示文本，避免整组单选项渲染失败。
 * @param value 归一化后的选项值
 * @return 单选框可用的标量值
 */
function toRadioValue(value: boolean | number | object | string) {
  if (typeof value === 'object') {
    return toOptionText(value);
  }
  return value;
}

/**
 * 把接口返回的选项列表统一归一化。
 * @description 声明式映射分支和默认字段分支的原始值形状一致，因此在写入 options 前
 * 收敛一次，模板渲染与多选/单选/下拉三种形态都能直接复用。
 * @param items 接口返回或映射得到的原始选项
 * @return 标签为文本、值已收窄的选项数组
 */
function normalizeOptions(
  items: ApiSelectOption[],
): NormalizedApiSelectOption[] {
  return items.map(
    /**
     * 归一化单个选项。
     * @param item 接口返回或映射得到的单个选项
     * @returns 标签为文本、值已收窄的新选项对象
     */
    (item) => ({
      label: toOptionText(item.label),
      value: toOptionValue(item.value),
    }),
  );
}

/**
 * 按字面键名读取接口返回项的自有属性。
 * @description labelField/valueField 允许写成 `${属性}` 模板，此时每一段都是字面键名而非路径，
 * 因此这里不做点路径拆分；同时只读自有属性，避免取到原型链上的函数等成员。
 * @param data 接口返回的单个列表项
 * @param key 字段名
 * @return 字段值；字段缺失或 data 不是普通对象时为 undefined
 */
function readOwnField(data: unknown, key: string): unknown {
  return isRecord(data) && Object.hasOwn(data, key) ? data[key] : undefined;
}

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
        /** 缺省取工厂参数给的字段名，参数也没给时用通用的 label */
        default: () => option.labelField ?? 'label',
      },
      // 选项的值
      valueField: {
        type: String,
        /** 缺省取工厂参数给的字段名，参数也没给时用通用的 value */
        default: () => option.valueField ?? 'value',
      },
      // api 接口
      url: {
        type: String,
        /** 缺省取工厂参数给的接口地址，参数也没给时为空串，请求会因此被跳过 */
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
    /**
     * 组件初始化：装配选项加载、默认值回填和渲染逻辑。
     * @param props 组件声明的属性，含 labelField/valueField/url/method/selectType 等
     * @param context 组件 setup 上下文，此处只用其中的 emit 回填默认值
     * @returns 渲染函数；按 selectType 分派到下拉、单选或多选构建器
     */
    setup(props, context) {
      const { emit } = context;
      const attrs = useAttrs();
      const options = ref<NormalizedApiSelectOption[]>([]); // 下拉数据
      const loading = ref(false); // 是否正在从远程获取数据
      const queryParam = ref<string>(); // 当前输入的值
      let hasWarnedLegacyMapping = false;

      /**
       * 仅在开发环境输出配置告警。
       * @description 映射配置错误只影响设计器预览，生产环境刷屏没有价值，因此按 env.DEV 收敛。
       * @param message 告警内容
       */
      const warn = (message: string) => {
        if (!import.meta.env.DEV) {
          return;
        }
        logWarn('api-select', message);
      };

      // 检查是否有有效的预设值
      /**
       * 检查外部是否已给出有效选中值：undefined、null、空串与空数组都算没有预设。
       * @returns 存在至少一个有效选中值时为 true，否则为 false。
       */
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

      /**
       * 按 labelField/valueField 配置从列表项中取出展示值或提交值。
       *
       * 字段配置可以是字面字段名，也可以是 `${属性}` 模板（如 `${nickname}-${id}`）。
       * 模板拼接保持历史的 String 强制转换语义：取不到字段时先告警，
       * 再把 undefined 拼成 "undefined"，让设计者能在界面上直接看到配置错误。
       *
       * @param data 接口返回的单个列表项
       * @param template 字段配置
       * @return 字段值；配置为模板时返回拼接后的字符串
       */
      function parseExpression(data: unknown, template: string): unknown {
        // 检测是否使用了表达式
        if (!template.includes('${')) {
          return readOwnField(data, template);
        }
        // 正则表达式匹配模板字符串中的 ${...}
        const pattern = /\$\{([^}]*)\}/g;
        // 使用 replace 函数配合正则表达式和回调函数来进行替换
        return template.replaceAll(
          pattern,
          /**
           * 替换模板中的单个 `${属性}` 片段。
           * @param _ matched 整个匹配片段，此处不需要
           * @param expr 匹配到的 `${}` 内的表达式内容，即属性名
           * @returns 该片段替换成的文本；字段缺失时为 "undefined" 以暴露配置错误
           */
          (_, expr: string) => {
            // expr 是匹配到的 ${} 内的表达式（这里是属性名），从 data 中获取对应的值
            const result = readOwnField(data, expr.trim()); // 去除前后空白，以防用户输入带空格的属性名
            if (!result) {
              warn(
                `接口选择器模板[${template}] 解析字段[${expr.trim()}] 失败，请检查接口返回值字段是否存在`,
              );
            }
            return String(result);
          },
        );
      }

      /**
       * 把接口直接返回的列表转成归一化选项。
       * @param data 已是数组的接口列表；调用方负责先完成数组判断
       */
      function parseOptions0(data: unknown[]) {
        options.value = normalizeOptions(
          data.map(
            /**
             * 按 labelField/valueField 取出单个列表项的展示值与提交值。
             * @param item 接口返回的单个列表项
             * @returns 仍为原始值的选项，交由 normalizeOptions 统一收窄
             */
            (item: unknown) => {
              const label = parseExpression(item, props.labelField);
              // 根据 returnType 决定返回值：'name' 时提交值取 label，其余取 valueField
              const value =
                props.returnType === 'name'
                  ? label
                  : parseExpression(item, props.valueField);

              return {
                label,
                value,
              };
            },
          ),
        );
      }

      /**
       * 按配置解析接口返回数据。
       * @param data 接口返回的原始数据，可能是列表、分页对象或自定义结构
       */
      function parseOptions(data: unknown) {
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
          options.value = normalizeOptions(mappedOptions);
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
        const list = isRecord(data) ? data.list : undefined;
        if (Array.isArray(list)) {
          parseOptions0(list);
          return;
        }
        // 情况四：返回结果不符合默认约定
        warn(
          `接口[${props.url}] 返回结果不符合默认约定，建议使用自定义解析函数处理`,
        );
      }

      /**
       * 拉取一次选项列表。
       * @description 每次调用都先清空 options，避免旧数据在新请求返回前被误选；
       * 远程搜索关键词只在 queryParam 已有值时拼入请求，未搜索过则沿用纯 url。
       * @returns 拉取并归一化完成；请求异常由 requestClient 统一处理并向上抛出
       */
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
            const parsedBody: unknown = JSON.parse(props.data);
            // 远程搜索时把关键词并入请求体；解析结果不是普通对象时无法挂字段，按原样提交交由后端报错
            const body: unknown =
              props.remote && isRecord(parsedBody)
                ? { ...parsedBody, [props.remoteField]: queryParam.value }
                : parsedBody;
            parseOptions(await requestClient.post(props.url, body));
            break;
          }
          default: {
            break;
          }
        }
      };

      /**
       * 远程搜索回调：仅在输入非空时重新拉取选项，失败时也会复位 loading。
       * @param query ElSelect 传入的当前输入文本
       * @returns 拉取完成；loading 必定复位
       */
      const remoteMethod = async (query: string) => {
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

      /**
       * 挂载后先加载选项，再按需回填当前登录用户。
       * @description 必须等选项加载完成，否则默认用户可能在接口数据到达前被覆盖
       * @returns 初始化完成
       */
      onMounted(async () => {
        await getOptions();
        // 设置默认当前用户（仅用于 UserSelect）
        setDefaultCurrentUser();
      });

      /**
       * 构建下拉选择器，支持单选与多选两种形态。
       * @returns ElSelect 元素；多选时开启 multiple
       */
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
                /**
                 * 渲染单个选项项。
                 * @param item 已归一化的选项，label 是展示文本、value 是可绑定值
                 * @param index 选项在列表中的位置，用作渲染 key
                 * @returns 单个选项对应的 VNode
                 */
                (item: NormalizedApiSelectOption, index: number) => (
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
              /**
               * 渲染单个选项项。
               * @param item 已归一化的选项，label 是展示文本、value 是可绑定值
               * @param index 选项在列表中的位置，用作渲染 key
               * @returns 单个选项对应的 VNode
               */
              (item: NormalizedApiSelectOption, index: number) => (
                <ElOption key={index} label={item.label} value={item.value} />
              ),
            )}
          </ElSelect>
        );
      };
      /**
       * 构建多选框组。
       * @description 选项为空时补两条占位项，否则设计器预览会是一片空白无法观察勾选效果
       * @returns ElCheckboxGroup 元素
       */
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
              /**
               * 渲染单个多选项。
               * @param item 已归一化的选项，label 是展示文本、value 是勾选后提交的值
               * @param index 选项在列表中的位置，用作渲染 key
               * @returns 单个多选项对应的 VNode
               */
              (item: NormalizedApiSelectOption, index: number) => (
                <ElCheckbox key={index} label={item.value}>
                  {item.label}
                </ElCheckbox>
              ),
            )}
          </ElCheckboxGroup>
        );
      };
      /**
       * 构建单选框组。
       * @description 选项为空时补两条占位项；ElRadio 的 label 不接受对象值，需再收窄一次
       * @returns ElRadioGroup 元素
       */
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
              /**
               * 渲染单个单选项。
               * @param item 已归一化的选项，label 是展示文本、value 需再收窄为 ElRadio 可接受的标量
               * @param index 选项在列表中的位置，用作渲染 key
               * @returns 单个单选项对应的 VNode
               */
              (item: NormalizedApiSelectOption, index: number) => (
                <ElRadio key={index} label={toRadioValue(item.value)}>
                  {item.label}
                </ElRadio>
              ),
            )}
          </ElRadioGroup>
        );
      };
      /**
       * 渲染函数。
       * @returns 按 selectType 分派到单选、多选或下拉构建器的 VNode
       */
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
