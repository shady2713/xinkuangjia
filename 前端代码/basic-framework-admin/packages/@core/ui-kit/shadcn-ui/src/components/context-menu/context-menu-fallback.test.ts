/**
 * 右键菜单封装（shadcn-ui 的 components/context-menu）宿主数据兜底回归。
 *
 * 宿主未传 handlerData 时组件必须以空对象兜底，否则菜单构建函数会读到 undefined 而报错。
 * 用例单独成文件：reka-ui 的右键菜单在同一测试文件里第二次打开会被前一次会话状态吞掉，
 * 因此每次「打开并断言构建入参」放在独立文件里，不用固定休眠掩盖。
 */
import { mount } from '@vue/test-utils';

import { afterEach, describe, expect, it, vi } from 'vitest';

import ContextMenu from './context-menu.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并移除传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document
      .querySelectorAll(
        '[data-reka-popper-content-wrapper], [data-reka-focus-guard]',
      )
      .forEach(
        /** 移除该浮层节点。 */ (node) => {
          node.remove();
        },
      );
  },
);

describe('右键菜单宿主数据兜底', /** 兜底缺失会让菜单构建读到 undefined 而报错。 */ () => {
  it('未传宿主数据时以空对象调用菜单构建函数', /** 菜单构建必须始终拿到对象，不能是 undefined。 */ async () => {
    const menus = vi.fn(
      /** 记录收到的数据包并产出空菜单。 */ (data: object) => {
        expect(data).toEqual({});
        return [];
      },
    );
    mounted = mount(ContextMenu, {
      props: { menus },
      slots: { default: '<span class="ctx-trigger">右键区域</span>' },
    });
    const trigger = mounted.find('.ctx-trigger');
    await trigger.trigger('contextmenu', {
      button: 2,
      clientX: 10,
      clientY: 20,
    });
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(
        /** 让出一轮事件循环等待菜单打开。 */ (resolve) => {
          setTimeout(resolve, 0);
        },
      );
      if (trigger.attributes('data-state') === 'open') {
        break;
      }
    }

    expect(trigger.attributes('data-state')).toBe('open');
    expect(menus).toHaveBeenCalledTimes(1);
  });
});
