/**
 * vxe-table 全局初始化（plugins 的 vxe-table/init）的注册与幂等契约回归。
 *
 * `initVxeTable` 把 Vxe 组件注册进 VxeUI，只应生效一次：重复注册会重复覆盖全局组件并
 * 放大启动开销，因此第二次调用必须直接返回；`setupVbenVxeTable` 另外负责把表单工厂
 * 交给表格组件、联动主题与语言、注入默认格式化器并把全局配置入口交给调用方。
 * 用例用真实 VxeUI 驱动，只统计组件注册次数与回调收到的参数，不替换任何实现。
 */
import { useVbenForm } from '@vben-core/form-ui';

import { describe, expect, it, vi } from 'vitest';
import { VxeUI } from 'vxe-pc-ui';

import { initVxeTable, setupVbenVxeTable } from '../init';
import * as initModule from '../init';

describe('initVxeTable', /** 组件注册必须且只能执行一次。 */ () => {
  it('重复初始化时直接返回且不再注册组件', /** 重复注册会重复覆盖全局组件，第二次调用必须什么都不做。 */ () => {
    const component = vi.spyOn(VxeUI, 'component');

    initVxeTable();
    const firstRound = component.mock.calls.length;
    expect(firstRound).toBeGreaterThan(0);

    initVxeTable();

    expect(component.mock.calls.length).toBe(firstRound);

    component.mockRestore();
  });
});

describe('setupVbenVxeTable', /** 表单工厂导出与全局配置入口是表格组件的启动前提。 */ () => {
  it('导出表单工厂并把真实 VxeUI 交给调用方注入全局配置', /** 收不到 VxeUI 实例就无法收敛应用级表格配置，工厂未导出则表格渲染失败。 */ () => {
    const configVxeTable = vi.fn();

    setupVbenVxeTable({
      configVxeTable,
      useVbenForm,
    });

    expect(initModule.useTableForm).toBe(useVbenForm);
    expect(configVxeTable).toHaveBeenCalledTimes(1);
    expect(configVxeTable).toHaveBeenCalledWith(VxeUI);
  });
});
