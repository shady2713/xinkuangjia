/**
 * VxeGrid 组合式函数（use-vxe-grid）的真实行为回归。
 *
 * `useVbenVxeGrid` 是业务页面创建表格的唯一入口：它必须返回真实表格组件与 API 实例，
 * 把 API 的状态订阅能力接上，并在组件渲染时把属性同步进 API、把真实表格实例交回 API。
 * 返回顺序写反会让页面把 API 当组件渲染，状态订阅缺失会让页面无法响应表格变化。
 * 用例挂载真实表格组件并读取真实 DOM 与 API 状态，只替换第三方表格之外的实现。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { useVbenForm } from '@vben-core/form-ui';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { VxeGridApi } from '../api';
import { setupVbenVxeTable } from '../init';
import { useVbenVxeGrid } from '../use-vxe-grid';

beforeAll(
  /** 表格组件依赖全局初始化提供的表单工厂，先按真实启动顺序完成初始化。 */ () => {
    setupVbenVxeTable({
      /** 本用例不注入应用级表格配置，只验证初始化契约。 */ configVxeTable:
        () => {},
      useVbenForm,
    });
  },
);

/** 构造列定义与行数据完整的表格配置，作为各用例的合法基线。 */
function gridOptions() {
  return {
    columns: [{ field: 'name', title: '部门' }],
    data: [{ name: '研发部' }],
  };
}

describe('useVbenVxeGrid', /** 返回值顺序、状态订阅与渲染期属性同步。 */ () => {
  it('按组件、API 的顺序返回并暴露状态订阅能力', /** 顺序写反会让页面把 API 实例当组件渲染，订阅能力缺失则无法响应状态变化。 */ () => {
    const result = useVbenVxeGrid({ gridOptions: gridOptions() });
    const [Grid, api] = result;

    expect(result).toHaveLength(2);
    expect(api).toBeInstanceOf(VxeGridApi);
    expect(api.useStore).toBeTypeOf('function');
    expect(Grid).toBeTypeOf('object');
  });

  it('状态订阅读取真实表格状态并跟随更新', /** 订阅读不到真实状态会让页面展示与表格配置脱节。 */ async () => {
    const [, api] = useVbenVxeGrid({ gridOptions: gridOptions() });

    const columns = api.useStore(
      /** 订阅列定义，用于验证订阅结果跟随真实状态变化。 */ (state) =>
        state.gridOptions?.columns,
    );
    expect(columns.value).toEqual([{ field: 'name', title: '部门' }]);

    api.setGridOptions({
      columns: [{ field: 'age', title: '年龄' }],
      data: [],
    });
    await nextTick();

    expect(columns.value).toEqual([{ field: 'age', title: '年龄' }]);
  });

  it('挂载后渲染真实表格、同步属性并把表格实例交回 API', /** 不渲染真实表格或不同步属性会让页面空白且 API 拿到空实例。 */ async () => {
    const [Grid, api] = useVbenVxeGrid({ gridOptions: gridOptions() });

    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api, gridOptions: gridOptions() },
    });
    // 表格在挂载后异步渲染表体，等待真实行数据出现再断言。
    await vi.waitFor(
      /** 等待真实表体渲染出业务行。 */ () => {
        expect(wrapper.text()).toContain('研发部');
      },
    );

    expect(wrapper.find('.vxe-table').exists()).toBe(true);
    expect(wrapper.text()).toContain('部门');
    // 挂载期把真实表格实例与表单 API 交回给 API 实例。
    expect(api.grid).toBeTruthy();
    expect(api.formApi).toBeTruthy();
    expect(api.state?.gridOptions?.columns).toEqual([
      { field: 'name', title: '部门' },
    ]);

    wrapper.unmount();

    // 卸载必须把真实表格从文档中移除，并触发 API 的卸载清理。
    expect(document.querySelector('.vxe-table')).toBeNull();
  });
});
