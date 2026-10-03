/** 弹窗挂载容器选择的测试：表单内弹窗挂到表单，vxe-table 弹窗挂到滚动区域，找不到时回退到 body。 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getPopupContainer,
  getVxePopupContainer,
} from '../get-popup-container';

/** 静默控制台告警，只保留可断言的调用记录。
 * @returns 拦截后的 Spy，可直接断言调用参数。
 */
function silenceWarn() {
  return vi
    .spyOn(console, 'warn')
    .mockImplementation(/** 不真正打印告警，只让 Spy 记录调用。 */ () => {});
}

afterEach(
  /** 清空页面结构并恢复真实控制台，避免用例之间互相影响。 */ () => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  },
);

/** 构造一个带 class 的表格滚动区域，用于验证挂载目标选择。
 * @param id 可选的外层容器 id，用于验证多表格场景的限定选择器。
 * @returns 新建的外层容器元素。
 */
function createVxeWrapper(id?: string): HTMLElement {
  const host = document.createElement('div');
  if (id) host.id = id;
  const wrapper = document.createElement('div');
  wrapper.className = 'vxe-table--body-wrapper body--wrapper';
  host.append(wrapper);
  document.body.append(host);
  return host;
}

describe('getPopupContainer', /** 表单内弹窗必须限制在表单内，否则会被表单的 overflow 裁掉。 */ () => {
  it('节点在表单内时返回最近的表单', /** 弹窗挂到 form 元素，提交校验才能一并生效。 */ () => {
    const form = document.createElement('form');
    const field = document.createElement('input');
    form.append(field);
    document.body.append(form);

    const container = getPopupContainer(field);

    expect(container.tagName).toBe('FORM');
    expect(container.contains(field)).toBe(true);
  });

  it('节点不在表单内时返回其父节点', /** 普通区域的弹窗挂在触发元素的父容器上。 */ () => {
    const parent = document.createElement('div');
    const trigger = document.createElement('button');
    parent.append(trigger);
    document.body.append(parent);

    const container = getPopupContainer(trigger);

    expect(container.tagName).toBe('DIV');
    expect(container.contains(trigger)).toBe(true);
  });

  it('未传节点时返回 body', /** 没有触发元素时兜底挂到 body。 */ () => {
    expect(getPopupContainer()).toBe(document.body);
  });
});

describe('getVxePopupContainer', /** vxe-table 弹窗要挂到可滚动的表体区域，否则会被固定表头遮挡。 */ () => {
  it('找到表体滚动区域时返回该节点', /** 单表格场景直接使用全局选择器。 */ () => {
    const host = createVxeWrapper();

    expect(getVxePopupContainer()).toBe(host.firstElementChild);
  });

  it('指定表格 id 时只在该表格内查找', /** 同页面多表格时避免弹窗挂到另一个表格上。 */ () => {
    createVxeWrapper('other-table');
    const host = createVxeWrapper('target-table');

    expect(getVxePopupContainer(undefined, 'target-table')).toBe(
      host.firstElementChild,
    );
  });

  it('指定 id 但该表格不存在时回退到 body 并告警', /** 表格尚未渲染完成时不能抛错阻断弹窗打开。 */ () => {
    const warn = silenceWarn();

    expect(getVxePopupContainer(undefined, 'missing-table')).toBe(
      document.body,
    );
    expect(warn).toHaveBeenCalledWith('无法找到vxe-table元素, 将会挂载到body.');
  });

  it('页面上没有表格时回退到 body', /** 非表格页面的弹窗仍需有合法挂载点。 */ () => {
    const warn = silenceWarn();

    expect(getVxePopupContainer()).toBe(document.body);
    expect(warn).toHaveBeenCalledOnce();
  });
});
