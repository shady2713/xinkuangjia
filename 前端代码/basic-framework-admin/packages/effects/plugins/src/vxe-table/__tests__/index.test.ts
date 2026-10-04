/**
 * vxe-table 插件入口（plugins 的 vxe-table/index.ts）的异步组件与导出契约回归。
 *
 * 该入口为"单独使用 vxe-table"的场景提供三个异步组件，并用 Suspense 懒加载真实表格库。
 * 加载器写错、组件写混或重复导出都会让页面白屏或渲染出错误控件。用例在真实 Suspense 中
 * 挂载这些异步组件，断言最终渲染出的真实 vxe-table DOM 与列定义结果。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, Suspense } from 'vue';

import { describe, expect, it } from 'vitest';

import {
  AsyncVxeColumn,
  AsyncVxeTable,
  AsyncVxeToolbar,
  setupVbenVxeTable,
  useTableToolbar,
} from '../index';

/** 需要渲染的异步组件子树；返回 Suspense 默认插槽的 vnode。 */
type SuspenseContent = () => unknown;

/**
 * 在真实 Suspense 中挂载异步组件并等待懒加载完成。
 * @param content 需要渲染的异步组件子树。
 * @returns 已完成加载的组件包装器。
 */
async function mountInSuspense(content: SuspenseContent) {
  const Host = defineComponent({
    name: 'VxeSuspenseHost',
    /** 用 Suspense 承载异步组件，与业务侧单独使用 vxe-table 的方式一致。
     * @returns 渲染 Suspense 的渲染函数。
     */
    setup() {
      /** 渲染 Suspense 与传入的异步组件子树。 */
      const renderSuspense = () => h(Suspense, null, { default: content });
      return renderSuspense;
    },
  });
  const wrapper = mount(Host);
  // 异步加载在微任务后完成，这里等待真实 DOM 出现后再断言。
  await new Promise(
    /** 释放一次宏任务，让懒加载与渲染副作用完成。 */ (resolve) => {
      setTimeout(resolve, 80);
    },
  );
  return wrapper;
}

describe('vxe-table 异步组件', /** 三个异步组件是自建表格场景的唯一入口。 */ () => {
  it('表格与列渲染出真实表头与数据单元格', /** 加载器指向错误组件时页面会白屏或不显示任何列。 */ async () => {
    const wrapper = await mountInSuspense(
      /** 渲染表格与列组成的异步组件子树。 */ () =>
        h(
          AsyncVxeTable,
          { data: [{ name: '研发部' }] },
          {
            /** 渲染表格列定义，证明列异步组件真实生效。 */
            default: () => [
              h(AsyncVxeColumn, { field: 'name', title: '部门' }),
            ],
          },
        ),
    );

    expect(wrapper.find('.vxe-table').exists()).toBe(true);
    expect(
      wrapper
        .findAll('.vxe-header--column')
        .map(/** 读取真实表头文案以证明列定义生效。 */ (cell) => cell.text()),
    ).toEqual(['部门']);
    expect(wrapper.text()).toContain('研发部');
  });

  it('工具栏渲染出真实工具栏并透出自定义按钮插槽', /** 工具栏加载器写错会让表格操作区整体消失。 */ async () => {
    const wrapper = await mountInSuspense(
      /** 渲染带自定义按钮插槽的工具栏异步组件。 */ () =>
        h(AsyncVxeToolbar, null, {
          /** 渲染工具栏自定义按钮，证明插槽内容被透传。 */
          buttons: () => h('button', { class: 'custom-button' }, '新增'),
        }),
    );

    expect(wrapper.find('.vxe-toolbar').exists()).toBe(true);
    expect(wrapper.find('.custom-button').text()).toBe('新增');
  });

  it('三个异步组件是彼此独立的定义', /** 共用同一异步定义会让其中一类组件被渲染成错误的控件。 */ () => {
    const components = [AsyncVxeColumn, AsyncVxeTable, AsyncVxeToolbar];

    expect(new Set(components).size).toBe(3);
    expect(components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'AsyncComponentWrapper' }),
      ]),
    );
  });
});

describe('vxe-table 入口导出契约', /** 业务方按名称导入这些成员，缺失会在接入时直接报错。 */ () => {
  it('保留同步安装与工具栏组合函数', /** 这两项是 vxe-table 初始化的必需入口。 */ () => {
    expect(setupVbenVxeTable).toBeTypeOf('function');
    expect(useTableToolbar).toBeTypeOf('function');
  });
});
