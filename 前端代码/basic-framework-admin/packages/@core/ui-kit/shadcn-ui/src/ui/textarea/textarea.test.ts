/**
 * 多行文本框（shadcn-ui 的 ui/textarea）绑定与样式回归。
 *
 * 文本域用于备注、说明等多行输入：初始值必须回填，输入必须抛出新的字符串，默认值口用于
 * 无父级绑定时的兜底。绑定失效会让用户输入的内容丢失。用例真实挂载文本域并读取真实 DOM 的
 * value 与组件抛出的双向绑定事件。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Textarea from './Textarea.vue';

describe('多行文本框绑定', /** 绑定失效会让用户输入的多行内容静默丢失。 */ () => {
  it('回填 modelValue 并合并调用方 class', /** 初始值未回填会让编辑场景显示空白。 */ () => {
    const wrapper = mount(Textarea, {
      props: { class: 'custom-textarea', modelValue: '第一行' },
    });

    expect(wrapper.element.tagName).toBe('TEXTAREA');
    expect((wrapper.element as HTMLTextAreaElement).value).toBe('第一行');
    expect(wrapper.classes()).toContain('min-h-[60px]');
    expect(wrapper.classes()).toContain('custom-textarea');
  });

  it('输入时抛出更新后的值', /** 不抛出会让父组件永远拿到初始值。 */ () => {
    const wrapper = mount(Textarea, { props: { modelValue: '' } });

    wrapper.setValue('第二行');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['第二行']);
  });

  it('未绑定 modelValue 时使用 defaultValue', /** 缺少兜底会让仅设置默认值的场景显示空文本域。 */ () => {
    const wrapper = mount(Textarea, { props: { defaultValue: '默认说明' } });

    expect((wrapper.element as HTMLTextAreaElement).value).toBe('默认说明');
  });
});
