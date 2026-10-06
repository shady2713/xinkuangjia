<script lang="ts" setup>
/**
 * 接口选项包装组件：包裹任意表单组件，把接口返回的数据归一化成
 * 选项字段后注入，并透传双向绑定与原来的插槽、属性。
 *
 * 负责请求时序（重复请求补发、visibleEvent 重载、自动选中）、
 * 字段名映射与 beforeFetch/afterFetch 钩子；
 * 渲染、取值与界面样式仍由被包裹的表单组件决定。
 */
import type { Component } from 'vue';

import type { AnyPromiseFunction } from '@vben/types';

import { computed, nextTick, ref, unref, useAttrs, watch } from 'vue';

import { LoaderCircle } from '@vben/icons';

import { cloneDeep, get, isEqual, isFunction } from '@vben-core/shared/utils';

import { objectOmit } from '@vueuse/core';

defineOptions({ name: 'ApiComponent', inheritAttrs: false });

const props = withDefaults(defineProps<Props>(), {
  labelField: 'label',
  valueField: 'value',
  disabledField: 'disabled',
  childrenField: '',
  optionsPropName: 'options',
  resultField: '',
  visibleEvent: '',
  numberToString: false,
  /** 请求参数用工厂函数兜底，避免默认值在多个组件实例间共享同一对象。 */
  params: () => ({}),
  immediate: true,
  alwaysLoad: false,
  loadingSlot: '',
  beforeFetch: undefined,
  afterFetch: undefined,
  modelPropName: 'modelValue',
  api: undefined,
  autoSelect: false,
  /** 直接传入的选项同样用工厂函数兜底，避免默认值被跨实例改写。 */
  options: () => [],
});

const emit = defineEmits<{
  optionsChange: [OptionsItem[]];
}>();

/**
 * 从接口取回的一条原始选项。
 * @description 实际字段名由 labelField/valueField/childrenField/disabledField 等配置决定，
 * 接口返回的其余字段需要原样透传给目标组件，因此按索引签名承接；
 * label/disabled/value 保留接口原值不做转换，交由目标组件按自身期望渲染，
 * 其中 value 是否需要转字符串由 numberToString 决定。
 */
type OptionsItem = {
  [name: string]: unknown;
  children?: OptionsItem[];
  disabled?: unknown;
  label?: unknown;
  value?: unknown;
};

/**
 * 按字段名从接口返回的单条记录中读取原始值。
 * @description labelField/valueField/disabledField/childrenField 都是运行期配置的字段名，
 * 编译期无法推断取到的到底是什么类型，因此统一按 unknown 返回，由调用方决定如何使用。
 * @param item 接口返回的单条记录
 * @param field 字段名
 * @returns 字段值；字段缺失时为 undefined
 */
function readOptionField(item: OptionsItem, field: string): unknown {
  return get(item, field);
}

/**
 * 按 resultField 从接口结果中取出选项列表。
 * @description resultField 是点路径（如 'data.list'）；路径不存在或取到的不是数组时返回 undefined，
 * 由调用方降级为空列表，避免把非数组塞进选项导致渲染异常。
 * @param payload 接口返回的原始结果
 * @param resultField 列表所在的点路径
 * @returns 取到的选项列表；无法识别时为 undefined
 */
function extractOptions(
  payload: unknown,
  resultField: string,
): OptionsItem[] | undefined {
  const extracted = get(payload, resultField);
  return Array.isArray(extracted) ? extracted : undefined;
}

/**
 * 接口允许返回的原始数据形状。
 * @description 要么直接是选项列表，要么是用 resultField 指定路径的对象；
 * 两者之外的结构视为无结果，由调用方按 resultField 兜底。
 */
type ApiFetchResult = OptionsItem[] | Record<string, unknown>;

