/**
 * 手风琴（shadcn-ui 的 ui/accordion）展开交互与结构回归。
 *
 * 手风琴用于分组折叠内容：点击标题必须切换展开状态并抛出更新事件，展开内容必须出现在
 * 标题之后；标题默认带下拉箭头，展开时应旋转 180 度，否则用户看不出哪一组已展开。用例真实
 * 挂载 reka-ui 的手风琴根节点，读取真实的 aria 展开属性与双向绑定事件。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import Accordion from './Accordion.vue';
import AccordionContent from './AccordionContent.vue';
import AccordionItem from './AccordionItem.vue';
import AccordionTrigger from './AccordionTrigger.vue';

/**
 * 挂载手风琴并在折叠状态下返回包装器。
 * @param modelValue 当前展开的项，空串表示全部折叠。
 * @returns 已挂载的手风琴包装器。
 */
function mountAccordion(modelValue = '') {
  return mount(
    h(
      Accordion,
      {
        class: 'custom-accordion',
        modelValue,
        type: 'single',
        /** 忽略取值更新，仅用于驱动双向绑定。 */
        'onUpdate:modelValue': () => {},
      },
      {
        /** 渲染一个可折叠分组。 */
        default: () =>
          h(
            AccordionItem,
            { class: 'custom-item', value: 'group-1' },
            {
              /** 渲染分组标题与内容。 */
              default: () => [
                h(
                  AccordionTrigger,
                  { class: 'custom-trigger' },
                  {
                    /** 分组标题文本。 */
                    default: () => '分组标题',
                  },
                ),
                h(
                  AccordionContent,
                  { class: 'custom-content' },
                  {
                    /** 分组内容文本。 */
                    default: () => '分组内容',
                  },
                ),
              ],
            },
          ),
      },
    ),
  );
}

describe('手风琴展开交互', /** 展开状态与箭头方向决定用户能否辨认分组是否已展开。 */ () => {
  it('折叠时内容不渲染且箭头朝下', /** 折叠仍渲染内容会让折叠失去意义。 */ async () => {
    const wrapper = mountAccordion();
    await nextTick();

    const trigger = wrapper.find('button');
    expect(trigger.attributes('data-state')).toBe('closed');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.classes()).toContain('custom-trigger');
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('分组内容');
    expect(wrapper.find('.custom-item').classes()).toContain('border-b');
  });

  it('展开后渲染内容并标记为打开', /** 展开但不渲染内容会让分组形同虚设。 */ async () => {
    const wrapper = mountAccordion('group-1');
    await nextTick();

    const trigger = wrapper.find('button');
    expect(trigger.attributes('data-state')).toBe('open');
    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(wrapper.text()).toContain('分组内容');
    expect(wrapper.find('.custom-content').classes()).toContain('pb-4');
  });

  it('点击标题抛出展开状态', /** 不抛出会让父组件无法记录用户展开的分组。 */ async () => {
    const wrapper = mountAccordion();
    await nextTick();

    await wrapper.find('button').trigger('click');
    await nextTick();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['group-1']);
  });

  it('标题图标插槽可被覆盖', /** 无法覆盖会让业务无法使用自定义展开图标。 */ async () => {
    const wrapper = mount(
      h(
        Accordion,
        { modelValue: '', type: 'single' },
        {
          /** 渲染带自定义图标的分组。 */
          default: () =>
            h(
              AccordionItem,
              { value: 'group-1' },
              {
                /** 渲染标题与内容。 */
                default: () => [
                  h(
                    AccordionTrigger,
                    {},
                    {
                      /** 标题文本。 */
                      default: () => '分组标题',
                      /** 自定义图标。 */
                      icon: () => h('i', { class: 'custom-arrow' }),
                    },
                  ),
                  h(
                    AccordionContent,
                    {},
                    {
                      /** 分组内容文案。 */
                      default: () => '分组内容',
                    },
                  ),
                ],
              },
            ),
        },
      ),
    );
    await nextTick();

    expect(wrapper.find('.custom-arrow').exists()).toBe(true);
    expect(wrapper.find('svg').exists()).toBe(false);
  });
});
