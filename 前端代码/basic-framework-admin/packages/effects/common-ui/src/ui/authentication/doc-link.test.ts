/**
 * 登录页使用提示（effects/common-ui 的 ui/authentication/doc-link）文案渲染回归。
 *
 * 该组件在登录表单下方渲染三条使用提示：提示缺失或结构丢失会让首次部署的用户看不到环境与
 * 资料获取说明。用例真实挂载组件并读取真实 DOM 与三条提示文案。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import DocLink from './doc-link.vue';

describe('登录页使用提示', /** 提示文案决定用户能否自助完成首次部署检查。 */ () => {
  it('渲染分隔标题与三条提示', /** 提示缺失会让用户不知道去哪里确认环境与资料。 */ () => {
    const wrapper = mount(DocLink);

    expect(wrapper.text()).toContain('使用提示');
    const paragraphs = wrapper.findAll('p');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.text()).toContain('接口地址');
    expect(paragraphs[1]?.text()).toContain('项目维护人');
    expect(paragraphs[2]?.text()).toContain('对外发布前');
    expect(wrapper.find('.border-b').exists()).toBe(true);
  });
});
