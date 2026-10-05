/**
 * 双栏页面容器（common-ui 的 components/col-page/col-page）真实行为回归。
 *
 * 容器把左侧固定栏与右侧内容栏并排交给可拖拽面板组，并把页面属性与具名插槽转发给内部的
 * 页面组件：只应转发左栏宽度以外的属性，多转发或漏转发都会让页面标题、说明与页脚消失；
 * 左栏的展开与收起命令必须真正作用到面板上，否则调用方点了按钮布局毫无变化；关闭可拖拽
 * 时不得留下一条可拖的分隔线。用例真实挂载容器，点击左栏命令按钮并断言真实面板状态。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import ColPage from './col-page.vue';

/** 左栏插槽收到的能力：容器把真实面板的展开与收起命令透传给调用方。 */
interface LeftSlotProps {
  /** 收起左栏。 */
  collapse: () => void;
  /** 展开左栏。 */
  expand: () => void;
  /** 左栏当前是否已收起。 */
  isCollapsed: boolean;
}

/**
 * 渲染左栏内容：把容器抛出的收起、展开命令做成可点击按钮，并回显当前收起状态。
 * @param slotProps 容器透传给左栏插槽的面板能力与状态。
 * @returns 左栏内容的虚拟节点。
 */
function leftSlot(slotProps: LeftSlotProps) {
  return h(
    'div',
    {
      class: 'left-slot',
      'data-collapsed': String(slotProps.isCollapsed),
    },
    [
      h(
        'button',
        { class: 'collapse-left', onClick: slotProps.collapse },
        'DUMMY-收起',
      ),
      h(
        'button',
        { class: 'expand-left', onClick: slotProps.expand },
        'DUMMY-展开',
      ),
    ],
  );
}

describe('双栏页面结构', /** 属性与插槽转发决定页面标题、说明与页脚能否显示。 */ () => {
  it('把页面属性转发给页面组件并渲染标题', /** 属性漏转发会让页面标题与说明整块消失。 */ () => {
    const wrapper = mount(ColPage, {
      props: { description: 'DUMMY-页面说明', title: 'DUMMY-双栏页面' },
      slots: { default: '<div class="right-content">DUMMY-右栏</div>' },
    });

    expect(wrapper.text()).toContain('DUMMY-双栏页面');
    expect(wrapper.text()).toContain('DUMMY-页面说明');
    expect(wrapper.find('.right-content').text()).toBe('DUMMY-右栏');
    wrapper.unmount();
  });

  it('只截留左栏宽度，其余面板属性按原样转发', /** 左栏宽度被转发出去会污染页面根节点，其余属性丢失则面板尺寸失效。 */ () => {
    const wrapper = mount(ColPage, {
      props: { leftWidth: 25, rightWidth: 75, title: 'DUMMY-双栏页面' },
      slots: { default: '<div class="right-content">DUMMY-右栏</div>' },
    });

    // 左栏宽度由容器自己消费，不再向下转发。
    expect(wrapper.attributes('leftwidth')).toBeUndefined();
    // 其余面板属性继续透传，页面根节点上可以看到真实取值。
    expect(wrapper.attributes('rightwidth')).toBe('75');
    expect(wrapper.attributes('resizable')).toBeDefined();
    wrapper.unmount();
  });

  it('把左栏与内容插槽交给面板组，不当作页面插槽转发', /** 左栏内容被当成页面插槽会让面板区渲染出重复内容。 */ () => {
    const wrapper = mount(ColPage, {
      props: { title: 'DUMMY-双栏页面' },
      slots: {
        default: '<div class="right-content">DUMMY-右栏</div>',
        left: leftSlot,
      },
    });

    const panels = wrapper.findAll('[data-panel]');
    expect(panels).toHaveLength(2);
    expect(panels[0]?.find('.left-slot').exists()).toBe(true);
    expect(panels[1]?.find('.right-content').exists()).toBe(true);
    // 左栏内容只出现在面板里，页面页头区域不得重复渲染一份。
    expect(wrapper.findAll('.left-slot')).toHaveLength(1);
    wrapper.unmount();
  });

  it('把额外操作、标题与页脚插槽转发到页面容器', /** 具名插槽漏转发会让自定义操作按钮与页脚无处安放。 */ () => {
    const wrapper = mount(ColPage, {
      props: { title: 'DUMMY-双栏页面' },
      slots: {
        default: '<div class="right-content">DUMMY-右栏</div>',
        description: '<p class="page-description">DUMMY-插槽说明</p>',
        extra: '<span class="page-extra">DUMMY-额外操作</span>',
        footer: '<p class="page-footer">DUMMY-页脚</p>',
        title: '<h2 class="page-title-slot">DUMMY-标题插槽</h2>',
      },
    });

    expect(wrapper.find('.page-title-slot').text()).toBe('DUMMY-标题插槽');
    expect(wrapper.find('.page-description').text()).toBe('DUMMY-插槽说明');
    expect(wrapper.find('.page-extra').text()).toBe('DUMMY-额外操作');
    expect(wrapper.find('.page-footer').text()).toBe('DUMMY-页脚');
    // 页脚必须渲染在内容区之外，避免被内容高度折算重复计入。
    expect(wrapper.find('.page-footer').element.closest('[data-panel]')).toBe(
      null,
    );
    wrapper.unmount();
  });
});

