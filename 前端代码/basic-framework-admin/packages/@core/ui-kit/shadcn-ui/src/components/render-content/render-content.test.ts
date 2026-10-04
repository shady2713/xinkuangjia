/**
 * 内容渲染器（render-content.vue）的真实行为回归。
 *
 * 该组件按内容形态分三条路径：空内容不渲染、字符串按文本或按行拆段渲染、组件按 props 与插槽透传渲染。
 * 断言读取真实渲染出的节点、文本与透传结果，不检查渲染函数的内部实现。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { describe, expect, it } from 'vitest';

import RenderContent from './render-content.vue';

/** 用于验证组件分支透传的最小业务组件，把收到的标签与插槽渲染成可断言的节点。 */
const PassthroughChild = defineComponent({
  name: 'PassthroughChild',
  props: {
    /** 由外层通过属性透传进来的标签文本。 */
    label: { default: '', type: String },
  },
  template: `
    <section class="passthrough-child" :data-label="label">
      <span class="passthrough-label">{{ label }}</span>
      <span class="passthrough-slot"><slot /></span>
    </section>
  `,
});

describe('内容渲染形态（render-content.vue）', /** 三种内容形态各自的可观察渲染结果。 */ () => {
  it('空内容不渲染任何节点', /** 没有内容时返回 null，不能渲染空文本节点占位。 */ () => {
    const wrapper = mount(RenderContent, {
      props: { content: undefined },
    });

    expect(wrapper.find('.passthrough-child').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  it('空字符串内容同样不渲染', /** 空字符串属于假值，应与未声明内容一致地不渲染。 */ () => {
    const wrapper = mount(RenderContent, {
      props: { content: '' },
    });

    expect(wrapper.text()).toBe('');
  });

  it('字符串内容按纯文本渲染', /** renderBr 关闭时字符串整体作为文本，不拆分成段落。 */ () => {
    const wrapper = mount(RenderContent, {
      props: { content: '第一行\n第二行' },
    });

    expect(wrapper.findAll('p')).toHaveLength(0);
    expect(wrapper.text()).toBe('第一行\n第二行');
  });

  it('开启换行渲染时按行拆成段落', /** renderBr 打开时每一行独立成一个段落节点，行序与内容必须保持。 */ () => {
    const wrapper = mount(RenderContent, {
      props: { content: '第一行\n第二行\n第三行', renderBr: true },
    });

    const paragraphs = wrapper.findAll('p');
    expect(paragraphs).toHaveLength(3);
    expect(
      paragraphs.map(/** 读取单个段落的文本，用于核对行序。 */ (p) => p.text()),
    ).toEqual(['第一行', '第二行', '第三行']);
  });

  it('单行文本开启换行渲染时只有一个段落', /** 没有换行符时不产生额外空段落。 */ () => {
    const wrapper = mount(RenderContent, {
      props: { content: '唯一一行', renderBr: true },
    });

    expect(wrapper.findAll('p')).toHaveLength(1);
    expect(wrapper.text()).toBe('唯一一行');
  });

  it('组件内容透传属性与插槽', /** 组件形态必须把外层属性与插槽交给目标组件，否则业务无法自定义渲染内容。 */ () => {
    const wrapper = mount(RenderContent, {
      props: {
        content: PassthroughChild,
        label: '透传标签',
      },
      slots: {
        default: '<b class="slot-marker">插槽内容</b>',
      },
    });

    const child = wrapper.find('.passthrough-child');
    expect(child.exists()).toBe(true);
    expect(child.attributes('data-label')).toBe('透传标签');
    expect(wrapper.find('.slot-marker').text()).toBe('插槽内容');
  });

  it('渲染函数内容被调用并渲染其返回节点', /** 函数形态按组件调用，返回值才是真正渲染的节点，未调用或返回值无效都会渲染为空。 */ () => {
    const wrapper = mount(RenderContent, {
      props: {
        // 渲染函数形态：调用后返回待渲染的节点与插槽内容。
        content: () =>
          h(
            PassthroughChild,
            { label: '渲染函数标签' },
            {
              /** 渲染函数自带的插槽内容，用于确认返回节点被完整渲染。 */
              default: () => h('i', { class: 'fn-slot' }, '函数插槽'),
            },
          ),
      },
    });

    expect(wrapper.find('.passthrough-child').attributes('data-label')).toBe(
      '渲染函数标签',
    );
    expect(wrapper.find('.fn-slot').text()).toBe('函数插槽');
  });
});
