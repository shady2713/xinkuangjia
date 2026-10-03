/**
 * 通用组件共同的使用的基础组件，原先放在 adapter/form 内部，限制了使用范围，这里提取出来，方便其他地方使用
 */

import type { Component } from 'vue';

import type { BaseFormComponentType } from '@vben/common-ui';
import type { Recordable } from '@vben/types';

import { defineAsyncComponent, defineComponent, h, ref } from 'vue';

import { ApiComponent, globalShareState, IconPicker } from '@vben/common-ui';
import { $t } from '@vben/locales';

import { ElNotification } from 'element-plus';

import { FileUpload, ImageUpload } from '#/components/upload';

const ElAutoComplete = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/autocomplete/index'),
    import('element-plus/es/components/autocomplete/style/css'),
  ]).then(([res]) => res.ElAutocomplete),
);
const ElButton = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/button/index'),
    import('element-plus/es/components/button/style/css'),
  ]).then(([res]) => res.ElButton),
);
const ElCheckbox = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/checkbox/index'),
    import('element-plus/es/components/checkbox/style/css'),
  ]).then(([res]) => res.ElCheckbox),
);
const ElCheckboxButton = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/checkbox/index'),
    import('element-plus/es/components/checkbox-button/style/css'),
  ]).then(([res]) => res.ElCheckboxButton),
);
const ElCheckboxGroup = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/checkbox/index'),
    import('element-plus/es/components/checkbox-group/style/css'),
  ]).then(([res]) => res.ElCheckboxGroup),
);
const ElDatePicker = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/date-picker/index'),
    import('element-plus/es/components/date-picker/style/css'),
  ]).then(([res]) => res.ElDatePicker),
);
const ElDivider = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/divider/index'),
    import('element-plus/es/components/divider/style/css'),
  ]).then(([res]) => res.ElDivider),
);
const ElInput = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/input/index'),
    import('element-plus/es/components/input/style/css'),
  ]).then(([res]) => res.ElInput),
);
const ElInputNumber = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/input-number/index'),
    import('element-plus/es/components/input-number/style/css'),
  ]).then(([res]) => res.ElInputNumber),
);
const ElInputTag = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/input-tag/index'),
    import('element-plus/es/components/input-tag/style/css'),
  ]).then(([res]) => res.ElInputTag),
);
const ElRadio = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/radio/index'),
    import('element-plus/es/components/radio/style/css'),
  ]).then(([res]) => res.ElRadio),
);
const ElRadioButton = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/radio/index'),
    import('element-plus/es/components/radio-button/style/css'),
  ]).then(([res]) => res.ElRadioButton),
);
const ElRadioGroup = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/radio/index'),
    import('element-plus/es/components/radio-group/style/css'),
  ]).then(([res]) => res.ElRadioGroup),
);
const ElSelectV2 = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/select-v2/index'),
    import('element-plus/es/components/select-v2/style/css'),
  ]).then(([res]) => res.ElSelectV2),
);
const ElSpace = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/space/index'),
    import('element-plus/es/components/space/style/css'),
  ]).then(([res]) => res.ElSpace),
);
const ElSwitch = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/switch/index'),
    import('element-plus/es/components/switch/style/css'),
  ]).then(([res]) => res.ElSwitch),
);
const ElTimePicker = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/time-picker/index'),
    import('element-plus/es/components/time-picker/style/css'),
  ]).then(([res]) => res.ElTimePicker),
);
const ElTreeSelect = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/tree-select/index'),
    import('element-plus/es/components/tree-select/style/css'),
  ]).then(([res]) => res.ElTreeSelect),
);
const ElUpload = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/upload/index'),
    import('element-plus/es/components/upload/style/css'),
  ]).then(([res]) => res.ElUpload),
);
const ElCascader = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/cascader/index'),
    import('element-plus/es/components/cascader/style/css'),
  ]).then(([res]) => res.ElCascader),
);
const ElRate = defineAsyncComponent(() =>
  Promise.all([
    import('element-plus/es/components/rate/index'),
    import('element-plus/es/components/rate/style/css'),
  ]).then(([res]) => res.ElRate),
);

/**
 * 给组件套一层统一的中英文占位文案。
 * 表单 schema 只声明了组件类型，占位文案由这里按控件种类补齐，
 * 同时把内部组件实例的方法通过 Proxy 暴露给表单层（如 focus、blur）。
 * @param component 需要包裹的 Element Plus 组件。
 * @param type 控件种类，决定默认占位文案走 input 还是 select 的翻译键。
 * @param componentProps 追加到组件上的固定属性，会被调用方传入的属性覆盖。
 * @returns 包装后的组件定义，渲染时输出真实组件并补上占位文案。
 */
