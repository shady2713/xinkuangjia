/** 验证真实下拉组件的点击行为和权限过滤，防止提示组件再次阻断菜单入口。 */
import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { ElTooltip } from 'element-plus';
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

/**
 * 读取消息框中的操作按钮，等待确认弹层真实出现。
 * @returns 消息框内的按钮列表，顺序与 Element Plus 渲染一致（先取消后确定）。
 * @throws 确认弹层未出现时报告回归失败
 */
async function waitMessageBoxButtons() {
  return await vi.waitFor(
    /** 轮询真实弹层直到按钮出现，避免依赖固定等待。 */ () => {
      const box = document.querySelector('.el-message-box');
      expect(box).toBeInstanceOf(HTMLElement);
      const buttons = [
        ...(box as HTMLElement).querySelectorAll<HTMLButtonElement>(
          '.el-message-box__btns button',
        ),
      ];
      expect(buttons).toHaveLength(2);
      return buttons;
    },
  );
}

/**
 * 点击按钮并等待其触发的确认弹层出现。
 * @param button 目标按钮元素，点击后应弹出二次确认。
 * @returns 消息框内的按钮列表。
 * @throws 按钮不存在或确认弹层未出现时报告回归失败
 */
async function clickAndWaitMessageBox(button: Element | undefined) {
  if (!button) {
    throw new Error('目标按钮不存在');
  }
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();
  return await waitMessageBoxButtons();
}

