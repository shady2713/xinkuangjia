/**
 * 下拉选择（shadcn-ui 的 ui/select）结构与交互回归。
 *
 * 下拉选择由根节点、触发按钮、当前值、内容面板、分组、选项、标签、分隔线与上下滚动按钮组成。
 * 面板只在根节点打开时渲染；选中项必须渲染勾选指示；触发按钮必须带无障碍下拉语义与下拉箭头；
 * 内容面板按 position 决定是否使用 popper 位移样式。用例真实挂载 reka-ui 的选择根节点，读取
 * 传送后的真实 DOM 与选中事件。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import Select from './Select.vue';
import SelectContent from './SelectContent.vue';
import SelectGroup from './SelectGroup.vue';
import SelectItem from './SelectItem.vue';
import SelectItemText from './SelectItemText.vue';
import SelectLabel from './SelectLabel.vue';
import SelectScrollDownButton from './SelectScrollDownButton.vue';
import SelectScrollUpButton from './SelectScrollUpButton.vue';
import SelectSeparator from './SelectSeparator.vue';
import SelectTrigger from './SelectTrigger.vue';
import SelectValue from './SelectValue.vue';

/** 每个用例挂载的选择宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载选择控件并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 挂载覆盖全部基础件的选择控件。
 * @param open 是否直接以打开状态挂载。
 * @param options 内容面板的可选配置，如 position 与自定义 class。
 * @param options.contentClass 内容面板的自定义样式类。
 * @param options.position 内容面板的定位方式。
 * @param onSelect 选中回调，用于断言选择事件载荷。
 * @returns 已挂载的选择宿主包装器。
 */
function mountSelect(
  open: boolean,
  options: { contentClass?: string; position?: 'item-aligned' | 'popper' } = {},
  onSelect?: /** 选择回调签名。 */ (value: unknown) => void,
) {
  return mount(
    h(
      Select,
      { modelValue: 'name', open, 'onUpdate:modelValue': onSelect },
      {
        /** 渲染触发按钮与内容面板。 */
        default: () => [
          h(
            SelectTrigger,
            { class: 'select-trigger' },
            {
              /** 渲染当前值与下拉箭头。 */
              default: () =>
                h(SelectValue, {
                  class: 'select-value',
                  placeholder: '请选择',
                }),
            },
          ),
          h(
            SelectContent,
            {
              class: options.contentClass ?? 'select-content',
              position: options.position,
            },
            {
              /** 渲染分组、标签、选项、分隔线与滚动按钮。 */
              default: () => [
                // forceMount 让滚动按钮在未发生滚动时也渲染，便于核对默认箭头。
                h(SelectScrollUpButton, {
                  class: 'select-up',
                  forceMount: true,
                }),
                h(
                  SelectGroup,
                  { class: 'select-group' },
                  {
                    /** 渲染分组内容。 */
                    default: () => [
                      h(
                        SelectLabel,
                        { class: 'select-label' },
                        {
                          /** 分组标签文案。 */
                          default: () => '排序字段',
                        },
                      ),
                      h(
                        SelectItem,
                        { class: 'select-item', value: 'name' },
                        {
                          /** 选项文案。 */
                          default: () => '按名称',
                        },
                      ),
                      h(
                        SelectItem,
                        { class: 'select-item-plain', value: 'created' },
                        {
                          /** 使用共享选项文本组件的选项。 */
                          default: () =>
                            h(
                              SelectItemText,
                              { class: 'select-item-text' },
                              {
                                /** 选项文案。 */
                                default: () => '按创建时间',
                              },
                            ),
                        },
                      ),
                    ],
                  },
                ),
                h(SelectSeparator, { class: 'select-sep' }),
                h(SelectScrollDownButton, {
                  class: 'select-down',
                  forceMount: true,
                }),
              ],
            },
          ),
        ],
      },
    ),
  );
}

