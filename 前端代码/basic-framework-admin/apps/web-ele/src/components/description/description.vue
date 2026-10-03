<script lang="tsx">
/** 描述列表：按 schema 渲染键值对，并支持额外的 extra 插槽。 */
import type { CSSProperties, PropType, Slots, VNode } from 'vue';

import type { DescriptionItemSchema, DescriptionProps } from './typing';

import { computed, defineComponent, ref, unref, useAttrs } from 'vue';

import { get, getNestedValue, isFunction, logWarn } from '@vben/utils';

import { ElDescriptions, ElDescriptionsItem } from 'element-plus';

const props = {
  border: { default: true, type: Boolean },
  column: {
    default: () => {
      return { lg: 3, md: 3, sm: 2, xl: 3, xs: 1, xxl: 4 };
    },
    type: [Number, Object],
  },
  data: { type: Object },
  schema: {
    default: () => [],
    type: Array as PropType<DescriptionItemSchema[]>,
  },
  size: {
    default: 'default',
    type: String,
    validator: (v: string) =>
      ['default', 'middle', 'small', undefined].includes(v),
  },
  title: { default: '', type: String },
  direction: { default: 'horizontal', type: String },
};

/**
 * 描述列表的单个插槽：无参渲染函数，返回该插槽要输出的节点数组。
 * 描述项插槽只由本组件生成，因此签名固定，不接受调用方传入参数。
 * @returns 该插槽要渲染的节点数组。
 */
type DescriptionSlot = () => VNode[];

/** 描述列表渲染用的插槽表：键为插槽名，值为对应的渲染函数。 */
type DescriptionSlots = Record<string, DescriptionSlot>;

/**
 * 安全地取出调用方提供的具名插槽。
 * 插槽缺失或不是函数时返回 null 并告警，让调用方回退到默认渲染而不是崩溃。
 * @param slots 组件当前收到的全部插槽。
 * @param slot 要取用的插槽名。
 * @param data 传给插槽的描述数据，供插槽内部按字段取值。
 * @returns 插槽渲染结果数组；插槽不可用时为 null。
 */
function getSlot(slots: Slots, slot: string, data?: Record<string, unknown>) {
  if (!slots || !Reflect.has(slots, slot)) {
    return null;
  }
  if (!isFunction(slots[slot])) {
    logWarn('description:slot', `${slot} is not a function!`);
    return null;
  }
  const slotFn = slots[slot];
  if (!slotFn) return null;
  return slotFn({ data });
}

export default defineComponent({
  name: 'Description',
  props,
  /**
   * 组装描述列表的渲染逻辑。
   * schema 既可以由 props 直接给出，也可以由 `useDescription` 在异步取数后回填，
   * 两者最终都收敛到同一份合并后的属性上再渲染。
   * @param props 组件声明的描述列表属性。
   * @returns 渲染函数，输出完整的描述列表节点。
   */
  setup(props, { slots }) {
    const propsRef = ref<null | Partial<DescriptionProps>>(null);

    const prefixCls = 'description';
    const attrs = useAttrs();

    const getMergeProps = computed(
      /**
       * 合并组件属性与异步回填数据；回填数据为空时等价于只使用组件属性。
       * @returns 合并后的完整描述列表属性。
       */
      () => {
        return {
          ...props,
          // propsRef 初始为 null，展开 null 等价于展开空对象，
          // 表示尚无异步回填数据，此时只用组件自身声明的属性。
          ...unref(propsRef),
        } as DescriptionProps;
      },
    );

    const getProps = computed(() => {
      const opt = {
        ...unref(getMergeProps),
      };
      return opt as DescriptionProps;
    });

    const getDescriptionsProps = computed(() => {
      return { ...unref(attrs), ...unref(getProps) } as DescriptionProps;
    });

    // 防止换行
    function renderLabel({
      label,
      labelMinWidth,
      labelStyle,
    }: DescriptionItemSchema) {
      if (!labelStyle && !labelMinWidth) {
        return label;
      }

      const labelStyles: CSSProperties = {
        ...labelStyle,
        minWidth: `${labelMinWidth}px `,
      };
      return <div style={labelStyles}>{label}</div>;
    }

    function renderItem() {
      const { data, schema } = unref(getProps);
      return unref(schema)
        .map((item) => {
          const { contentMinWidth, field, render, show, span } = item;

          if (show && isFunction(show) && !show(data)) {
            return null;
          }

          function getContent() {
            const _data = unref(getProps)?.data;
            if (!_data) {
              return null;
            }
            const getField = field.includes('.')
              ? (getNestedValue(_data, field) ?? get(_data, field))
              : get(_data, field);
            return isFunction(render)
              ? render(getField, _data)
              : (getField ?? '');
          }

          const width = contentMinWidth;
          return (
            <ElDescriptionsItem key={field} span={span}>
              {{
                label: () => {
                  return renderLabel(item);
                },
                default: () => {
                  if (item.slot) {
                    return getSlot(slots, item.slot, data);
                  }
                  if (!contentMinWidth) {
                    return getContent();
                  }
                  const style: CSSProperties = {
                    minWidth: `${width}px`,
                  };
                  return <div style={style}>{getContent()}</div>;
                },
              }}
            </ElDescriptionsItem>
          );
        })
        .filter((item) => !!item);
    }

    /**
     * 渲染描述列表主体。
     * extra 插槽只透传不加工，保证调用方自定义的表头区域与默认渲染互不干扰。
     * @returns 描述列表节点，含描述项插槽与可选的 extra 插槽。
     */
    function renderDesc() {
      const extraSlot = getSlot(slots, 'extra');
      // 描述项插槽只由本组件生成，签名是“无参返回渲染结果数组”的函数。
      const slotsObj: DescriptionSlots = {
        default: () => renderItem(),
      };
      if (extraSlot) {
        slotsObj.extra = () => extraSlot;
      }
      return (
        <ElDescriptions
          class={`${prefixCls}`}
          title={unref(getMergeProps).title}
          {...unref(getDescriptionsProps)}
        >
          {slotsObj}
        </ElDescriptions>
      );
    }

    return () => renderDesc();
  },
});
</script>