describe('表格主操作区按钮', /** 主操作区的显隐与点击契约写错会让无权限按钮可见或动作执行两次。 */ () => {
  it('按权限码过滤主操作区按钮', /** 未授权的操作不能出现在行内，避免用户点击后被后端拒绝。 */ () => {
    permissions.codes = ['view'];
    wrapper = mount(TableAction, {
      props: {
        actions: [
          { auth: ['view'], label: '查看' },
          { auth: ['edit'], label: '编辑' },
          { label: '无权限要求' },
        ],
      },
    });

    const labels = wrapper
      .findAll('button')
      .map(
        /** 取出按钮实际展示的文案核对过滤结果。 */ (button) =>
          button.text().trim(),
      );
    expect(labels).toEqual(['查看', '无权限要求']);
  });

  it('ifShow 为布尔值时按取值显隐', /** 布尔显隐条件由业务直接给出，取反会让按钮凭空出现或消失。 */ () => {
    wrapper = mount(TableAction, {
      props: {
        actions: [
          { ifShow: true, label: '始终显示' },
          { ifShow: false, label: '始终隐藏' },
        ],
      },
    });

    const labels = wrapper
      .findAll('button')
      .map(
        /** 取出按钮实际展示的文案核对显隐结果。 */ (button) =>
          button.text().trim(),
      );
    expect(labels).toEqual(['始终显示']);
  });

  it('ifShow 为函数时按返回值显隐并收到动作配置', /** 函数式条件按行数据判定，调用参数写错会让条件永远读到空配置。 */ () => {
    const received: unknown[] = [];
    wrapper = mount(TableAction, {
      props: {
        actions: [
          {
            label: '按状态显示',
            /** 记录收到的动作配置并按其中标记决定显隐。 */
            ifShow: (action) => {
              received.push(action);
              return action.disabled === true;
            },
            disabled: true,
          },
          {
            label: '函数判定隐藏',
            /** 固定返回 false，形成显隐负对照。 */
            ifShow: () => false,
          },
        ],
      },
    });

    const labels = wrapper
      .findAll('button')
      .map(
        /** 取出按钮实际展示的文案核对显隐结果。 */ (button) =>
          button.text().trim(),
      );
    expect(labels).toEqual(['按状态显示']);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ label: '按状态显示' });
  });

  it('点击主操作区按钮只执行一次动作回调', /** onClick 若同时经 v-bind 与 @click 绑定，一次点击会提交两次业务操作。 */ async () => {
    const onClick = vi.fn();
    wrapper = mount(TableAction, {
      props: { actions: [{ label: '编辑', onClick }] },
    });

    await wrapper.get('button').trigger('click');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each(['auth', 'icon', 'ifshow', 'onclick', 'popconfirm', 'tooltip'])(
    '主操作区按钮不携带动作配置属性 %s',
    /** 权限码、确认配置与图标不应落到按钮元素上，否则会被误当作原生属性。 */ (
      attribute,
    ) => {
      permissions.codes = ['edit'];
      wrapper = mount(TableAction, {
        props: {
          actions: [
            {
              auth: ['edit'],
              icon: 'lucide:edit',
              ifShow: true,
              label: '编辑',
              popConfirm: {
                /** 确认回调在本用例中不会被触发。 */ confirm: () => {},
                title: '确认编辑？',
              },
              tooltip: '编辑当前行',
            },
          ],
        },
      });

      expect(wrapper.get('button').attributes()).not.toHaveProperty(attribute);
    },
  );

  it('未配置类型的主操作按钮使用主色样式', /** 缺省类型必须是 primary，否则行内操作会退化成默认灰色按钮。 */ () => {
    wrapper = mount(TableAction, {
      props: { actions: [{ label: '查看' }] },
    });

    expect(wrapper.get('button').classes()).toContain('el-button--primary');
  });

  it('显式类型覆盖缺省主色样式', /** 危险操作必须能声明为 danger，缺省值不能写死。 */ () => {
    wrapper = mount(TableAction, {
      props: { actions: [{ label: '删除', type: 'danger' }] },
    });

    expect(wrapper.get('button').classes()).toContain('el-button--danger');
  });

  it('没有动作时不渲染任何按钮', /** 空配置不能渲染出空按钮或占位元素。 */ () => {
    wrapper = mount(TableAction, { props: { actions: [] } });

    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('配置提示时按钮包在提示组件中且保留点击', /** 提示分支不能丢掉点击绑定，否则带提示的按钮点了没有反应。 */ async () => {
    const onClick = vi.fn();
    wrapper = mount(TableAction, {
      props: {
        actions: [
          {
            icon: 'lucide:edit',
            label: '编辑',
            onClick,
            tooltip: '编辑当前行',
          },
        ],
      },
    });

    expect(wrapper.findComponent(ElTooltip).props('content')).toBe(
      '编辑当前行',
    );
    await wrapper.get('button').trigger('click');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('对象形式的提示原样透传给提示组件', /** 对象形式用于传递位置等提示属性，丢掉会退回默认位置。 */ () => {
    wrapper = mount(TableAction, {
      props: {
        actions: [
          { label: '查看', tooltip: { content: '查看详情', placement: 'top' } },
        ],
      },
    });

    const tooltip = wrapper.findComponent(ElTooltip);
    expect(tooltip.props('content')).toBe('查看详情');
    expect(tooltip.props('placement')).toBe('top');
  });
});

describe('表格操作二次确认', /** 删除一类不可逆操作必须经用户确认，确认与取消回调不能互相串扰。 */ () => {
  it('确认后执行动作回调', /** 用户确认必须真正执行操作，否则删除等动作会静默失效。 */ async () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    wrapper = mount(TableAction, {
      attachTo: document.body,
      props: {
        actions: [
          {
            label: '删除',
            popConfirm: { cancel, confirm, title: '确认删除该行？' },
          },
        ],
      },
    });

    const buttons = await clickAndWaitMessageBox(
      wrapper.find('button').element,
    );
    buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('取消后只通知取消回调', /** 取消不能执行动作，否则用户以为已放弃但数据已被删除。 */ async () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    wrapper = mount(TableAction, {
      attachTo: document.body,
      props: {
        actions: [
          {
            label: '删除',
            popConfirm: { cancel, confirm, title: '确认删除该行？' },
          },
        ],
      },
    });

    const buttons = await clickAndWaitMessageBox(
      wrapper.find('button').element,
    );
    buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('确认框使用配置的标题与按钮文案', /** 文案配置写错会让用户看到与操作不符的提示。 */ async () => {
    wrapper = mount(TableAction, {
      attachTo: document.body,
      props: {
        actions: [
          {
            label: '删除',
            popConfirm: {
              /** 确认回调在本用例中不会被触发。 */ confirm: () => {},
              okText: '立即删除',
              cancelText: '再想想',
              title: '确认删除该行？',
            },
          },
        ],
      },
    });

    await clickAndWaitMessageBox(wrapper.find('button').element);

    expect(
      document.querySelector('.el-message-box__message')?.textContent,
    ).toBe('确认删除该行？');
    expect(
      [...document.querySelectorAll('.el-message-box__btns button')].map(
        /** 取出按钮文案核对自定义文案是否生效。 */ (button) =>
          button.textContent?.trim(),
      ),
    ).toEqual(['再想想', '立即删除']);
  });

  it('动作被禁用时确认框与回调都不触发', /** 禁用行不能因为点击弹出确认框，更不能执行操作。 */ async () => {
    const confirm = vi.fn();
    wrapper = mount(TableAction, {
      attachTo: document.body,
      props: {
        actions: [
          {
            disabled: true,
            label: '删除',
            popConfirm: { confirm, title: '确认删除该行？' },
          },
        ],
      },
    });

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(document.querySelector('.el-message-box')).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('确认配置自身禁用时不弹确认框', /** 只禁用确认流程而保留按钮可点击时，不能弹出无法完成的确认框。 */ async () => {
    const confirm = vi.fn();
    wrapper = mount(TableAction, {
      attachTo: document.body,
      props: {
        actions: [
          {
            label: '删除',
            popConfirm: { confirm, disabled: true, title: '确认删除该行？' },
          },
        ],
      },
    });

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(document.querySelector('.el-message-box')).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('下拉菜单中的确认动作走同一确认流程', /** 更多菜单里的删除同样需要二次确认，漏判会直接执行不可逆操作。 */ async () => {
    permissions.codes = ['delete'];
    const confirm = vi.fn();
    const onClick = vi.fn();
    wrapper = mount(TableAction, {
      attachTo: document.body,
      props: {
        dropDownActions: [
          {
            auth: ['delete'],
            label: '删除',
            onClick,
            popConfirm: { confirm, title: '确认删除该行？' },
          },
        ],
      },
    });

    const items = await openMenu();
    const buttons = await clickAndWaitMessageBox(items[0]);
    buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('下拉菜单中的普通动作只执行点击回调', /** 未配置确认的动作必须直接执行，不能被确认流程拦截。 */ async () => {
    permissions.codes = ['export'];
    const onClick = vi.fn();
    wrapper = mount(TableAction, {
      attachTo: document.body,
      props: {
        dropDownActions: [{ auth: ['export'], label: '导出', onClick }],
      },
    });

    const items = await openMenu();
    items[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.el-message-box')).toBeNull();
  });
});
