/**
 * 代码编辑器组件（plugins 的 code-editor）真实行为回归。
 *
 * `CodeEditor` 是对内部 CodeMirror 编辑器的包装：它把 JSON 文本格式化后再交给编辑器，
 * 解析失败时必须抛 `formatError` 并保留原文，编辑器的变更必须冒泡为 `update:value` 与
 * `change`。用例挂载真实组件与真实 CodeMirror 实例，从 DOM 上取回编辑器对象后断言其真实
 * 取值与选项，而不是断言传入属性。
 *
 * 这里刻意渲染真实的内部编辑器而不是替换它：该 SFC 之前只被其它模块间接导入，覆盖率门禁
 * 因此报告"语句全命中、函数分母为 0"的假通过；只做浅渲染会把同一个假通过留给子组件。
 * 因此同一份用例继续覆盖内部编辑器的输入同步、窗口尺寸变化刷新与卸载竞态三条真实行为。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import CodeEditor from '../code-editor.vue';
import { MODE } from '../types';

/** CodeMirror 实例上本文件需要驱动的成员；第三方类型此处按实际用法收窄。 */
interface CodeMirrorInstance {
  /** 读取编辑器选项，用于核对属性是否正确透传。 */
  getOption: (option: string) => unknown;
  /** 读取编辑器当前文本。 */
  getValue: () => string;
  /** 重绘编辑器，窗口尺寸变化时由组件调用。 */
  refresh: () => void;
  /** 覆盖编辑器文本，会触发编辑器的 change 事件。 */
  setValue: (value: string) => void;
}

/** 带 CodeMirror 实例引用的 DOM 结构；第三方库把实例挂在容器元素上。 */
type CodeMirrorHost = HTMLElement & { CodeMirror?: CodeMirrorInstance };

/**
 * 等待内部编辑器完成初始化并从 DOM 取回真实实例。
 * @param wrapper 已挂载的编辑器组件。
 * @returns 真实的 CodeMirror 实例。
 * @throws 编辑器未在超时前创建时抛出，避免把未初始化当成通过。
 */
async function waitForEditor(wrapper: VueWrapper) {
  await vi.waitFor(
    /** 编辑器在子组件 onMounted + nextTick 之后创建，按真实条件等待。 */ () => {
      expect(wrapper.element.querySelector('.CodeMirror')).not.toBeNull();
    },
  );
  const host = wrapper.element.querySelector('.CodeMirror') as CodeMirrorHost;
  const editor = host.CodeMirror;
  if (!editor) {
    throw new Error('CodeMirror 实例必须挂在 .CodeMirror 容器上');
  }
  return editor;
}

/**
 * 挂载编辑器并等待内部实例就绪。
 * @param props 传给组件的真实属性。
 * @returns 组件包装器与内部编辑器实例。
 */
async function mountEditor(props: Record<string, unknown> = {}) {
  const wrapper = mount(CodeEditor, { props });
  const editor = await waitForEditor(wrapper);
  return { editor, wrapper };
}

