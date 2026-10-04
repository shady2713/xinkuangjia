/** 内嵌页视图组件测试：验证占位容器真实渲染，且布局包按约定名称导出该组件。 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import { IFrameView } from '../index';

describe('iframe-view', /** 该组件是内嵌菜单的渲染入口，导出名或根节点变化会直接影响路由装配。 */ () => {
  it('渲染一个空的占位容器', /** 布局外层负责放置真实 iframe，这里只提供挂载点，不能渲染出多余内容。 */ () => {
    const wrapper = mount(IFrameView);

    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.text()).toBe('');
    expect(wrapper.find('iframe').exists()).toBe(false);
  });
});
