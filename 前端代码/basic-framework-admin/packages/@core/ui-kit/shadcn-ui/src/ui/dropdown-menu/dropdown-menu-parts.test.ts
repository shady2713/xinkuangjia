/**
 * 下拉菜单基础件（shadcn-ui 的 ui/dropdown-menu）结构与交互回归。
 *
 * 下拉菜单由根节点、触发按钮、内容面板、分组、菜单项、标签、分隔线、快捷键提示、复选与单选
 * 菜单项、二级子菜单组成。面板只在根节点打开时渲染；点击菜单项必须抛出选择事件；复选与单选
 * 菜单项必须按选中状态渲染指示图标；触发按钮必须带无障碍菜单语义。用例真实挂载 reka-ui 的
 * 菜单根节点并读取传送后的真实 DOM。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import DropdownMenu from './DropdownMenu.vue';
import DropdownMenuCheckboxItem from './DropdownMenuCheckboxItem.vue';
import DropdownMenuContent from './DropdownMenuContent.vue';
import DropdownMenuGroup from './DropdownMenuGroup.vue';
import DropdownMenuItem from './DropdownMenuItem.vue';
import DropdownMenuLabel from './DropdownMenuLabel.vue';
import DropdownMenuRadioGroup from './DropdownMenuRadioGroup.vue';
import DropdownMenuRadioItem from './DropdownMenuRadioItem.vue';
import DropdownMenuSeparator from './DropdownMenuSeparator.vue';
import DropdownMenuShortcut from './DropdownMenuShortcut.vue';
import DropdownMenuSub from './DropdownMenuSub.vue';
import DropdownMenuSubContent from './DropdownMenuSubContent.vue';
import DropdownMenuSubTrigger from './DropdownMenuSubTrigger.vue';
import DropdownMenuTrigger from './DropdownMenuTrigger.vue';

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
 * 挂载覆盖全部基础件的下拉菜单宿主。
 * @param open 是否直接以打开状态挂载。
 * @param selected 记录被选中菜单项的数组。
 * @returns 已挂载的菜单宿主包装器。
 */
