/**
 * JSON 查看器组件（common-ui 的 json-viewer）真实行为回归。
 *
 * 该组件把任意取值交给第三方查看器渲染，并对外暴露点击、键名点击、复制与 valueClick 事件：
 * 解析口径写错会让大整数被科学计数法截断或让非法文本整块报错，对象形式的文本若把 json-bigint
 * 的无原型对象直接交给查看器，还会在渲染期因节点缺少 hasOwnProperty 而让整块区域空白；事件
 * 组装写错会让调用方拿不到节点路径与展开层级。用例挂载真实组件与真实查看器，等第三方完成
 * 异步数据装载后从真实 DOM 取节点并触发点击，断言抛出的载荷与渲染内容。
 *
 * 说明：第三方查看器在 `mounted` 里用 `setTimeout(0)` 装载数据，因此断言前必须等待键节点出现，
 * 不能用固定休眠猜测；复制事件需要真实剪贴板，这里只在组件边界上驱动第三方实例的 `copied`
 * 事件，用于核对本组件的透传契约，不声称真实剪贴板交互已验证。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { JsonViewerProps } from '../types';

import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import JsonViewer from '../index.vue';

/** 组件抛出的 valueClick 载荷形状，与组件契约一致。 */
interface ValueClickPayload {
  /** 被点击节点的 DOM 元素。 */
  el: HTMLElement;
  /** 节点在数据中的路径，例如 `$.a`。 */
  path: string;
  /** 节点层级，根节点为 0。 */
  depth: number;
  /** 由节点文本解析出的原始值。 */
  value: unknown;
}

/**
 * 挂载真实查看器组件。
 * @param props 传给组件的真实属性；`value` 是组件必填项，其余属性可选。
 * @returns 组件包装器。
 */
function mountViewer(
  props: Partial<JsonViewerProps> & Pick<JsonViewerProps, 'value'>,
) {
  return mount(JsonViewer, { props });
}

/**
 * 等待第三方查看器完成异步数据装载。
 * @param wrapper 已挂载的查看器组件。
 */
async function waitForData(wrapper: VueWrapper) {
  await vi.waitFor(
    /** 键节点出现代表第三方已经把数据写进内部状态。 */ () => {
      expect(wrapper.find('.jv-key').exists()).toBe(true);
    },
  );
}

/**
 * 从组件实例中取出抛出的载荷列表。
 * @param wrapper 已挂载的查看器组件。
 * @param event 事件名。
 * @returns 该事件每次触发时的参数数组。
 */
function emittedPayloads(wrapper: VueWrapper, event: string) {
  return (wrapper.emitted(event) ?? []) as unknown[][];
}

