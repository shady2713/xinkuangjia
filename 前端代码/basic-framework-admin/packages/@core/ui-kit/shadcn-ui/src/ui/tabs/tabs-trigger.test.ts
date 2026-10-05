/**
 * 页签触发件（shadcn-ui 的 ui/tabs 的 TabsTrigger）状态与样式回归。
 *
 * 页签触发件用于切换面板：选中项必须标记为 active 并抛出取值，未选中项保持 inactive，否则
 * 用户无法判断当前面板，面板也不会切换。用例真实挂载 reka-ui 的页签根节点，读取真实状态属性
 * 与取值更新事件。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { TabsList, TabsRoot } from 'reka-ui';
import { describe, expect, it } from 'vitest';

import TabsTrigger from './TabsTrigger.vue';

/**
 * 挂载页签并返回包装器。
 * @param modelValue 当前选中的页签取值。
 * @param values 记录取值更新的数组。
 * @returns 已挂载的页签包装器。
 */
function mountTabs(modelValue = 'first', values: unknown[] = []) {
  return mount(
    h(
      TabsRoot,
      {
        modelValue,
        /** 记录取值更新。 */
        'onUpdate:modelValue': (value: unknown) => {
          values.push(value);
        },
      },
      {
        /** 渲染页签列表与两个触发件。 */
        default: () =>
          h(
            TabsList,
            {},
            {
              /** 渲染两个页签触发件。 */
              default: () =>
                ['first', 'second'].map(
                  /** 按取值渲染触发件。 */ (value) =>
                    h(
                      TabsTrigger,
                      { class: `trigger-${value}`, value },
                      {
                        /** 触发件文案。 */
                        default: () =>
                          value === 'first' ? '基本信息' : '扩展信息',
                      },
                    ),
                ),
            },
          ),
      },
    ),
  );
}

describe('页签触发件状态与样式', /** 状态标记决定用户能否辨认当前面板。 */ () => {
  it('选中项标记为 active 并渲染选中样式', /** 未标记会让用户看不出当前在哪一页。 */ async () => {
    const wrapper = mountTabs();
    await nextTick();

    const active = wrapper.find('.trigger-first');
    expect(active.attributes('data-state')).toBe('active');
    expect(active.attributes('role')).toBe('tab');
    expect(active.attributes('aria-selected')).toBe('true');
    expect(active.classes()).toContain('rounded-md');
    expect(active.classes()).toContain('trigger-first');
    expect(active.text()).toBe('基本信息');
  });

  it('未选中项标记为 inactive', /** 未选中项被标成 active 会让两个页签同时高亮。 */ async () => {
    const wrapper = mountTabs();
    await nextTick();

    const inactive = wrapper.find('.trigger-second');
    expect(inactive.attributes('data-state')).toBe('inactive');
    expect(inactive.attributes('aria-selected')).toBe('false');
    expect(inactive.classes()).toContain('trigger-second');
  });

  it('禁用项不可切换', /** 禁用态失效会让用户点进未开放的页签。 */ async () => {
    const wrapper = mount(
      h(
        TabsRoot,
        { modelValue: 'first' },
        {
          /** 渲染页签列表与一个禁用页签。 */
          default: () =>
            h(
              TabsList,
              {},
              {
                /** 渲染禁用页签。 */
                default: () =>
                  h(
                    TabsTrigger,
                    {
                      class: 'trigger-disabled',
                      disabled: true,
                      value: 'second',
                    },
                    {
                      /** 触发件文案。 */
                      default: () => '扩展信息',
                    },
                  ),
              },
            ),
        },
      ),
    );
    await nextTick();

    expect(
      wrapper.find('.trigger-disabled').attributes('disabled'),
    ).toBeDefined();
  });
});

describe('页签切换契约', /** 切换结果决定面板是否跟随用户点击。 */ () => {
  it('点击未选中项抛出新的取值', /** 不抛出会让面板停留在旧页签。 */ async () => {
    const values: unknown[] = [];
    const wrapper = mountTabs('first', values);
    await nextTick();

    // 页签按真实交互链路激活：先按下再触发点击。
    await wrapper.find('.trigger-second').trigger('mousedown');
    await wrapper.find('.trigger-second').trigger('click');
    await nextTick();

    expect(values).toEqual(['second']);
  });
});
