/**
 * 菜单项折叠标题与悬停提示（menu-ui 的 components/menu-item）真实渲染回归。
 *
 * 折叠侧边栏只能放下图标，菜单项必须在悬停时用提示气泡补齐标题，并在开启折叠标题时把标题
 * 显示在图标下方：提示分支判定写错会让折叠菜单失去标题，用户只能靠图标猜功能；折叠标题插槽
 * 漏渲染会让折叠态的名称整块消失。用例挂载真实 Menu 与 MenuItem，通过真实悬停事件打开提示
 * 并读取传送到 body 的真实节点。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import MenuItem from '../menu-item.vue';
import Menu from '../menu.vue';

/** 本文件已挂载的宿主包装器，用例结束后统一卸载以清理移动端提示节点。 */
const mountedWrappers: ReturnType<typeof mount>[] = [];

/**
 * 挂载一棵真实菜单树，其中只有一个带标题插槽的顶层菜单项。
 * @param menuProps 透传给菜单容器的属性，用于切换折叠与折叠标题开关。
 * @returns 已挂载的宿主包装器。
 */
function mountMenuWithTitledItem(menuProps: Record<string, unknown>) {
  const Host = defineComponent({
    name: 'MenuItemTooltipHost',
    /** 渲染真实菜单容器与菜单项，标题通过命名插槽提供。
     * @returns 渲染菜单树的渲染函数。
     */
    setup() {
      return /** 渲染真实菜单树。 */ () =>
        h(Menu, menuProps, {
          /** 菜单容器的默认插槽：单个带标题的菜单项。 */
          default: () =>
            h(
              MenuItem,
              { icon: 'lucide:settings', path: '/tooltip' },
              {
                /** 菜单项主体文案。 */
                default: () => 'DUMMY-菜单项',
                /** 菜单项标题插槽文案，折叠态下由提示气泡或折叠标题承载。 */
                title: () => 'DUMMY-折叠标题',
              },
            ),
        });
    },
  });

  const wrapper = mount(Host);
  mountedWrappers.push(wrapper);
  return wrapper;
}

afterEach(
  /** 卸载菜单并清理传送节点，避免残留的提示气泡影响后续用例。 */ () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  },
);

describe('菜单项折叠标题', /** 折叠标题决定折叠侧边栏能否显示菜单名称，判定错会让用户只能看到图标。 */ () => {
  it('折叠且开启折叠标题时在折叠态渲染标题文本', /** 折叠标题插槽漏渲染会让折叠菜单只剩图标。 */ () => {
    const wrapper = mountMenuWithTitledItem({
      collapse: true,
      collapseShowTitle: true,
    });

    const item = wrapper.get('.vben-menu-item');
    expect(item.classes()).toContain('is-collapse-show-title');
    expect(item.get('.vben-menu__name').text()).toBe('DUMMY-折叠标题');
    expect(item.text()).toContain('DUMMY-菜单项');
  });

  it('未开启折叠标题时不渲染折叠标题行', /** 负对照：未声明开关却渲染标题会把图标挤出窄侧边栏。 */ () => {
    const wrapper = mountMenuWithTitledItem({ collapse: true });

    expect(wrapper.get('.vben-menu-item').classes()).not.toContain(
      'is-collapse-show-title',
    );
    expect(wrapper.find('.vben-menu__name').exists()).toBe(false);
  });
});

describe('菜单项悬停提示', /** 折叠菜单靠提示气泡补齐标题，提示不出现会让折叠菜单无法辨认。 */ () => {
  it('折叠态悬停时弹出标题提示', /** 提示内容缺失会让用户悬停后仍看不到菜单名称。 */ async () => {
    const wrapper = mountMenuWithTitledItem({
      collapse: true,
      collapseShowTitle: false,
    });

    const trigger = wrapper.get('.vben-menu-tooltip__trigger');
    await trigger.trigger('pointermove');

    await vi.waitFor(
      /** 等待提示面板真实渲染出标题文案。 */ () => {
        expect(document.body.textContent).toContain('DUMMY-折叠标题');
      },
      { timeout: 2000 },
    );
  });

  it('展开态不渲染悬停提示触发器', /** 负对照：展开态已有可见标题，再弹提示会遮挡菜单。 */ () => {
    const wrapper = mountMenuWithTitledItem({ collapse: false });

    expect(wrapper.find('.vben-menu-tooltip__trigger').exists()).toBe(false);
    // 展开态直接渲染标题内容，用户无需悬停即可看到名称。
    expect(wrapper.get('.vben-menu-item').text()).toContain('DUMMY-折叠标题');
  });
});

describe('菜单项禁用状态', /** 禁用菜单项必须带上禁用类名，否则用户会以为可以进入该页面。 */ () => {
  it('禁用时标记禁用类名', /** 禁用类名缺失会让只读菜单看起来仍可点击。 */ () => {
    const Host = defineComponent({
      name: 'DisabledMenuItemHost',
      /** 渲染一个被禁用的真实菜单项。
       * @returns 渲染菜单树的渲染函数。
       */
      setup() {
        return /** 渲染禁用菜单项。 */ () =>
          h(
            Menu,
            {},
            {
              /** 菜单容器默认插槽。 */
              default: () =>
                h(
                  MenuItem,
                  { disabled: true, path: '/disabled' },
                  {
                    /** 禁用菜单项文案。 */
                    default: () => 'DUMMY-禁用项',
                  },
                ),
            },
          );
      },
    });
    const wrapper = mount(Host);
    mountedWrappers.push(wrapper);

    expect(wrapper.get('.vben-menu-item').classes()).toContain('is-disabled');
  });
});