describe('codeEditor 包装契约', /** JSON 格式化、属性透传与事件冒泡。 */ () => {
  it('jSON 模式下格式化文本后交给编辑器', /** 不格式化会让编辑器显示压缩成一行的 JSON。 */ async () => {
    const { editor, wrapper } = await mountEditor({
      mode: MODE.JSON,
      value: '{"a":1}',
    });

    expect(editor.getValue()).toBe('{\n  "a": 1\n}');
    expect(editor.getOption('mode')).toBe(MODE.JSON);

    wrapper.unmount();
  });

  it('关闭自动格式化时原样传递文本', /** 关闭后仍改写文本会破坏调用方看到的原始内容。 */ async () => {
    const { editor, wrapper } = await mountEditor({
      autoFormat: false,
      mode: MODE.JSON,
      value: '{"a":1}',
    });

    expect(editor.getValue()).toBe('{"a":1}');

    wrapper.unmount();
  });

  it('非 JSON 模式不做格式化', /** 对非 JSON 文本调用 JSON.parse 会抛错或破坏内容。 */ async () => {
    const { editor, wrapper } = await mountEditor({
      mode: MODE.JS,
      value: 'const a=1',
    });

    expect(editor.getValue()).toBe('const a=1');

    wrapper.unmount();
  });

  it('jSON 解析失败时抛出 formatError 并保留原文', /** 静默吞掉解析错误会让调用方以为格式化成功。 */ async () => {
    const { editor, wrapper } = await mountEditor({
      mode: MODE.JSON,
      value: '{bad',
    });

    expect(wrapper.emitted('formatError')).toEqual([['{bad']]);
    expect(editor.getValue()).toBe('{bad');

    wrapper.unmount();
  });

  it('非字符串取值按 JSON 序列化兜底', /** 绕过类型的调用方不能拿到 "[object Object]" 这类无效文本。 */ async () => {
    const { editor, wrapper } = await mountEditor({
      mode: MODE.JSON,
      value: { a: 1 } as unknown as string,
    });

    expect(editor.getValue()).toBe('{\n  "a": 1\n}');

    wrapper.unmount();
  });

  it('透传只读与边框属性', /** 只读或边框丢失会让调用方以为编辑器已锁定。 */ async () => {
    const { editor, wrapper } = await mountEditor({
      bordered: true,
      readonly: true,
      value: '{"a":1}',
    });

    expect(editor.getOption('readOnly')).toBe(true);
    expect(wrapper.find('.ant-input').exists()).toBe(true);

    wrapper.unmount();
  });

  it('内部编辑器变更冒泡为 update:value 与 change', /** 少抛一个事件会让 v-model 与校验逻辑拿不到新值。 */ async () => {
    const { editor, wrapper } = await mountEditor({
      mode: MODE.JSON,
      value: '{"a":1}',
    });

    editor.setValue('{"b":2}');

    await vi.waitFor(
      /** 编辑器把 change 事件排到后续回调里，按真实条件等待。 */ () => {
        expect(wrapper.emitted('update:value')).toEqual([['{"b":2}']]);
      },
    );
    expect(wrapper.emitted('change')).toEqual([['{"b":2}']]);

    wrapper.unmount();
  });
});

describe('内部 CodeMirror 编辑器协作', /** 包装组件依赖的三条真实行为。 */ () => {
  it('外部文本变化时同步到编辑器', /** 文本不同步会让表单回填后编辑器仍显示旧内容。 */ async () => {
    const { editor, wrapper } = await mountEditor({
      mode: MODE.JSON,
      value: '{"a":1}',
    });

    await wrapper.setProps({ value: '{"c":3}' });

    await vi.waitFor(
      /** 同步发生在 nextTick 之后，按真实条件等待。 */ () => {
        expect(editor.getValue()).toBe('{\n  "c": 3\n}');
      },
    );

    wrapper.unmount();
  });

  it('窗口尺寸变化后重绘编辑器', /** 不重绘会让缩放窗口后的光标与行号错位。 */ async () => {
    const { editor, wrapper } = await mountEditor({
      mode: MODE.JSON,
      value: '{"a":1}',
    });
    const refresh = vi.spyOn(editor, 'refresh');

    window.innerWidth = 1280;
    window.innerHeight = 720;
    window.dispatchEvent(new Event('resize'));

    await vi.waitFor(
      /** 重绘经真实防抖后触发，按调用结果等待而不是固定休眠。 */ () => {
        expect(refresh).toHaveBeenCalled();
      },
    );

    refresh.mockRestore();
    wrapper.unmount();
  });

  it('挂载后立即卸载时不创建编辑器且不报错', /** 卸载竞态下把空容器交给 CodeMirror 会产生难以定位的内部报错。 */ async () => {
    const wrapper = mount(CodeEditor, {
      props: { mode: MODE.JSON, value: '{"a":1}' },
    });

    wrapper.unmount();
    await nextTick();
    await nextTick();

    expect(wrapper.element.querySelector('.CodeMirror')).toBeNull();
  });
});
