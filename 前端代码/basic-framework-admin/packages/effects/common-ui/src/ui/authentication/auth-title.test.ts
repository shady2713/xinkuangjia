/**
 * 登录页标题（effects/common-ui 的 ui/authentication/auth-title）双插槽渲染回归。
 *
 * 该组件把主标题与说明分成两个插槽：主标题缺失会让登录页没有明确的页面主题，说明插槽缺失会让
 * 用户看不到登录方式提示。用例真实挂载组件并读取两个插槽的真实落点。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import AuthTitle from './auth-title.vue';

describe('登录页标题', /** 标题与说明决定用户能否确认当前页面用途。 */ () => {
  it('主标题渲染为二级标题，说明渲染为段落', /** 标签用错会让页面的标题层级与语义失配。 */ () => {
    const wrapper = mount(AuthTitle, {
      slots: { default: '登录系统', desc: '请使用企业账号登录' },
    });

    const heading = wrapper.find('h2');
    expect(heading.text()).toBe('登录系统');
    expect(heading.classes()).toContain('font-bold');
    const description = wrapper.find('p');
    expect(description.text()).toBe('请使用企业账号登录');
    expect(description.classes()).toContain('text-muted-foreground');
  });

  it('未传说明时不渲染说明文案', /** 空说明会让页面出现多余留白。 */ () => {
    const wrapper = mount(AuthTitle, { slots: { default: '登录系统' } });

    expect(wrapper.find('p').text()).toBe('');
  });
});
