/**
 * Vben 表格网格业务插槽委派（use-vxe-grid）真实行为回归。
 *
 * 网格把调用方传入的插槽按原名转发给第三方 vxe-grid：`delegatedSlots` 会排除掉自己接管的
 * 表单、空状态、加载与工具栏插槽，其余名字必须原样交给表格。委派列表算错或转发时改了名字，
 * 页面写在表格顶部、底部等区域的业务内容会整块消失，而且没有任何报错线索。用例挂载真实网格
 * 与真实 vxe-grid，把插槽交给第三方组件的默认布局容器渲染，断言可观察的 DOM 内容与转发后的
 * 插槽名；第三方表格自身的表格体渲染属外部边界，这里只依赖它公开的插槽契约。
 */
import { mount } from '@vue/test-utils';

import { useVbenForm } from '@vben-core/form-ui';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { VxeGrid } from 'vxe-table';

import { setupVbenVxeTable } from '../init';
import { useVbenVxeGrid } from '../use-vxe-grid';

beforeAll(
  /** 网格依赖初始化提供的表单工厂，先按真实启动顺序完成初始化。 */ () => {
    setupVbenVxeTable({
      /** 本用例不注入应用级表格配置，只验证初始化契约。 */ configVxeTable:
        () => {},
      useVbenForm,
    });
  },
);

/** 列表基线：列定义与行数据完整，保证表格本体能真实渲染。 */
function gridOptions() {
  return {
    columns: [{ field: 'name', title: '名称' }],
    data: [{ name: '研发部' }],
  };
}

describe('业务插槽按原名委派给真实表格', /** 委派失败会让页面自定义的表格区域整块消失。 */ () => {
  it('顶部插槽按原名转发并渲染业务内容', /** 委派名单或转发名字写错会让页面传入的顶部区块不显示。 */ async () => {
    const [Grid, api] = useVbenVxeGrid({ gridOptions: gridOptions() });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
      slots: {
        /** 表格顶部区域业务插槽，名字必须与 delegatedSlots 计算出的结果一致。 */
        top: /** 渲染可识别的顶部业务内容。 */ () => '顶部业务区块',
      },
    });

    await vi.waitFor(
      /** 等待真实表格把委派插槽渲染进顶部容器。 */ () => {
        expect(wrapper.find('.vxe-grid--top-wrapper').exists()).toBe(true);
      },
      { timeout: 3000 },
    );
    expect(wrapper.get('.vxe-grid--top-wrapper').text()).toContain(
      '顶部业务区块',
    );
    // 业务插槽名按原名到达第三方表格，未被改名或丢弃。
    expect(Object.keys(wrapper.findComponent(VxeGrid).vm.$slots)).toContain(
      'top',
    );
    wrapper.unmount();
  });

  it('底部插槽同样按原名转发并渲染业务内容', /** 只转发固定几个名字会让其他业务区块静默丢失。 */ async () => {
    const [Grid, api] = useVbenVxeGrid({ gridOptions: gridOptions() });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
      slots: {
        /** 表格底部区域业务插槽，与顶部插槽走同一条委派链路。 */
        bottom: /** 渲染可识别的底部业务内容。 */ () => '底部业务区块',
      },
    });

    await vi.waitFor(
      /** 等待真实表格把委派插槽渲染进底部容器。 */ () => {
        expect(wrapper.find('.vxe-grid--bottom-wrapper').exists()).toBe(true);
      },
      { timeout: 3000 },
    );
    expect(wrapper.get('.vxe-grid--bottom-wrapper').text()).toContain(
      '底部业务区块',
    );
    wrapper.unmount();
  });
});