interface Props {
  /** 组件 */
  component: Component;
  /** 是否将value从数字转为string */
  numberToString?: boolean;
  /** 获取options数据的函数；返回值要么是列表，要么是用 resultField 取列表的对象 */
  api?: (arg?: unknown) => Promise<ApiFetchResult>;
  /** 传递给api的参数 */
  params?: Record<string, unknown>;
  /** 从api返回的结果中提取options数组的字段名 */
  resultField?: string;
  /** label字段名 */
  labelField?: string;
  /** children字段名，需要层级数据的组件可用 */
  childrenField?: string;
  /** value字段名 */
  valueField?: string;
  /** disabled字段名 */
  disabledField?: string;
  /** 组件接收options数据的属性名 */
  optionsPropName?: string;
  /** 是否立即调用api */
  immediate?: boolean;
  /** 每次`visibleEvent`事件发生时都重新请求数据 */
  alwaysLoad?: boolean;
  /**
   * 在api请求之前的回调函数
   * @description 入参是克隆后的请求参数，返回值替换原参数；返回空值表示不改参数
   */
  beforeFetch?: AnyPromiseFunction<
    [Record<string, unknown>],
    Record<string, unknown> | undefined
  >;
  /**
   * 在api请求之后的回调函数
   * @description 入参是接口原始返回，返回值替换原结果；返回空值表示不改结果
   */
  afterFetch?: AnyPromiseFunction<[ApiFetchResult], ApiFetchResult | undefined>;
  /** 直接传入选项数据，也作为api返回空数据时的后备数据 */
  options?: OptionsItem[];
  /** 组件的插槽名称，用来显示一个"加载中"的图标 */
  loadingSlot?: string;
  /** 触发api请求的事件名 */
  visibleEvent?: string;
  /** 组件的v-model属性名，默认为modelValue。部分组件可能为value */
  modelPropName?: string;
  /**
   * 自动选择
   * - `first`：自动选择第一个选项
   * - `last`：自动选择最后一个选项
   * - `one`: 当请求的结果只有一个选项时，自动选择该选项
   * - 函数：自定义选择逻辑，函数的参数为请求的结果数组，返回值为选择的选项
   * - false：不自动选择(默认)
   */
  autoSelect?:
    | 'first'
    | 'last'
    | 'one'
    | ((item: OptionsItem[]) => OptionsItem)
    | false;
}

const modelValue = defineModel<unknown>({ default: undefined });

const attrs = useAttrs();
const innerParams = ref<Record<string, unknown>>({});
const refOptions = ref<OptionsItem[]>([]);
const loading = ref(false);
// 首次是否加载过了
const isFirstLoaded = ref(false);
// 标记是否有待处理的请求
const hasPendingRequest = ref(false);

/** 归一化选项时需要的字段名配置，取自组件 props。 */
interface OptionFieldConfig {
  childrenField: string;
  disabledField: string;
  labelField: string;
  numberToString: boolean;
  valueField: string;
}

/**
 * 归一化一条选项及其子树。
 * @description 目标组件只认 label/value/disabled/children 这套固定命名，
 * 而接口字段名由配置决定，因此先剔除原始字段名再补上归一化字段；
 * 子节点不是数组时不补 children，避免把非法层级塞给树形组件。
 * @param data 同一层级的原始选项列表
 * @param config 字段名与是否转字符串的配置
 * @returns 字段名已归一化的选项列表，层级结构保持不变
 */
function transformData(
  data: OptionsItem[],
  config: OptionFieldConfig,
): OptionsItem[] {
  const {
    childrenField,
    disabledField,
    labelField,
    numberToString,
    valueField,
  } = config;
  return data.map(
    /**
     * 归一化单条选项。
     * @param item 接口返回的单条原始选项
     * @returns 归一化后的新选项对象
     */
    (item) => {
      const value = readOptionField(item, valueField);
      // 原始字段名要先剔除，再补上归一化后的字段，否则目标组件会同时收到两套命名
      const children = childrenField
        ? readOptionField(item, childrenField)
        : undefined;
      return {
        ...objectOmit(item, [
          labelField,
          valueField,
          disabledField,
          childrenField,
        ]),
        label: readOptionField(item, labelField),
        value: numberToString ? `${value}` : value,
        disabled: readOptionField(item, disabledField),
        ...(Array.isArray(children)
          ? { children: transformData(children, config) }
          : {}),
      };
    },
  );
}

/**
 * 计算当前应渲染的选项列表。
 * @description 依赖 refOptions、props.options 与字段名配置，任一变化都会重新归一化。
 * @returns 接口数据归一化后的选项；接口未返回数据时回落到 props.options
 */
function buildOptions(): OptionsItem[] {
  const data = transformData(unref(refOptions), {
    childrenField: props.childrenField,
    disabledField: props.disabledField,
    labelField: props.labelField,
    numberToString: props.numberToString,
    valueField: props.valueField,
  });
  return data.length > 0 ? data : props.options;
}

const getOptions = computed(buildOptions);

const bindProps = computed(() => {
  return {
    [props.modelPropName]: unref(modelValue),
    [props.optionsPropName]: unref(getOptions),
    [`onUpdate:${props.modelPropName}`]: (val: string) => {
      modelValue.value = val;
    },
    ...objectOmit(attrs, [`onUpdate:${props.modelPropName}`]),
    ...(props.visibleEvent
      ? {
          [props.visibleEvent]: handleFetchForVisible,
        }
      : {}),
  };
});

