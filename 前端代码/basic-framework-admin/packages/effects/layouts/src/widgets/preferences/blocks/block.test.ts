/**
 * 偏好设置分组块（preferences/blocks/block.vue）渲染回归。
 *
 * 抽屉里每个偏好分组都由它渲染标题与内容插槽：标题缺失会让用户不知道这一组在配置什么，
 * 插槽未渲染会让整组设置项凭空消失。用例真实挂载组件，读取真实标题节点与插槽内容。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Block from './block.vue';

describe('偏好设置分组块', /** 标题与插槽决定分组能否被用户识别与操作。 */ () => {
  it('渲染标题与默认插槽内容', /** 标题或插槽缺失会让整个分组不可用。 */ () => {
    const wrapper = mount(Block, {
      props: { title: 'DUMMY-外观设置' },
      slots: { default: '<div class="block-body">DUMMY-分组内容</div>' },
    });

    const heading = wrapper.find('h3');
    expect(heading.text()).toBe('DUMMY-外观设置');
    expect(heading.classes()).toContain('font-semibold');
    expect(heading.classes()).toContain('mb-3');
    expect(wrapper.find('.block-body').text()).toBe('DUMMY-分组内容');
    expect(wrapper.classes()).toContain('flex-col');
    expect(wrapper.classes()).toContain('py-4');
  });

  it('未传标题时渲染空标题', /** 标题渲染成 undefined 文案会让界面上出现脏文本。 */ () => {
    const wrapper = mount(Block, {
      slots: { default: '<div class="block-body">DUMMY-分组内容</div>' },
    });

    expect(wrapper.find('h3').text()).toBe('');
    expect(wrapper.find('.block-body').exists()).toBe(true);
  });

  it('声明偏好分组组件名', /** 组件名缺失会让调试工具与递归组件无法定位该分组。 */ () => {
    const wrapper = mount(Block);

    expect(wrapper.vm.$options.name).toBe('PreferenceBlock');
  });
});