function mountMenu(open: boolean, selected: unknown[] = []) {
  return mount(
    h(
      DropdownMenu,
      { open },
      {
        /** 渲染触发按钮与全部菜单内容。 */
        default: () => [
          h(
            DropdownMenuTrigger,
            { class: 'dd-trigger' },
            {
              /** 触发按钮文案。 */
              default: () => '更多操作',
            },
          ),
          h(
            DropdownMenuContent,
            { class: 'dd-content' },
            {
              /** 渲染各类型菜单项。 */
              default: () => [
                h(
                  DropdownMenuLabel,
                  { class: 'dd-label', inset: true },
                  {
                    /** 分组标题文案。 */
                    default: () => '分组标题',
                  },
                ),
                h(DropdownMenuSeparator, { class: 'dd-sep' }),
                h(
                  DropdownMenuGroup,
                  {},
                  {
                    /** 渲染普通菜单项。 */
                    default: () =>
                      h(
                        DropdownMenuItem,
                        {
                          class: 'dd-item',
                          inset: true,
                          /** 选择回调签名。 */
                          onSelect: () => {
                            selected.push('dd-item');
                          },
                        },
                        {
                          /** 菜单项文案。 */
                          default: () => '编辑',
                        },
                      ),
                  },
                ),
                h(
                  DropdownMenuItem,
                  { class: 'dd-item-plain' },
                  {
                    /** 渲染带快捷键提示的菜单项。 */
                    default: () => [
                      '复制',
                      h(
                        DropdownMenuShortcut,
                        { class: 'dd-shortcut' },
                        {
                          /** 快捷键文案。 */
                          default: () => 'Ctrl+C',
                        },
                      ),
                    ],
                  },
                ),
                h(
                  DropdownMenuCheckboxItem,
                  { class: 'dd-check', modelValue: true },
                  {
                    /** 复选菜单项文案。 */
                    default: () => '显示网格',
                  },
                ),
                h(
                  DropdownMenuRadioGroup,
                  { modelValue: 'name' },
                  {
                    /** 渲染单选菜单项。 */
                    default: () =>
                      h(
                        DropdownMenuRadioItem,
                        { class: 'dd-radio', value: 'name' },
                        {
                          /** 单选菜单项文案。 */
                          default: () => '按名称',
                        },
                      ),
                  },
                ),
                h(
                  DropdownMenuSub,
                  {},
                  {
                    /** 渲染二级子菜单。 */
                    default: () => [
                      h(
                        DropdownMenuSubTrigger,
                        { class: 'dd-sub-trigger' },
                        {
                          /** 子菜单入口文案。 */
                          default: () => '更多',
                        },
                      ),
                      h(
                        DropdownMenuSubContent,
                        { class: 'dd-sub-content', forceMount: true },
                        {
                          /** 子菜单项文案。 */
                          default: () =>
                            h(
                              DropdownMenuItem,
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

describe('下拉菜单开合与内容结构', /** 面板与菜单项决定用户能否执行操作。 */ () => {
  it('未打开时不渲染面板', /** 默认渲染面板会在页面上留下悬浮菜单。 */ async () => {
    mounted = mountMenu(false);
    await nextTick();

    expect(document.querySelector('.dd-content')).toBeNull();
    expect(mounted.find('.dd-trigger').attributes('data-state')).toBe('closed');
  });

  it('打开时渲染面板与全部菜单项', /** 面板或菜单项缺失会让用户无法执行任何操作。 */ async () => {
    mounted = mountMenu(true);
    await nextTick();
    await nextTick();

    expect(mounted.find('.dd-trigger').attributes('data-state')).toBe('open');
    expect(mounted.find('.dd-trigger').attributes('aria-haspopup')).toBe(
      'menu',
    );
    expect(mounted.find('.dd-trigger').classes()).toContain('outline-none');
    expect(document.querySelector('.dd-content')?.className).toContain(
      'min-w-32',
    );
    expect(document.querySelector('.dd-label')?.className).toContain('pl-8');
    expect(document.querySelector('.dd-label')?.className).toContain(
      'font-semibold',
    );
    expect(document.querySelector('.dd-sep')?.className).toContain('bg-border');
    expect(document.querySelector('.dd-item')?.className).toContain('pl-8');
    expect(document.querySelector('.dd-item-plain')?.className).toContain(
      'px-2',
    );
    expect(document.querySelector('.dd-shortcut')?.className).toContain(
      'ml-auto',
    );
    expect(document.querySelector('.dd-shortcut')?.textContent).toBe('Ctrl+C');
  });

  it('复选与单选菜单项按选中状态渲染指示图标', /** 指示图标缺失会让用户看不到当前生效的选项。 */ async () => {
    mounted = mountMenu(true);
    await nextTick();
    await nextTick();

    expect(document.querySelector('.dd-check')?.className).toContain('pl-8');
    expect(document.querySelector('.dd-radio')?.className).toContain('pl-8');
    expect(document.querySelector('.dd-check svg')).not.toBeNull();
    expect(document.querySelector('.dd-radio svg')).not.toBeNull();
  });

  it('二级子菜单渲染入口箭头与子菜单内容', /** 缺少箭头会让用户不知道这里还能继续展开。 */ async () => {
    mounted = mountMenu(true);
    await nextTick();
    await nextTick();

    expect(document.querySelector('.dd-sub-trigger')?.className).toContain(
      'px-2',
    );
    expect(document.querySelector('.dd-sub-trigger svg')).not.toBeNull();
    expect(document.querySelector('.dd-sub-content')?.className).toContain(
      'min-w-32',
    );
    expect(document.body.textContent).toContain('子项');
  });

  it('点击菜单项抛出选中事件', /** 不抛出会让业务拿不到用户选择。 */ async () => {
    const selected: unknown[] = [];
    mounted = mountMenu(true, selected);
    await nextTick();
    await nextTick();

    const item = document.querySelector('.dd-item');
    if (!item) {
      throw new Error('下拉菜单未渲染普通菜单项');
    }
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    item.dispatchEvent(event);
    item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(selected).toEqual(['dd-item']);
  });
});
