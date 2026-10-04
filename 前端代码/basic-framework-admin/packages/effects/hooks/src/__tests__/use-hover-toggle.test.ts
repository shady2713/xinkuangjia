/**
 * 元素悬停状态 composable（effects/hooks 的 use-hover-toggle）真实行为回归。
 *
 * 用户下拉菜单等悬浮组件用它判断鼠标是否还在触发元素或内容区内：
 * - 鼠标离开必须按声明的延迟生效，延迟内再次进入要取消待处理的离开，
 *   否则鼠标从触发元素移向内容区的途中菜单会闪烁关闭；
 * - 进入延迟与离开延迟可分别配置，数字、函数与配置对象三种写法都要落到正确的一侧；
 * - 监测目标是元素数组时，鼠标在任一元素内都算在内；目标数量变化后必须重建监听；
 * - 目标为组件实例时要退回到它的根元素，目标为 null 时不能抛错；
 * - 控制器暂停后不得再响应鼠标事件，恢复后必须重新生效；
 * - 组件卸载必须清掉待处理定时器与全部监听，否则卸载后仍会改写状态。
 * 用例用真实 DOM 元素与真实鼠标事件驱动，只替换时钟以获得确定的延迟断言。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHoverToggle } from '../use-hover-toggle';

/** useHoverToggle 的监测目标类型：单个元素、元素数组或它们的响应式引用。 */
type HoverTarget = Parameters<typeof useHoverToggle>[0];

/** useHoverToggle 的延迟配置类型：毫秒数、取值函数或进入/离开延迟对象。 */
type HoverDelay = Parameters<typeof useHoverToggle>[1];

/** 悬停状态 ref：鼠标是否在任一被监测元素内部。 */
type HoverValue = ReturnType<typeof useHoverToggle>[0];

/** 悬停监听控制器：暂停后不再响应鼠标事件，恢复后重新生效。 */
type HoverController = ReturnType<typeof useHoverToggle>[1];

/** 用例可驱动的挂载结果：组件包装器、悬停状态与控制器。 */
interface HoverHarness {
  /** 暂停与恢复悬停监听。 */
  controller: HoverController;
  /** 鼠标是否在任一被监测元素内部。 */
  value: HoverValue;
  /** 已挂载的宿主组件包装器。 */
  wrapper: ReturnType<typeof mount>;
}

/** 本用例创建并挂到文档流的元素，用例结束后统一移除，避免跨用例串扰。 */
const createdElements: HTMLElement[] = [];

beforeEach(
  /** 启用假定时器并把元素登记表清空，使延迟断言不依赖真实时钟。 */ () => {
    vi.useFakeTimers();
    createdElements.length = 0;
  },
);

afterEach(
  /** 恢复真实时钟并移除本用例创建的元素。 */ () => {
    vi.useRealTimers();
    for (const element of createdElements) {
      element.remove();
    }
    createdElements.length = 0;
  },
);

/**
 * 建立一个已挂到文档流的真实元素，使鼠标事件能被真实派发。
 * @returns 已挂载的 div 元素。
 */
function createElement() {
  const element = document.createElement('div');
  document.body.append(element);
  createdElements.push(element);
  return element;
}

/**
 * 取出 composable 返回的悬停状态 ref。
 * @param value 宿主组件 setup 中保存的返回值。
 * @returns 悬停状态 ref。
 * @throws Error 宿主组件没有暴露返回值时抛出，避免用例静默地什么都不验证。
 */
function requireValue(value: HoverValue | undefined): HoverValue {
  if (!value) {
    throw new Error('宿主组件未暴露悬停状态');
  }
  return value;
}

/**
 * 取出 composable 返回的控制器。
 * @param controller 宿主组件 setup 中保存的返回值。
 * @returns 悬停监听控制器。
 * @throws Error 宿主组件没有暴露控制器时抛出，避免用例静默地什么都不验证。
 */
function requireController(
  controller: HoverController | undefined,
): HoverController {
  if (!controller) {
    throw new Error('宿主组件未暴露悬停控制器');
  }
  return controller;
}

/**
 * 取出组件包装器的根 DOM 元素。
 * @param wrapper 已挂载的组件包装器。
 * @returns 组件渲染出的根元素。
 * @throws Error 组件根节点不是元素时抛出，避免对非元素目标派发事件。
 */
function requireElement(wrapper: ReturnType<typeof mount>): HTMLElement {
  const element = wrapper.element;
  if (!(element instanceof HTMLElement)) {
    throw new TypeError('组件根节点不是元素');
  }
  return element;
}