describe('jsonViewer 解析口径', /** 取值转换决定查看器能否正确展示数据。 */ () => {
  it('对象取值按结构渲染键与值', /** 结构未展开或键丢失会让查看器只剩空壳。 */ async () => {
    const wrapper = mountViewer({
      expandDepth: 3,
      value: { a: 1, nested: { b: 'x' } },
    });

    await waitForData(wrapper);

    expect(wrapper.text()).toContain('a:');
    expect(wrapper.text()).toContain('nested:');
    expect(wrapper.text()).toContain('"x"');
    expect(wrapper.find('.jv-item.jv-number').text()).toBe('1');

    wrapper.unmount();
  });

  it('数组形式的 JSON 文本按结构渲染', /** 文本取值必须真正走进解析分支，否则大整数会被静默降级。 */ async () => {
    const wrapper = mountViewer({ expandDepth: 3, value: '[1,2]' });

    await waitForData(wrapper);

    expect(wrapper.find('.jv-item.jv-array').exists()).toBe(true);
    expect(wrapper.text()).toContain('1');
    expect(wrapper.text()).toContain('2');

    wrapper.unmount();
  });

  it('jSON 文本中的大整数按字符串保留', /** 走原生 JSON.parse 会丢失长订单号的低位精度。 */ async () => {
    const wrapper = mountViewer({
      expandDepth: 3,
      value: '[12345678901234567890]',
    });

    await waitForData(wrapper);

    expect(wrapper.text()).toContain('"12345678901234567890"');

    wrapper.unmount();
  });

  it('对象形式的 JSON 文本按结构渲染键与值', /** 真实缺陷回归：json-bigint 返回无原型对象，查看器调用其 hasOwnProperty 抛错会让对象根文本整块渲染失败。 */ async () => {
    const errors: unknown[] = [];
    const wrapper = mount(JsonViewer, {
      global: {
        config: {
          /** 收集渲染期异常，供断言核对对象根文本不再触发第三方查看器崩溃。 */
          errorHandler: /** 记录渲染异常，避免未处理错误中断整个测试文件。 */ (
            error,
          ) => {
            errors.push(error);
          },
        },
      },
      props: { expandDepth: 3, value: '{"a":1,"nested":{"b":"x"}}' },
    });

    await waitForData(wrapper);

    expect(wrapper.text()).toContain('a:');
    expect(wrapper.text()).toContain('nested:');
    expect(wrapper.text()).toContain('b:');
    expect(wrapper.text()).toContain('"x"');
    expect(wrapper.find('.jv-item.jv-number').text()).toBe('1');
    // 解析结果必须还原成原型正常的普通对象，渲染期不得出现任何异常。
    expect(errors).toEqual([]);

    wrapper.unmount();
  });

  it('对象形式的 JSON 文本解析结果不带原型也能安全渲染', /** 修复点在无原型对象上：数组根沿用 Array.prototype，对象根与嵌套对象都必须还原。 */ async () => {
    const wrapper = mount(JsonViewer, {
      props: { expandDepth: 3, value: '{"outer":{"inner":{"deep":true}}}' },
    });

    await waitForData(wrapper);

    expect(wrapper.text()).toContain('outer:');
    expect(wrapper.text()).toContain('inner:');
    expect(wrapper.text()).toContain('deep:');
    expect(wrapper.text()).toContain('true');

    wrapper.unmount();
  });

  it('jSON 文本解析失败时记录错误并渲染空对象', /** 解析失败直接抛出会让整块区域报错而不是降级展示。 */ async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});

    const wrapper = mountViewer({ value: '{bad' });

    expect(error).toHaveBeenCalledWith(
      'JSON parse error:',
      expect.objectContaining({ name: 'SyntaxError' }),
    );
    expect(wrapper.find('.jv-item.jv-object').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('bad');

    error.mockRestore();
    wrapper.unmount();
  });

  it('非对象取值兜底为空对象', /** 数字或布尔直接交给查看器会渲染失败或显示无效内容。 */ () => {
    const wrapper = mountViewer({ value: 42 });

    expect(wrapper.find('.jv-item.jv-object').exists()).toBe(true);
    expect(wrapper.findAll('.jv-key')).toHaveLength(0);

    wrapper.unmount();
  });
});

