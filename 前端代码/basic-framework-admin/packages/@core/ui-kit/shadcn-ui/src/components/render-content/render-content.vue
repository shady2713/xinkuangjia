<script lang="ts">
/**
 * 动态内容渲染组件：把字符串、组件或渲染函数统一渲染成节点。
 * 字符串默认按纯文本输出，renderBr 为真时按换行拆成多个段落。
 * 组件形态会透传 attrs 与插槽；不解析富文本、不注入 HTML。
 */
import type { Component, PropType } from 'vue';

import { defineComponent, h } from 'vue';

import { isFunction, isObject, isString } from '@vben-core/shared/utils';

/** 渲染函数形态的内容：调用后得到待渲染结果。 */
type ContentRenderer = () => unknown;

/**
 * 待渲染内容的形态：组件、字符串或渲染函数三者之一。
 * 字符串按文本处理（可选按行拆段），其余两种按组件处理并透传 props 与 slots。
 */
type RenderableContent = Component | ContentRenderer | string;

export default defineComponent({
  name: 'RenderContent',
  props: {
    content: {
      default: undefined as PropType<RenderableContent> | undefined,
      type: [Object, String, Function],
    },
    renderBr: {
      default: false,
      type: Boolean,
    },
  },
  /**
   * 返回渲染函数，负责把 content 按形态分派成节点。
   * content 为空时渲染 null，字符串优先按纯文本输出（renderBr 为真时按换行拆成多个 p 段落），
   * 组件与渲染函数形态则用 h 挂载，并把 attrs 既透到根 props 上又整体展开，
   * 让使用方既能整体透传 class、事件，也能按名读取 content、renderBr。
   * 插槽原样交给内容组件，不做过滤。
   * @param props 组件已声明的属性，只用到 content 与 renderBr。
   * @param context setup 上下文，取其中的 attrs 与 slots 用于透传。
   * @returns 渲染函数，返回值为节点、节点数组或 null。
   */
  setup(props, { attrs, slots }) {
    return () => {
      if (!props.content) {
        return null;
      }
      const isComponent =
        (isObject(props.content) || isFunction(props.content)) &&
        props.content !== null;
      if (!isComponent) {
        if (props.renderBr && isString(props.content)) {
          const lines = props.content.split('\n');
          const result = [];
          for (const [i, line] of lines.entries()) {
            result.push(h('p', { key: i }, line));
            // if (i < lines.length - 1) {
            //   result.push(h('br'));
            // }
          }
          return result;
        } else {
          return props.content;
        }
      }
      return h(
        props.content as never,
        {
          ...attrs,
          props: {
            ...props,
            ...attrs,
          },
        },
        slots,
      );
    };
  },
});
</script>