describe('选择控件结构与语义', /** 触发语义与内容结构决定用户能否完成一次选择。 */ () => {
  it('触发按钮带下拉语义与默认箭头', /** 缺少无障碍语义会让辅助技术无法识别这是下拉选择。 */ async () => {
    mounted = mountSelect(false);
    await nextTick();

    const trigger = mounted.find('.select-trigger');
    expect(trigger.attributes('role')).toBe('combobox');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.classes()).toContain('h-10');
    expect(trigger.classes()).toContain('border-input');
    expect(mounted.find('.select-trigger svg').exists()).toBe(true);
  });

  it('未打开时不渲染内容面板', /** 默认渲染面板会在页面上留下悬浮层。 */ async () => {
    mounted = mountSelect(false);
    await nextTick();

    expect(document.querySelector('.select-content')).toBeNull();
  });

  it('打开时渲染分组、标签、选项与分隔线', /** 面板内容缺失会让用户无法选择任何项。 */ async () => {
    mounted = mountSelect(true);
    await nextTick();
    await nextTick();

    expect(document.querySelector('.select-content')?.className).toContain(
      'min-w-32',
    );
    expect(document.querySelector('.select-group')?.className).toContain('p-1');
    expect(document.querySelector('.select-label')?.className).toContain(
      'font-semibold',
    );
    expect(document.querySelector('.select-sep')?.className).toContain(
      'bg-muted',
    );
    expect(document.querySelector('.select-item')?.className).toContain('pl-2');
    expect(document.body.textContent).toContain('按名称');
    expect(document.body.textContent).toContain('按创建时间');
    expect(document.querySelector('.select-item-text')?.textContent).toBe(
      '按创建时间',
    );
  });

  it('选中项渲染勾选指示', /** 勾选指示缺失会让用户不知道当前选中了哪一项。 */ async () => {
    mounted = mountSelect(true);
    await nextTick();
    await nextTick();

    expect(document.querySelector('.select-item svg')).not.toBeNull();
  });

  it('滚动按钮在视口可见滚动时渲染上下箭头', /** 选项超出面板高度时缺少滚动提示会让用户以为没有更多选项。 */ async () => {
    // 对齐模式是唯一会让 reka-ui 上报 placed 的定位方式，滚动按钮只在 placed 后监听滚动。
    // happy-dom 没有排版与滚动模型，这里只替换这两处缺失的浏览器能力：元素尺寸与滚动位置。
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect =
      /** 返回固定的元素尺寸，替代缺失的排版计算结果。 */ () =>
        ({
          bottom: 100,
          height: 20,
          left: 0,
          right: 100,
          top: 80,
          width: 100,
          x: 0,
          y: 80,
        }) as DOMRect;
    try {
      mounted = mountSelect(true, { position: 'item-aligned' });
      await nextTick();
      await nextTick();
      await nextTick();

      const viewport = document.querySelector(
        '[data-reka-select-viewport]',
      ) as HTMLElement | null;
      if (!viewport) {
        throw new Error('选择面板未渲染选项视口');
      }
      let scrollTop = 0;
      Object.defineProperty(viewport, 'scrollTop', {
        configurable: true,
        /** 读取当前滚动位置。 */
        get: () => scrollTop,
        /** 记录测试设置的滚动位置。 */
        set: (value: number) => {
          scrollTop = value;
        },
      });
      // 下滚按钮按 scrollHeight - clientHeight 判断是否还有更多选项，同样需要尺寸兜底。
      Object.defineProperty(viewport, 'scrollHeight', {
        configurable: true,
        value: 500,
      });
      Object.defineProperty(viewport, 'clientHeight', {
        configurable: true,
        value: 100,
      });
      viewport.scrollTop = 20;
      viewport.dispatchEvent(new Event('scroll'));
      await nextTick();

      const up = document.querySelector('.select-up');
      const down = document.querySelector('.select-down');
      expect(up?.className).toContain('justify-center');
      expect(down?.className).toContain('justify-center');
      expect(up?.querySelector('svg')).not.toBeNull();
      expect(down?.querySelector('svg')).not.toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }
  });

  it('position 为 popper 时内容面板带位移样式', /** 缺少位移样式会让面板紧贴触发按钮，视觉上像连在一起。 */ async () => {
    mounted = mountSelect(true, { position: 'popper' });
    await nextTick();
    await nextTick();

    expect(document.querySelector('.select-content')?.className).toContain(
      'data-[side=bottom]:translate-y-1',
    );
  });

  it('position 为 item-aligned 时不使用位移样式', /** 对齐模式下套用位移会让面板错位。 */ async () => {
    mounted = mountSelect(true, { position: 'item-aligned' });
    await nextTick();
    await nextTick();

    expect(document.querySelector('.select-content')?.className).not.toContain(
      'data-[side=bottom]:translate-y-1',
    );
  });
});