const withDefaultPlaceholder = <T extends Component>(
  component: T,
  type: 'input' | 'select',
  componentProps: Recordable<unknown> = {},
) => {
  return defineComponent({
    name: component.name,
    inheritAttrs: false,
    // 未声明 props，组件只通过 attrs 接收调用方属性，这里按只读属性表处理。
    setup: (
      props: Readonly<Record<string, unknown>>,
      { attrs, expose, slots },
    ) => {
      const placeholder =
        props?.placeholder ||
        attrs?.placeholder ||
        $t(`ui.placeholder.${type}`);
      // 透传组件暴露的方法
      const innerRef = ref();
      expose(
        new Proxy(
          {},
          {
            get: (_target, key) => innerRef.value?.[key],
            has: (_target, key) => key in (innerRef.value || {}),
          },
        ),
      );
      return () =>
        h(
          component,
          { ...componentProps, placeholder, ...props, ...attrs, ref: innerRef },
          slots,
        );
    },
  });
};

// 这里需要自行根据业务组件库进行适配，需要用到的组件都需要在这里类型说明
export type ComponentType =
  | 'ApiCascader'
  | 'ApiSelect'
  | 'ApiTreeSelect'
  | 'AutoComplete'
  | 'Checkbox'
  | 'CheckboxGroup'
  | 'DatePicker'
  | 'Divider'
  | 'FileUpload'
  | 'IconPicker'
  | 'ImageUpload'
  | 'Input'
  | 'InputNumber'
  | 'InputTag'
  | 'RadioGroup'
  | 'RangePicker'
  | 'Rate'
  | 'Select'
  | 'Space'
  | 'Switch'
  | 'Textarea'
  | 'TimePicker'
  | 'TreeSelect'
  | 'Upload'
  | BaseFormComponentType;

/**
 * 装配表单组件适配层并注册到全局共享状态。
 * 组件映射表在启动时只构建一次，随后由 `initComponentAdapter` 的调用方等待完成；
 * 适配层负责把 Element Plus 与业务组件的差异收敛在一处，页面不再直接依赖具体实现。
 * @returns 注册完成即结束；组件映射通过全局共享状态对外提供，因此不返回组件表。
 */