describe('双栏可拖拽面板', /** 面板尺寸与拖拽手柄决定用户能否按需分配左右空间。 */ () => {
  it('按左右宽度渲染两个面板并默认显示拖拽手柄', /** 宽度读错或手柄缺失会让双栏布局无法调整。 */ () => {
    const wrapper = mount(ColPage, {
      props: { leftWidth: 25, rightWidth: 75 },
      slots: {
        default: '<div class="right-content">DUMMY-右栏</div>',
        left: leftSlot,
      },
    });

    const group = wrapper.find('[data-panel-group]');
    const panels = wrapper.findAll('[data-panel]');
    expect(group.attributes('data-orientation')).toBe('horizontal');
    expect(group.classes()).toContain('w-full');
    expect(panels[0]?.attributes('data-panel-size')).toBe('25.0');
    expect(panels[1]?.attributes('data-panel-size')).toBe('75.0');
    expect(wrapper.find('[data-resize-handle]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('左栏命令按钮真实收起与展开左栏', /** 命令未作用到面板上会让调用方的按钮点了没反应。 */ async () => {
    const wrapper = mount(ColPage, {
      props: { leftCollapsible: true, leftWidth: 30 },
      slots: {
        default: '<div class="right-content">DUMMY-右栏</div>',
        left: leftSlot,
      },
    });
    // 面板组在挂载后的一个更新周期内完成布局登记，命令必须作用在已登记的布局上。
    await nextTick();
    const leftPanel = wrapper.findAll('[data-panel]')[0];

    expect(leftPanel?.attributes('data-state')).toBe('expanded');
    expect(wrapper.find('.left-slot').attributes('data-collapsed')).toBe(
      'false',
    );

    await wrapper.find('.collapse-left').trigger('click');
    await vi.waitFor(
      /** 等待面板尺寸与收起状态同步到真实 DOM。 */ () => {
        expect(leftPanel?.attributes('data-state')).toBe('collapsed');
      },
    );
    expect(leftPanel?.attributes('data-panel-size')).toBe('0.0');
    expect(wrapper.find('.left-slot').attributes('data-collapsed')).toBe(
      'true',
    );

    await wrapper.find('.expand-left').trigger('click');
    await vi.waitFor(
      /** 等待面板恢复到收起前的尺寸。 */ () => {
        expect(leftPanel?.attributes('data-state')).toBe('expanded');
      },
    );
    expect(leftPanel?.attributes('data-panel-size')).toBe('30.0');
    wrapper.unmount();
  });

  it('关闭可拖拽时不渲染分隔线', /** 关闭可拖拽仍留下分隔线会让用户拖动一个无效的分隔条。 */ () => {
    const wrapper = mount(ColPage, {
      props: { resizable: false },
      slots: { default: '<div class="right-content">DUMMY-右栏</div>' },
    });

    expect(wrapper.find('[data-resize-handle]').exists()).toBe(false);
    // 两个面板仍在，只是不可拖拽。
    expect(wrapper.findAll('[data-panel]')).toHaveLength(2);
    wrapper.unmount();
  });

  it('关闭分隔线时把分隔线绘制成透明', /** 关闭分隔线仍画出实线会让双栏之间多出一条不存在的边界。 */ () => {
    const wrapper = mount(ColPage, {
      props: { splitLine: false },
      slots: { default: '<div class="right-content">DUMMY-右栏</div>' },
    });

    expect(wrapper.find('[data-resize-handle]').attributes('style')).toContain(
      'background-color: transparent',
    );
    wrapper.unmount();
  });

  it('开启把手时渲染抓取图标', /** 缺少抓取图标会让用户不知道分隔线可以拖动。 */ () => {
    const wrapper = mount(ColPage, {
      props: { splitHandle: true },
      slots: { default: '<div class="right-content">DUMMY-右栏</div>' },
    });

    expect(wrapper.find('[data-resize-handle] div').exists()).toBe(true);
    expect(wrapper.find('[data-resize-handle] svg').exists()).toBe(true);
    wrapper.unmount();
  });
});