/**
 * 拉取一次选项数据。
 * @description 正在加载时只登记一个待处理请求，等本次结束后再补发一次，
 * 避免联动筛选快速变化时后发请求被丢弃；请求异常只记录告警并把 isFirstLoaded 复位，
 * 让下次 visibleEvent 仍能重新加载。
 * @returns 拉取与归一化完成；异常已被捕获，不会向外抛出
 */
async function fetchApi() {
  const { api, beforeFetch, afterFetch, resultField } = props;

  if (!api || !isFunction(api)) {
    return;
  }

  // 如果正在加载，标记有待处理的请求并返回
  if (loading.value) {
    hasPendingRequest.value = true;
    return;
  }

  refOptions.value = [];
  try {
    loading.value = true;
    let finalParams = unref(mergedParams);
    if (beforeFetch && isFunction(beforeFetch)) {
      finalParams = (await beforeFetch(cloneDeep(finalParams))) || finalParams;
    }
    let res = await api(finalParams);
    if (afterFetch && isFunction(afterFetch)) {
      res = (await afterFetch(res)) || res;
    }
    isFirstLoaded.value = true;
    if (Array.isArray(res)) {
      refOptions.value = res;
      emitChange();
      return;
    }
    if (resultField) {
      refOptions.value = extractOptions(res, resultField) ?? [];
    }
    emitChange();
  } catch (error) {
    console.warn(error);
    // reset status
    isFirstLoaded.value = false;
  } finally {
    loading.value = false;
    // 如果有待处理的请求，立即触发新的请求
    if (hasPendingRequest.value) {
      hasPendingRequest.value = false;
      // 使用 nextTick 确保状态更新完成后再触发新请求
      await nextTick();
      fetchApi();
    }
  }
}

async function handleFetchForVisible(visible: boolean) {
  if (visible) {
    if (props.alwaysLoad) {
      await fetchApi();
    } else if (!props.immediate && !unref(isFirstLoaded)) {
      await fetchApi();
    }
  }
}

const mergedParams = computed(() => {
  return {
    ...props.params,
    ...unref(innerParams),
  };
});

watch(
  mergedParams,
  (value, oldValue) => {
    if (isEqual(value, oldValue)) {
      return;
    }
    fetchApi();
  },
  { deep: true, immediate: props.immediate },
);

function emitChange() {
  if (
    modelValue.value === undefined &&
    props.autoSelect &&
    unref(getOptions).length > 0
  ) {
    let firstOption;
    if (isFunction(props.autoSelect)) {
      firstOption = props.autoSelect(unref(getOptions));
    } else {
      switch (props.autoSelect) {
        case 'first': {
          firstOption = unref(getOptions)[0];
          break;
        }
        case 'last': {
          firstOption = unref(getOptions)[unref(getOptions).length - 1];
          break;
        }
        case 'one': {
          if (unref(getOptions).length === 1) {
            firstOption = unref(getOptions)[0];
          }
          break;
        }
      }
    }

    if (firstOption) modelValue.value = firstOption.value;
  }
  emit('optionsChange', unref(getOptions));
}
const componentRef = ref<unknown>();
defineExpose({
  /** 获取options数据 */
  getOptions: () => unref(getOptions),
  /** 获取当前值 */
  getValue: () => unref(modelValue),
  /**
   * 获取被包装的组件实例。
   * @description 被包装组件由 props.component 动态决定，这里无法推断其类型，
   * 调用方需显式传入期望类型，例如 getComponentRef<InstanceType<typeof ElSelect>>()。
   */
  getComponentRef: <T = unknown,>() => componentRef.value as T,
  /**
   * 更新Api参数。
   * @description 内部参数与 props.params 合并后触发重新请求，用于联动查询条件
   * @param newParams 新的查询参数
   */
  updateParam(newParams: Record<string, unknown>) {
    innerParams.value = newParams;
  },
});
</script>
<template>
  <component
    :is="component"
    v-bind="bindProps"
    :placeholder="$attrs.placeholder"
    ref="componentRef"
  >
    <template v-for="item in Object.keys($slots)" #[item]="data">
      <slot :name="item" v-bind="data || {}"></slot>
    </template>
    <template v-if="loadingSlot && loading" #[loadingSlot]>
      <LoaderCircle class="animate-spin" />
    </template>
  </component>
</template>
