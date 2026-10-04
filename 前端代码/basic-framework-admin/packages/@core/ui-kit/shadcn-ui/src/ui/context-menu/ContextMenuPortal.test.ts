/**
 * 右键菜单传送门（ContextMenuPortal.vue）的真实行为回归。
 *
 * 该组件是 reka-ui 传送门的薄封装：把外部属性原样转交给传送门，并把默认插槽内容渲染到指定容器。
 * 断言读取真实文档中的传送结果，验证 `to` 属性的转交与插槽内容的落点。
 */
import type { Component } from 'vue';

import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { ContextMenuRoot, ContextMenuTrigger } from 'reka-ui';
import { afterEach, describe, expect, it } from 'vitest';

import ContextMenuPortal from './ContextMenuPortal.vue';

/** 每个用例挂载的菜单宿主，用例结束后卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

/**
 * 在真实的右键菜单根节点内挂载被测传送门。
 * @param portalProps 传给 ContextMenuPortal 的属性，用于指定传送目标。
 * @returns 已挂载的组件包装器。
 */
async function mountMenuPortal(portalProps: Record<string, unknown> = {}) {
  mounted = mount(
    h(
      ContextMenuRoot,
      { open: true },
      {
        /** 渲染触发目标与传送门。 */
        default: () => [
          h(
            ContextMenuTrigger,
            {},
            {
              /** 触发目标文本。 */
              default: () => '右键目标',
            },
          ),
          h(ContextMenuPortal as Component, portalProps, {
            /** 传送门内的菜单内容。 */
            default: () => h('div', { class: 'menu-body' }, '菜单内容'),
          }),
        ],
      },
    ),
  );
  await nextTick();
  await nextTick();
  return mounted;
}

describe('传送行为（ContextMenuPortal.vue）', /** 属性转交与插槽渲染的真实契约。 */ () => {
  afterEach(
    /** 卸载菜单，避免传送节点残留到后续用例。 */ () => {
      mounted?.unmount();
      mounted = undefined;
    },
  );

  it('菜单打开时把插槽内容传送到指定容器', /** to 属性必须真实转交给传送门，插槽内容要出现在目标容器内。 */ async () => {
    const container = document.createElement('div');
    container.id = 'context-menu-target';
    document.body.append(container);

    try {
      await mountMenuPortal({ to: container });

      expect(container.querySelector('.menu-body')?.textContent).toBe(
        '菜单内容',
      );
      // 传送目标之外的文档位置不应出现菜单内容。
      expect(document.querySelectorAll('.menu-body')).toHaveLength(1);
    } finally {
      container.remove();
    }
  });

  it('未指定目标时传送到 body 且不渲染到包装器内部', /** 默认传送目标是 body，组件自身不承载菜单节点。 */ async () => {
    const wrapper = await mountMenuPortal();

    expect(document.querySelector('.menu-body')?.textContent).toBe('菜单内容');
    expect(wrapper.find('.menu-body').exists()).toBe(false);
    expect(wrapper.text()).toContain('右键目标');
  });

  it('disabled 为真时内容留在原位置而不传送到目标容器', /** 关闭传送必须让内容跟随组件渲染，属性转交不能只对 to 生效。 */ async () => {
    const container = document.createElement('div');
    container.id = 'context-menu-disabled-target';
    document.body.append(container);

    try {
      const wrapper = await mountMenuPortal({
        disabled: true,
        to: container,
      });

      expect(container.querySelector('.menu-body')).toBe(null);
      expect(wrapper.find('.menu-body').exists()).toBe(true);
    } finally {
      container.remove();
    }
  });
});
