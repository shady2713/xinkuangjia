/** 验证真实下拉组件的点击行为和权限过滤，防止提示组件再次阻断菜单入口。 */
import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { afterEach, describe, expect, it, vi } from 'vitest';

import TableAction from './table-action.vue';

const permissions = vi.hoisted(() => ({ codes: [] as string[] }));

vi.mock('@vben/access', () => ({
  /** 提供当前用例的权限判断，真实下拉组件及其事件保持完整。 */
  useAccess: () => ({
    /** 只有已授予的权限码才允许显示对应操作。 */
    hasAccessByCodes: (codes: string[]) =>
      codes.some((code) => permissions.codes.includes(code)),
  }),
}));
vi.mock('@vben/icons', () => ({ IconifyIcon: 'span' }));
vi.mock('@vben/locales', () => ({
  /** 固定入口文案，避免测试依赖全局语言初始化。 */
  $t: (key: string) => (key === 'page.action.more' ? '更多' : key),
}));
vi.mock('@vben/utils', () => ({
  /** 保留组件对动作回调的函数判断。 */
  isFunction: (value: unknown) => typeof value === 'function',
}));

let wrapper: undefined | VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  permissions.codes = [];
});

/**
 * 点击真实下拉入口并等待菜单显示；通过可见弹层判断事件是否正确传递。
 * @returns 已展开菜单的操作节点
 * @throws 测试组件尚未挂载时拒绝触发菜单
 */
async function openMenu() {
  if (!wrapper) {
    throw new Error('测试组件尚未挂载');
  }
  const button = wrapper.get('button[aria-label="更多"]');
  await button.trigger('click');
  await flushPromises();
  await vi.waitFor(() => {
    const popper = document.querySelector('.el-dropdown__popper');
    expect(popper).toBeInstanceOf(HTMLElement);
    expect(getComputedStyle(popper as HTMLElement).display).not.toBe('none');
  });
  return [...document.querySelectorAll('.el-dropdown-menu__item')];
}

describe('表格更多菜单', /** 注册点击和权限边界的回归场景。 */ () => {
  it.each([
    ['数据权限', 0],
    ['菜单权限', 1],
  ] as const)(
    '点击展开后可以选择%s，动作仅执行一次',
    /**
     * 验证权限菜单可见并将选择事件分派到唯一动作。
     * @param label 本次要选择的权限菜单文案
     * @param index 本次菜单在已授权动作中的位置
     * @throws 预期菜单项不存在时报告回归失败
     */ async (label, index) => {
      permissions.codes = ['assign-data', 'assign-menu'];
      const onData = vi.fn();
      const onMenu = vi.fn();
      wrapper = mount(TableAction, {
        attachTo: document.body,
        props: {
          dropDownActions: [
            { auth: ['assign-data'], label: '数据权限', onClick: onData },
            { auth: ['assign-menu'], label: '菜单权限', onClick: onMenu },
          ],
        },
      });

      const items = await openMenu();
      expect(
        items.map(
          /** 提取实际菜单项文案核对权限过滤。 */ (item) =>
            item.textContent?.trim(),
        ),
      ).toEqual(['数据权限', '菜单权限']);
      const item = items[index];
      expect(item?.textContent).toContain(label);
      if (!item) {
        throw new Error('预期的权限菜单项不存在');
      }
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
      expect(onData).toHaveBeenCalledTimes(index === 0 ? 1 : 0);
      expect(onMenu).toHaveBeenCalledTimes(index === 1 ? 1 : 0);
    },
  );

  it('只有部分权限时只显示已授权动作', async () => {
    permissions.codes = ['assign-menu'];
    wrapper = mount(TableAction, {
      attachTo: document.body,
      props: {
        dropDownActions: [
          { auth: ['assign-data'], label: '数据权限' },
          { auth: ['assign-menu'], label: '菜单权限' },
        ],
      },
    });

    const items = await openMenu();
    expect(
      items.map(
        /** 提取实际菜单项文案核对权限过滤。 */ (item) =>
          item.textContent?.trim(),
      ),
    ).toEqual(['菜单权限']);
  });

  it('没有操作权限时隐藏更多入口', () => {
    wrapper = mount(TableAction, {
      attachTo: document.body,
      props: {
        dropDownActions: [{ auth: ['assign-menu'], label: '菜单权限' }],
      },
    });

    expect(wrapper.find('button[aria-label="更多"]').exists()).toBe(false);
  });
});
