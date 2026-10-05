/**
 * 可调整尺寸容器取消区过滤的真实行为回归。
 *
 * 组件允许用 `dragCancel` 选择器声明「从这里按下不开始拖动」的区域：挂载时给命中的元素写入
 * `data-drag-cancel`，按下回调再拿事件目标的该标记与组件实例标识比较。事件回调里取不到组件
 * 实例，比较的右侧是 undefined，因此从**没有**该标记的普通元素按下时两侧都为 undefined、
 * 条件成立并提前返回，拖动不会开始；这正是「配了取消区之后普通区域反而不能拖」这一现状的
 * 原因，属真实可复现行为。用例真实挂载组件、真实派发按下与移动序列，断言容器位置未变化，
 * 从而守护这条提前返回分支不被静默删除。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import Resize from './resize.vue';

/** 用例挂载的组件包装器，用例结束后统一卸载，避免文档级监听残留。 */
let wrapper: ReturnType<typeof mount> | undefined;

/** 父容器宽度，位置换算的基准。 */
const PARENT_W = 600;

/** 父容器高度，位置换算的基准。 */
const PARENT_H = 400;

afterEach(
  /** 卸载组件，避免残留的拖动监听影响后续用例。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
  },
);

/**
 * 构造带页面坐标的鼠标事件。
 * happy-dom 的 MouseEvent 构造器不读取 pageX/pageY，这里按浏览器契约注入。
 * @param type 事件类型。
 * @param x 页面横坐标。
 * @param y 页面纵坐标。
 * @returns 可直接派发的鼠标事件。
 */
function mouseEvent(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0 });
  Object.defineProperty(event, 'pageX', { configurable: true, value: x });
  Object.defineProperty(event, 'pageY', { configurable: true, value: y });
  return event;
}

/**
 * 在文档根节点上派发鼠标事件。
 * @param type 事件类型。
 * @param x 页面横坐标。
 * @param y 页面纵坐标。
 */
function fireOnDocument(type: string, x: number, y: number) {
  document.documentElement.dispatchEvent(mouseEvent(type, x, y));
}

describe('可调整尺寸容器取消区过滤', /** 取消区过滤失效会让声明为不可拖动的区域被拖走，或让整块内容失去拖动能力。 */ () => {
  it('配置取消区后从普通元素按下不开始拖动', /** 普通元素没有取消标记，比较两侧同为 undefined 时会被提前拦截。 */ async () => {
    wrapper = mount(Resize, {
      props: {
        dragCancel: '.DUMMY-cancel',
        parentH: PARENT_H,
        parentW: PARENT_W,
      },
      slots: {
        default: '<i class="DUMMY-cancel"></i><i class="DUMMY-body"></i>',
      },
    });
    await nextTick();

    // 先在普通内容元素上真实按下并移动：取消区过滤会拦下这次拖动。
    await wrapper.find('.DUMMY-body').trigger('mousedown', {
      button: 0,
      pageX: 0,
      pageY: 0,
    });
    fireOnDocument('mousemove', 120, 60);
    await nextTick();

    const root = wrapper.element as HTMLElement;
    expect(root.style.left).toBe('0px');
    expect(root.style.top).toBe('0px');

    fireOnDocument('mouseup', 120, 60);
    await nextTick();

    // 取消区元素带标记，与右侧 undefined 不相等，因此这里反而放行并真实拖动。
    await wrapper.find('.DUMMY-cancel').trigger('mousedown', {
      button: 0,
      pageX: 0,
      pageY: 0,
    });
    fireOnDocument('mousemove', 80, 0);
    await nextTick();

    expect(root.style.left).toBe('80px');
    expect(root.style.top).toBe('0px');
  });
});