/**
 * 挂载一个真实调用 useHoverToggle 的宿主组件，并把返回值暴露给用例。
 * @param target 传给 composable 的监测目标。
 * @param delay 传给 composable 的延迟配置。
 * @returns 宿主包装器、悬停状态与控制器。
 */
function mountHover(target: HoverTarget, delay?: HoverDelay): HoverHarness {
  /** 承接 setup 中同步取到的 composable 返回值。 */
  const holder: {
    controller?: HoverController;
    value?: HoverValue;
  } = {};
  const wrapper = mount(
    defineComponent({
      /**
       * 调用被测 composable 并渲染宿主节点。
       * @returns 渲染占位宿主节点的渲染函数。
       */
      setup() {
        const [value, controller] = useHoverToggle(target, delay);
        holder.value = value;
        holder.controller = controller;
        return /** 渲染占位宿主节点，鼠标事件由用例对真实目标派发。 */ () =>
          h('div', { class: 'hover-host' });
      },
    }),
  );
  return {
    controller: requireController(holder.controller),
    value: requireValue(holder.value),
    wrapper,
  };
}

/**
 * 向元素派发一次鼠标进入或离开事件。
 * @param element 目标元素。
 * @param type 事件类型：mouseenter 表示进入，mouseleave 表示离开。
 */
function dispatchHover(element: Element, type: 'mouseenter' | 'mouseleave') {
  element.dispatchEvent(new MouseEvent(type));
}