describe('jsonViewer 点击事件', /** 点击载荷决定调用方能否做字段联动。 */ () => {
  it('点击叶子节点抛出带路径与层级的 valueClick', /** 路径或层级写错会让联动查询定位到错误的字段。 */ async () => {
    const wrapper = mountViewer({
      expandDepth: 3,
      value: { a: 1, nested: { b: 'x' } },
    });
    await waitForData(wrapper);

    // 文本叶子本身没有 path 属性，path 挂在包裹它的 jv-push 上，必须点击真实文本节点。
    const leaf = wrapper.find('.jv-push[path="$.nested.b"] .jv-item');
    await leaf.trigger('click');

    const [rawPayload] = emittedPayloads(wrapper, 'valueClick');
    const payload = rawPayload?.[0] as ValueClickPayload;
    expect(payload.el).toBe(leaf.element);
    expect(payload.path).toBe('$.nested.b');
    expect(payload.depth).toBe(2);
    expect(payload.value).toBe('x');
    // 命中节点时原始点击事件仍要抛出，保证外层埋点不受影响。
    expect(emittedPayloads(wrapper, 'click')).toHaveLength(1);

    wrapper.unmount();
  });

  it('点击数字节点解析为数字', /** 文本不解析会让调用方拿到字符串形式的数字。 */ async () => {
    const wrapper = mountViewer({ expandDepth: 3, value: { a: 1 } });
    await waitForData(wrapper);

    await wrapper.find('.jv-push[path="$.a"]').trigger('click');

    const [rawPayload] = emittedPayloads(wrapper, 'valueClick');
    expect((rawPayload?.[0] as ValueClickPayload).value).toBe(1);

    wrapper.unmount();
  });

  it('点击结构化节点不抛出任何事件', /** 真实缺陷：缺少 path 时提前 return，连源码注释承诺的原始 click 也一并丢失。 */ async () => {
    const wrapper = mountViewer({ expandDepth: 3, value: { a: 1 } });
    await waitForData(wrapper);

    await wrapper.find('.jv-item.jv-object').trigger('click');

    expect(wrapper.emitted('valueClick')).toBeUndefined();
    expect(wrapper.emitted('click')).toBeUndefined();

    wrapper.unmount();
  });

  it('点击键名抛出 keyClick', /** 键名点击丢失会让按字段展开或联动查询失效。 */ async () => {
    const wrapper = mountViewer({ expandDepth: 3, value: { a: 1 } });
    await waitForData(wrapper);

    await wrapper.find('.jv-key').trigger('click');

    const [rawPayload] = emittedPayloads(wrapper, 'keyClick');
    expect(rawPayload?.[0]).toBe('$.a');

    wrapper.unmount();
  });
});

describe('jsonViewer 属性与事件透传', /** 透传契约决定调用方能否定制外观并接收第三方事件。 */ () => {
  it('可复制开关为真时补全复制文案配置', /** 只传布尔值时不补文案会让复制按钮显示空白。 */ () => {
    const wrapper = mountViewer({ copyable: true, value: { a: 1 } });
    const library = wrapper.findComponent({ name: 'JsonViewer' });
    const copyable = library.props('copyable') as {
      /** 复制后展示的文案。 */
      copiedText: string;
      /** 复制前展示的文案。 */
      copyText: string;
      /** 文案恢复时间，单位毫秒。 */
      timeout: number;
    };

    expect(copyable.timeout).toBe(2000);
    expect(copyable.copyText.length).toBeGreaterThan(0);
    expect(copyable.copiedText.length).toBeGreaterThan(0);
    expect(wrapper.find('.jv-button').exists()).toBe(true);

    wrapper.unmount();
  });

  it('可复制开关为假时不渲染复制按钮', /** 关闭复制后仍显示按钮会让用户点到无效操作。 */ () => {
    const wrapper = mountViewer({ copyable: false, value: { a: 1 } });
    const library = wrapper.findComponent({ name: 'JsonViewer' });

    expect(library.props('copyable')).toBe(false);
    expect(wrapper.find('.jv-button').exists()).toBe(false);

    wrapper.unmount();
  });

  it('未声明的属性透传到查看器根节点', /** 属性丢失会让调用方无法通过 class 定制样式。 */ () => {
    const wrapper = mount(JsonViewer, {
      attrs: { class: 'custom-json-viewer' },
      props: { value: { a: 1 } },
    });

    expect(wrapper.find('.jv-container').classes()).toContain(
      'custom-json-viewer',
    );

    wrapper.unmount();
  });

  it('第三方复制事件按原载荷向上抛出', /** 复制回调不透传会让调用方无法提示复制成功。 */ () => {
    const wrapper = mountViewer({ copyable: true, value: { a: 1 } });
    const library = wrapper.findComponent({ name: 'JsonViewer' });
    const action = {
      action: 'copy',
      text: '{"a":1}',
      trigger: wrapper.element,
    };

    library.vm.$emit('copied', action);

    const [rawPayload] = emittedPayloads(wrapper, 'copied');
    expect(rawPayload?.[0]).toEqual(action);

    wrapper.unmount();
  });
});