async function initComponentAdapter() {
  const components: Partial<Record<ComponentType, Component>> = {
    // 如果你的组件体积比较大，可以使用异步加载
    // Button: () =>
    // import('xxx').then((res) => res.Button),
    ApiSelect: withDefaultPlaceholder(
      {
        ...ApiComponent,
        name: 'ApiSelect',
      },
      'select',
      {
        component: ElSelectV2,
        loadingSlot: 'loading',
        visibleEvent: 'onVisibleChange',
      },
    ),
    ApiCascader: withDefaultPlaceholder(
      {
        ...ApiComponent,
        name: 'ApiCascader',
      },
      'select',
      {
        component: ElCascader,
      },
    ),
    ApiTreeSelect: withDefaultPlaceholder(
      {
        ...ApiComponent,
        name: 'ApiTreeSelect',
      },
      'select',
      {
        component: ElTreeSelect,
        props: { label: 'label', children: 'children' },
        nodeKey: 'value',
        loadingSlot: 'loading',
        optionsPropName: 'data',
        visibleEvent: 'onVisibleChange',
      },
    ),
    AutoComplete: ElAutoComplete,
    Checkbox: ElCheckbox,
    CheckboxGroup: (props, { attrs, slots }) => {
      let defaultSlot;
      if (Reflect.has(slots, 'default')) {
        defaultSlot = slots.default;
      } else {
        const { options, isButton } = attrs;
        if (Array.isArray(options)) {
          defaultSlot = () =>
            options.map((option) =>
              h(isButton ? ElCheckboxButton : ElCheckbox, option),
            );
        }
      }
      return h(
        ElCheckboxGroup,
        { ...props, ...attrs },
        { ...slots, default: defaultSlot },
      );
    },
    // 自定义默认按钮
    DefaultButton: (props, { attrs, slots }) => {
      // 调整 type 为 default ，info 有点丑
      return h(ElButton, { ...props, attrs, type: 'default' }, slots);
    },
    // 自定义主要按钮
    PrimaryButton: (props, { attrs, slots }) => {
      return h(ElButton, { ...props, attrs, type: 'primary' }, slots);
    },
    Divider: ElDivider,
    IconPicker: withDefaultPlaceholder(IconPicker, 'select', {
      iconSlot: 'append',
      modelValueProp: 'model-value',
      inputComponent: ElInput,
    }),
    Input: withDefaultPlaceholder(ElInput, 'input'),
    InputNumber: withDefaultPlaceholder(ElInputNumber, 'input'),
    InputTag: withDefaultPlaceholder(ElInputTag, 'input'),
    RadioGroup: (props, { attrs, slots }) => {
      let defaultSlot;
      if (Reflect.has(slots, 'default')) {
        defaultSlot = slots.default;
      } else {
        const { options } = attrs;
        if (Array.isArray(options)) {
          defaultSlot = () =>
            options.map((option) =>
              h(attrs.isButton ? ElRadioButton : ElRadio, option),
            );
        }
      }
      return h(
        ElRadioGroup,
        { ...props, ...attrs },
        { ...slots, default: defaultSlot },
      );
    },
    Select: (props, { attrs, slots }) => {
      return h(ElSelectV2, { ...props, attrs }, slots);
    },
    Space: ElSpace,
    Switch: ElSwitch,
    /**
     * 时间选择器的适配：范围模式下 Element Plus 需要成对的 name 和 id，
     * 这里按 `_end` 后缀补齐，否则表单只会校验到起始值。
     * @param props 表单项当前值与事件绑定；范围模式下 name、id 为单个值。
     * @returns 时间选择器的渲染结果。
     */
    TimePicker: (props, { attrs, slots }) => {
      const { name, id, isRange } = props;
      const extraProps: Recordable<unknown> = {};
      if (isRange) {
        if (name && !Array.isArray(name)) {
          extraProps.name = [name, `${name}_end`];
        }
        if (id && !Array.isArray(id)) {
          extraProps.id = [id, `${id}_end`];
        }
      }
      return h(
        ElTimePicker,
        {
          ...props,
          ...attrs,
          ...extraProps,
        },
        slots,
      );
    },
    /**
     * 日期时间范围选择器的适配：始终按 `datetimerange` 渲染，
     * 并把单个 name、id 扩展成起止两个，缺一头会导致范围值无法完整回填。
     * @param props 表单项当前值与事件绑定。
     * @returns 范围选择器的渲染结果。
     */
    RangePicker: (props, { attrs, slots }) => {
      const { name, id } = props;
      const extraProps: Recordable<unknown> = {};
      if (name && !Array.isArray(name)) {
        extraProps.name = [name, `${name}_end`];
      }
      if (id && !Array.isArray(id)) {
        extraProps.id = [id, `${id}_end`];
      }
      return h(
        ElDatePicker,
        {
          ...props,
          type: 'datetimerange',
          ...attrs,
          ...extraProps,
        },
        slots,
      );
    },
    Rate: ElRate,
    /**
     * 日期选择器的适配：只有 type 含 range 时才需要成对的 name 和 id，
     * 单值模式下补成数组反而会让 Element Plus 取不到值。
     * @param props 表单项当前值与事件绑定；type 决定是否为范围模式。
     * @returns 日期选择器的渲染结果。
     */
    DatePicker: (props, { attrs, slots }) => {
      const { name, id, type } = props;
      const extraProps: Recordable<unknown> = {};
      if (type && type.includes('range')) {
        if (name && !Array.isArray(name)) {
          extraProps.name = [name, `${name}_end`];
        }
        if (id && !Array.isArray(id)) {
          extraProps.id = [id, `${id}_end`];
        }
      }
      return h(
        ElDatePicker,
        {
          ...props,
          ...attrs,
          ...extraProps,
        },
        slots,
      );
    },
    TreeSelect: withDefaultPlaceholder(ElTreeSelect, 'select'),
    Upload: ElUpload,
    FileUpload,
    ImageUpload,
    Textarea: withDefaultPlaceholder(ElInput, 'input', {
      rows: 3,
      type: 'textarea',
    }),
  };

  // 将组件注册到全局共享状态中
  globalShareState.setComponents(components);

  // 定义全局共享状态中的消息提示
  globalShareState.defineMessage({
    // 复制成功消息提示
    copyPreferencesSuccess: (title, content) => {
      ElNotification({
        title,
        message: content,
        position: 'bottom-right',
        duration: 0,
        type: 'success',
      });
    },
  });
}

export { initComponentAdapter };