describe('单个元素的悬停延迟', /** 进入与离开的延迟口径决定悬浮菜单是否可用。 */ () => {
  it('进入立即生效、离开按默认 500ms 延迟生效', /** 离开无延迟会让鼠标移向内容区时菜单闪退。 */ async () => {
    const element = createElement();
    const { value } = mountHover(element);

    expect(value.value).toBe(false);

    dispatchHover(element, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(true);

    dispatchHover(element, 'mouseleave');
    await nextTick();
    expect(value.value).toBe(true);

    vi.advanceTimersByTime(499);
    expect(value.value).toBe(true);

    vi.advanceTimersByTime(1);
    expect(value.value).toBe(false);
  });

  it('离开延迟内再次进入会取消待处理的离开', /** 不取消会把已经悬停的状态再次置为离开，菜单会闪烁。 */ async () => {
    const element = createElement();
    const { value } = mountHover(element, 200);

    dispatchHover(element, 'mouseenter');
    await nextTick();
    dispatchHover(element, 'mouseleave');
    await nextTick();
    vi.advanceTimersByTime(150);
    dispatchHover(element, 'mouseenter');
    await nextTick();

    vi.advanceTimersByTime(1000);

    expect(value.value).toBe(true);
  });

  it('进入延迟内离开会取消待处理的进入', /** 不取消会让鼠标已经移开后状态仍被置为悬停。 */ async () => {
    const element = createElement();
    const { value } = mountHover(element, { enterDelay: 100, leaveDelay: 0 });

    dispatchHover(element, 'mouseenter');
    await nextTick();
    vi.advanceTimersByTime(50);
    expect(value.value).toBe(false);

    dispatchHover(element, 'mouseleave');
    await nextTick();
    vi.advanceTimersByTime(500);

    expect(value.value).toBe(false);
  });

  it('数字延迟只作用于离开，进入仍立即生效', /** 把数字延迟同时用于进入会让悬停响应变慢。 */ async () => {
    const element = createElement();
    const { value } = mountHover(element, 120);

    dispatchHover(element, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(true);

    dispatchHover(element, 'mouseleave');
    await nextTick();
    expect(value.value).toBe(true);
    vi.advanceTimersByTime(120);
    expect(value.value).toBe(false);
  });

  it('数字延迟为 0 时离开立即生效', /** 0 仍走定时器会让“无延迟”配置产生一帧延迟。 */ async () => {
    const element = createElement();
    const { value } = mountHover(element, 0);

    dispatchHover(element, 'mouseenter');
    await nextTick();
    dispatchHover(element, 'mouseleave');
    await nextTick();

    expect(value.value).toBe(false);
  });

  it('配置对象可分别控制进入与离开延迟', /** 进入延迟未按配置生效会让悬停展开时机与需求不符。 */ async () => {
    const element = createElement();
    const { value } = mountHover(element, { enterDelay: 200, leaveDelay: 0 });

    dispatchHover(element, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(false);
    vi.advanceTimersByTime(200);
    expect(value.value).toBe(true);

    dispatchHover(element, 'mouseleave');
    await nextTick();
    expect(value.value).toBe(false);
  });

  it('函数形式的进入延迟按调用结果生效', /** 函数延迟不调用会让读取动态配置的写法失去意义。 */ async () => {
    const element = createElement();
    const enterDelay = vi.fn(/** 返回本用例声明的进入延迟毫秒数。 */ () => 40);
    const { value } = mountHover(element, { enterDelay, leaveDelay: 10 });

    dispatchHover(element, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(false);
    vi.advanceTimersByTime(40);
    expect(value.value).toBe(true);
    expect(enterDelay).toHaveBeenCalled();

    dispatchHover(element, 'mouseleave');
    await nextTick();
    vi.advanceTimersByTime(10);
    expect(value.value).toBe(false);
  });

  it('第二参数为函数时按返回值控制离开', /** 动态延迟用于按偏好设置调整离开时间。 */ async () => {
    const element = createElement();
    const leaveDelay = vi.fn(/** 返回本用例声明的离开延迟毫秒数。 */ () => 60);
    const { value } = mountHover(element, leaveDelay);

    dispatchHover(element, 'mouseenter');
    await nextTick();
    dispatchHover(element, 'mouseleave');
    await nextTick();
    vi.advanceTimersByTime(59);
    expect(value.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(value.value).toBe(false);
    expect(leaveDelay).toHaveBeenCalled();
  });

  it('延迟函数返回 0 时离开立即生效', /** 动态配置为 0 时仍等待会与移出行为不符。 */ async () => {
    const element = createElement();
    const { value } = mountHover(
      element,
      /** 动态返回 0，表示不做离开延迟。 */ () => 0,
    );

    dispatchHover(element, 'mouseenter');
    await nextTick();
    dispatchHover(element, 'mouseleave');
    await nextTick();

    expect(value.value).toBe(false);
  });

  it('组件实例目标退回到它的根元素', /** 传组件实例时找不到真实元素会完全不响应悬停。 */ async () => {
    const child = mount(
      defineComponent({
        /**
         * 渲染承载鼠标事件的根元素。
         * @returns 渲染根元素的渲染函数。
         */
        setup() {
          return /** 输出一个可定位的根元素。 */ () =>
            h('div', { class: 'child-root' });
        },
      }),
    );
    const { value } = mountHover(child.vm, 0);
    const root = requireElement(child);

    dispatchHover(root, 'mouseenter');
    await nextTick();

    expect(value.value).toBe(true);
  });
});

describe('多元素与目标变化', /** 触发区与内容区分属不同元素时，任一命中都必须算在内。 */ () => {
  it('任一元素被悬停即视为在内，空槽位不参与监听', /** 空槽位当元素使用会在绑定监听时报错。 */ async () => {
    const trigger = createElement();
    const content = createElement();
    const { value } = mountHover([trigger, null, content], 0);

    dispatchHover(content, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(true);

    dispatchHover(content, 'mouseleave');
    await nextTick();
    expect(value.value).toBe(false);
  });

  it('元素数量变化后重建监听', /** 不重建会让后出现的内容区永远无法把状态保持为悬停。 */ async () => {
    const list = ref<HTMLElement[] | null>(null);
    const { value } = mountHover(list, 0);

    expect(value.value).toBe(false);

    const first = createElement();
    list.value = [first];
    await nextTick();
    dispatchHover(first, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(true);

    const second = createElement();
    list.value = [first, second];
    await nextTick();
    expect(value.value).toBe(false);

    dispatchHover(second, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(true);
  });
});

describe('控制器与卸载清理', /** 暂停语义与卸载清理直接决定悬浮组件在路由切换后的行为。 */ () => {
  it('暂停后不响应鼠标事件，恢复后重新生效', /** 暂停失效会让点击触发模式仍被悬停干扰。 */ async () => {
    const element = createElement();
    const { controller, value } = mountHover(element, 0);

    controller.disable();
    dispatchHover(element, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(false);

    controller.enable();
    await nextTick();
    dispatchHover(element, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(true);
  });

  it('卸载时清掉待处理的离开并停止监听', /** 残留定时器与监听会在组件卸载后继续改写状态。 */ async () => {
    const element = createElement();
    const { value, wrapper } = mountHover(element, 200);

    dispatchHover(element, 'mouseenter');
    await nextTick();
    expect(value.value).toBe(true);

    dispatchHover(element, 'mouseleave');
    await nextTick();
    expect(value.value).toBe(true);

    wrapper.unmount();
    vi.advanceTimersByTime(1000);
    await nextTick();
    expect(value.value).toBe(true);

    dispatchHover(element, 'mouseenter');
    dispatchHover(element, 'mouseleave');
    await nextTick();
    vi.advanceTimersByTime(1000);

    expect(value.value).toBe(true);
  });
});
