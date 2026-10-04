<script lang="ts" setup>
import type { SetupContext } from 'vue';

import type { Recordable } from '@vben/types';

import type {
  JsonViewerAction,
  JsonViewerProps,
  JsonViewerToggle,
  JsonViewerValue,
} from './types';

import { computed, useAttrs } from 'vue';
import VueJsonViewer from 'vue-json-viewer';

import { $t } from '@vben/locales';

import { isBoolean, isObject } from '@vben-core/shared/utils';

import JsonBigint from 'json-bigint';

defineOptions({ name: 'JsonViewer' });

const props = withDefaults(defineProps<JsonViewerProps>(), {
  expandDepth: 1,
  copyable: false,
  sort: false,
  boxed: false,
  theme: 'default-json-theme',
  expanded: false,
  previewMode: false,
  showArrayIndex: true,
  showDoubleQuotes: false,
});

const emit = defineEmits<{
  click: [event: MouseEvent];
  copied: [event: JsonViewerAction];
  keyClick: [key: string];
  toggle: [param: JsonViewerToggle];
  valueClick: [value: JsonViewerValue];
}>();

const attrs: SetupContext['attrs'] = useAttrs();

/**
 * 处理查看器内的点击：命中条目时按节点上的 path/depth 属性组装节点信息并向上抛 valueClick，
 * 随后无论是否命中都继续抛出原始 click，保证外层的点击埋点不受影响。
 * @param event 查看器派发的鼠标点击事件。
 */
function handleClick(event: MouseEvent) {
  if (
    event.target instanceof HTMLElement &&
    event.target.classList.contains('jv-item')
  ) {
    const pathNode = event.target.closest('.jv-push');
    if (!pathNode || !pathNode.hasAttribute('path')) {
      return;
    }
    const text = event.target.textContent;
    const param: JsonViewerValue = {
      el: event.target,
      path: pathNode.getAttribute('path') || '',
      depth: Number(pathNode.getAttribute('depth')) || 0,
      // 节点文本是 JSON 字面量；文本非法时沿用原有行为向上抛出，不静默吞掉
      value: text ? JSON.parse(text) : undefined,
    };

    emit('valueClick', param);
  }
  emit('click', event);
}

/**
 * 把 json-bigint 的解析结果还原成原型正常的普通结构。
 * json-bigint 以 `Object.create(null)` 承载对象节点（数组仍继承 Array.prototype），而第三方
 * 查看器渲染对象时直接调用节点自身的 `hasOwnProperty`；无原型节点取不到该方法，会抛
 * `TypeError: obj.hasOwnProperty is not a function` 让整块区域空白。因此这里按自有属性逐层
 * 复制：判断一律走 `Object.hasOwn`，复制后既恢复 Object.prototype，又保留 storeAsString
 * 得到的字符串形式大整数。代价是每次解析多复制一份结构，换取查看器不再崩溃。
 * @param value 解析结果中的任意节点，可能是无原型对象、数组或原始值。
 * @returns 原型正常的等价结构；原始值原样返回。
 */
function toPlainStructure(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(
      /**
       * 递归还原数组元素，嵌套对象同样需要还原。
       * @param item 当前数组元素。
       * @returns 还原后的元素。
       */
      (item) => toPlainStructure(item),
    );
  }
  if (typeof value === 'object' && value !== null) {
    // 无原型对象没有继承到 hasOwnProperty，只能用 Object.hasOwn 判断自有属性
    const source = value as Record<string, unknown>;
    const plain: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (Object.hasOwn(source, key)) {
        plain[key] = toPlainStructure(source[key]);
      }
    }
    return plain;
  }
  return value;
}

// 支持显示 bigint 数据，如较长的订单号
const jsonData = computed<Record<string, unknown>>(
  /**
   * 解析待展示的 JSON 数据。
   * 非字符串直接使用原值；字符串按 bigint 安全模式解析，
   * 解析失败时返回空对象，保证查看器仍能渲染出结构而不是整块报错。
   * @returns 可直接交给查看器的对象。
   */
  () => {
    if (typeof props.value !== 'string') {
      // 查看器只按对象或数组结构渲染，其余原始值（数字、布尔、null、undefined）
      // 一律按空对象处理，沿用原先 `|| {}` 的兜底口径
      return isObject(props.value) ? props.value : {};
    }

    try {
      // 解析结果整体交给查看器渲染，具体形状由 JSON 文本决定；交给查看器前必须还原原型，
      // 否则对象根的文本会因查看器调用 hasOwnProperty 而渲染失败。
      return toPlainStructure(
        JsonBigint({ storeAsString: true }).parse(props.value),
      ) as Record<string, unknown>;
    } catch (error) {
      console.error('JSON parse error:', error);
      return {};
    }
  },
);

/**
 * 汇总透传给查看器的全部属性。
 * copyable 允许传布尔值或对象：布尔值只决定是否可复制，对象则可覆盖默认的复制文案。
 * @returns 合并属性、attrs 与事件回调后的属性对象。
 */
const bindProps = computed<Recordable<unknown>>(
  /**
   * 合并组件属性、透传属性与事件回调，顺序决定覆盖优先级。
   * @returns 合并后的查看器属性。
   */
  () => {
    const copyable = {
      copyText: $t('ui.jsonViewer.copy'),
      copiedText: $t('ui.jsonViewer.copied'),
      timeout: 2000,
      ...(isBoolean(props.copyable) ? {} : props.copyable),
    };

    return {
      ...props,
      ...attrs,
      value: jsonData.value,
      /**
       * 复制成功后向外透传事件，调用方据此提示用户。
       * @param event 查看器给出的复制完成事件。
       */
      onCopied: (event: JsonViewerAction) => emit('copied', event),
      /**
       * 节点被点击时透传键名，供外部做按字段展开或联动查询。
       * @param key 被点击节点的键名。
       */
      onKeyclick: (key: string) => emit('keyClick', key),
      /**
       * 整体点击交给统一的点击处理，内部决定是否继续向上抛。
       * @param event 原始鼠标事件。
       */
      onClick: (event: MouseEvent) => handleClick(event),
      copyable: props.copyable ? copyable : false,
    };
  },
);
</script>
<template>
  <VueJsonViewer v-bind="bindProps">
    <template #copy="slotProps">
      <slot name="copy" v-bind="slotProps"></slot>
    </template>
  </VueJsonViewer>
</template>
<style lang="scss">
@use './style.scss';
</style>
