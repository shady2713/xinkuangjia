/**
 * 右键菜单基础件（shadcn-ui 的 ui/context-menu）结构与交互回归。
 *
 * 右键菜单由根节点、触发区域、内容面板、分组、菜单项、标签、分隔线、快捷键提示、复选与单选
 * 菜单项、二级子菜单组成。触发区域必须在真实 contextmenu 事件后打开面板；复选与单选菜单项
 * 必须按选中状态渲染指示图标；快捷键提示必须与菜单项同排右对齐。用例真实挂载 reka-ui 的菜单
 * 根节点并用真实右键事件打开面板，只替换被测组件之外无可替换项。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import ContextMenu from './ContextMenu.vue';
import ContextMenuCheckboxItem from './ContextMenuCheckboxItem.vue';
import ContextMenuContent from './ContextMenuContent.vue';
import ContextMenuGroup from './ContextMenuGroup.vue';
import ContextMenuItem from './ContextMenuItem.vue';
import ContextMenuLabel from './ContextMenuLabel.vue';
import ContextMenuRadioGroup from './ContextMenuRadioGroup.vue';
import ContextMenuRadioItem from './ContextMenuRadioItem.vue';
import ContextMenuSeparator from './ContextMenuSeparator.vue';
import ContextMenuShortcut from './ContextMenuShortcut.vue';
import ContextMenuSub from './ContextMenuSub.vue';
import ContextMenuSubContent from './ContextMenuSubContent.vue';
import ContextMenuSubTrigger from './ContextMenuSubTrigger.vue';
import ContextMenuTrigger from './ContextMenuTrigger.vue';

/** 每个用例挂载的菜单宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载菜单并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 挂载覆盖全部基础件的右键菜单宿主。
 * @returns 已挂载的菜单宿主包装器。
 */
function mountMenu() {
  return mount(
    h(
      ContextMenu,
      {},
      {
        /** 渲染触发区域与全部菜单内容。 */
        default: () => [
          h(
            ContextMenuTrigger,
            { class: 'ctx-trigger' },
            {
              /** 触发区域文案。 */
              default: () => '右键区域',
            },
          ),
          h(
            ContextMenuContent,
            { class: 'ctx-content' },
            {
              /** 渲染各类型菜单项。 */
              default: () => [
                h(
                  ContextMenuLabel,
                  { class: 'ctx-label', inset: true },
                  {
                    /** 分组标题文案。 */
                    default: () => '分组标题',
                  },
                ),
                h(ContextMenuSeparator, { class: 'ctx-sep' }),
                h(
                  ContextMenuGroup,
                  {},
                  {
                    /** 渲染普通菜单项。 */
                    default: () =>
                      h(
                        ContextMenuItem,
                        { class: 'ctx-item', inset: true },
                        {
                          /** 菜单项文案。 */
                          default: () => '编辑',
                        },
                      ),
                  },
                ),
                h(
                  ContextMenuItem,
                  { class: 'ctx-item-plain' },
                  {
                    /** 渲染带快捷键提示的菜单项。 */
                    default: () => [
                      '复制',
                      h(
                        ContextMenuShortcut,
                        { class: 'ctx-shortcut' },
                        {
                          /** 快捷键文案。 */
                          default: () => 'Ctrl+C',
                        },
                      ),
                    ],
                  },
                ),
                h(
                  ContextMenuCheckboxItem,
                  { class: 'ctx-check', modelValue: true },
                  {
                    /** 复选菜单项文案。 */
                    default: () => '显示网格',
                  },
                ),
                h(
                  ContextMenuRadioGroup,
                  { modelValue: 'name' },
                  {
                    /** 渲染单选菜单项。 */
                    default: () =>
                      h(
                        ContextMenuRadioItem,
                        { class: 'ctx-radio', value: 'name' },
                        {
                          /** 单选菜单项文案。 */
                          default: () => '按名称',
                        },
                      ),
                  },
                ),
                h(
                  ContextMenuSub,
                  {},
                  {
                    /** 渲染二级子菜单。 */
                    default: () => [
                      h(
                        ContextMenuSubTrigger,
                        { class: 'ctx-sub-trigger', inset: true },
                        {
                          /** 子菜单入口文案。 */
                          default: () => '更多',
                        },
                      ),
                      h(
                        ContextMenuSubContent,
                        { class: 'ctx-sub-content', forceMount: true },
                        {
                          /** 子菜单项文案。 */
                          default: () =>
                            h(
                              ContextMenuItem,
                              {},
                              {
                                /** 子菜单项文案。 */
                                default: () => '子项',
                              },
                            ),
                        },
                      ),
                    ],
                  },
                ),
              ],
            },
          ),
        ],
      },
    ),
  );
}

/**
 * 打开右键菜单并等待面板渲染完成。
 * @param wrapper 已挂载的菜单宿主包装器。
 * @returns 打开后的 Promise。
 */
async function openMenu(wrapper: ReturnType<typeof mount>) {
  await wrapper
    .find('.ctx-trigger')
    .trigger('contextmenu', { button: 2, clientX: 10, clientY: 20 });
  await nextTick();
  await nextTick();
  await nextTick();
}

describe('右键菜单开合与内容结构', /** 面板必须在真实右键后出现，否则菜单入口完全不可用。 */ () => {
  it('未触发右键时不渲染面板', /** 默认渲染面板会在页面上留下悬浮菜单。 */ () => {
    mounted = mountMenu();

    expect(document.querySelector('.ctx-content')).toBeNull();
    expect(mounted.find('.ctx-trigger').attributes('data-state')).toBe(
      'closed',
    );
  });

  it('触发右键后渲染面板与全部菜单项', /** 面板或菜单项缺失会让用户无法执行任何操作。 */ async () => {
    mounted = mountMenu();

    await openMenu(mounted);

    expect(mounted.find('.ctx-trigger').attributes('data-state')).toBe('open');
    expect(document.querySelector('.ctx-content')?.className).toContain(
      'min-w-32',
    );
    expect(document.querySelector('.ctx-label')?.className).toContain('pl-8');
    expect(document.querySelector('.ctx-sep')?.className).toContain(
      'bg-border',
    );
    expect(document.querySelector('.ctx-item')?.className).toContain('pl-8');
    expect(document.querySelector('.ctx-item-plain')?.className).toContain(
      'px-2',
    );
    expect(document.querySelector('.ctx-shortcut')?.className).toContain(
      'ml-auto',
    );
    expect(document.querySelector('.ctx-shortcut')?.textContent).toBe('Ctrl+C');
  });

  it('复选与单选菜单项按选中状态渲染指示图标', /** 指示图标缺失会让用户看不到当前生效的选项。 */ async () => {
    mounted = mountMenu();

    await openMenu(mounted);

    expect(document.querySelector('.ctx-check')?.className).toContain('pl-8');
    expect(document.querySelector('.ctx-radio')?.className).toContain('pl-8');
    expect(document.querySelector('.ctx-check svg')).not.toBeNull();
    expect(document.querySelector('.ctx-radio svg')).not.toBeNull();
  });

  it('二级子菜单渲染入口箭头与子菜单内容', /** 缺少箭头会让用户不知道这里还能继续展开。 */ async () => {
    mounted = mountMenu();

    await openMenu(mounted);

    expect(document.querySelector('.ctx-sub-trigger')?.className).toContain(
      'pl-8',
    );
    expect(document.querySelector('.ctx-sub-trigger svg')).not.toBeNull();
    expect(document.querySelector('.ctx-sub-content')?.className).toContain(
      'min-w-32',
    );
    expect(document.body.textContent).toContain('子项');
  });
});
