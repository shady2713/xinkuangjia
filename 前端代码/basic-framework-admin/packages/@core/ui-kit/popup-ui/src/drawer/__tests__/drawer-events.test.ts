/**
 * 抽屉组件（popup-ui 的 drawer.vue）事件、按钮与关闭生命周期的真实消费者回归。
 *
 * 该文件补齐 `use-drawer.test.ts` 只装配不交互的缺口：抽屉的关闭按钮、遮罩与 Escape
 * 的放行判断、外部指针按下的可关闭标记比对、打开与关闭动画回调、关闭兜底定时器以及
 * keep-alive 停用时的自动关闭。这些判断写错会让提交中的抽屉被误关、遮罩点击失效、
 * 关闭动画不触发时抽屉内容残留，或缓存页面返回时抽屉仍然悬在界面上。用例按业务侧用法
 * 挂载 `useVbenDrawer` 返回的真实组件，通过真实事件与点击驱动处理器，只替换布局引擎的
 * 移动端判定。抽屉内容会 teleport 到 body，因此 DOM 结果通过组件包装器读取。每个用例结束后
 * 统一卸载本次挂载的宿主：抽屉关闭后组件会注册 350ms 的关闭兜底定时器，只有卸载才会清理，
 * 残留的定时器或渲染任务会在测试环境拆除之后访问已移除的 DOM 全局，形成未处理拒绝。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { DrawerApiOptions, ExtendedDrawerApi } from '../drawer';

import { mount } from '@vue/test-utils';
import { defineComponent, h, KeepAlive, nextTick, onMounted, ref } from 'vue';

import {
  Sheet,
  SheetContent,
  VbenButton,
  VbenIconButton,
} from '@vben-core/shadcn-ui';
import { ELEMENT_ID_MAIN_CONTENT } from '@vben-core/shared/constants';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVbenDrawer } from '../use-drawer';

/** 记录挂载结果中的抽屉 API 与关键组件包装器。 */
interface DrawerHarness {
  /** 命令式抽屉 API，用于驱动状态与读取最终状态。 */
  api: ExtendedDrawerApi;
  /** 真实 SheetContent 包装器，用于触发动画与交互事件。 */
  content: VueWrapper<InstanceType<typeof SheetContent>>;
  /** 本次挂载的内容类名，用于在残留的抽屉元素中精确定位当前抽屉。 */
  contentClass: string;
  /** 真实 Sheet 根包装器，用于触发遮罩关闭事件。 */
  sheet: VueWrapper<InstanceType<typeof Sheet>>;
  /** 宿主组件包装器，用于查找关闭按钮等子组件。 */
  wrapper: VueWrapper;
}

/** 挂载序号；每个用例结束后统一卸载，唯一类名仍用于在多个抽屉间定位当前用例的元素。 */
let drawerSequence = 0;

/**
 * 本文件已挂载但尚未卸载的宿主包装器，按用例收集并在用例结束后统一卸载。
 *
 * 抽屉关闭后 `drawer.vue` 会注册 350ms 的关闭兜底定时器，并把 `isClosed` 置为 true 触发重渲染；
 * 两者都只在该组件卸载时停止（`onUnmounted(clearCloseFallbackTimer)`）。若用例结束后组件继续存活，
 * 定时器会在 happy-dom 环境拆除之后触发，重渲染走到 reka-ui 的 `forwardRef` 读取已被移除的
 * `Element` 全局，抛出 `ReferenceError` 并成为未处理拒绝，令整条 `pnpm test:unit` 以 1 退出。
 */
const mountedWrappers: VueWrapper[] = [];

/**
 * 按业务侧用法挂载抽屉并打开。
 * @param options 传给 useVbenDrawer 的初始抽屉配置。
 * @returns 抽屉 API、Sheet 根、SheetContent 与宿主包装器。
 * @throws Error 组件未在 setup 中交出 API 时抛出，避免用例静默地什么都不验证。
 */
async function mountOpenedDrawer(
  options: DrawerApiOptions = {},
): Promise<DrawerHarness> {
  drawerSequence += 1;
  const contentClass = `drawer-events-content-${drawerSequence}`;
  const captured: { api?: ExtendedDrawerApi } = {};
  const Host = defineComponent({
    name: 'DrawerEventsHost',
    /**
     * 用真实 useVbenDrawer 建立抽屉组件与命令式 API，并把 API 交给用例驱动。
     * @returns 渲染抽屉组件的渲染函数。
     */
    setup() {
      const [Drawer, drawerApi] = useVbenDrawer({
        ...options,
        class: contentClass,
      });
      captured.api = drawerApi;
      return /** 渲染真实抽屉组件。 */ () => h(Drawer);
    },
  });

  const wrapper = mount(Host) as VueWrapper;
  mountedWrappers.push(wrapper);
  await nextTick();
  const api = captured.api;
  if (!api) {
    throw new Error('抽屉组件未在 setup 中交出 API');
  }
  api.open();
  await nextTick();

  return {
    api,
    content: wrapper.findComponent(SheetContent),
    contentClass,
    sheet: wrapper.findComponent(Sheet),
    wrapper,
  };
}

/**
 * 读取指定抽屉内容元素的真实 DOM 节点。
 *
 * 抽屉内容由 SheetContent 渲染在 Teleport 内，包装器无法直接定位，因此按本次挂载的
 * 唯一类名读取，避免命中其它用例未卸载的抽屉元素。
 * @param contentClass 本次挂载使用的内容类名。
 * @returns 承载抽屉内容动画事件的元素。
 * @throws Error 未渲染该抽屉内容元素时抛出，避免断言落到 undefined。
 */
function readDrawerElement(contentClass: string) {
  const element = document.querySelector(`.${contentClass}`);
  if (!element) {
    throw new Error('未渲染抽屉内容元素');
  }
  return element;
}

/**
 * 在指定抽屉的内容元素上派发真实的动画结束事件；事件同步派发，无需等待。
 * @param contentClass 本次挂载使用的内容类名。
 */
function dispatchAnimationEnd(contentClass: string) {
  readDrawerElement(contentClass).dispatchEvent(new Event('animationend'));
}

/**
 * 构造只用于断言阻止结果的替身事件对象。
 * @param target 事件目标；外部指针按下用例需要它来读取可关闭区域标记。
 * @returns 记录 preventDefault / stopPropagation 调用次数的对象，按 Event 形状使用。
 */
function createEvent(target?: HTMLElement) {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target,
  } as unknown as Event & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

afterEach(
  /**
   * 先卸载本用例挂载的全部抽屉，再还原真实计时器与所有替身。
   *
   * 卸载会走 `drawer.vue` 的 `onUnmounted(clearCloseFallbackTimer)`，取消关闭后 350ms 的兜底
   * 定时器并解绑监听与响应式副作用；否则这些挂起任务会在本文件的环境拆除之后才执行，
   * 触发对已销毁 DOM 的重渲染并抛出未处理拒绝。
   */
  () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    // 卸载必须把抽屉子树彻底移出文档：只要组件实例还活着，它的响应式写入就可能在环境
    // 拆除之后重渲染，而重渲染会读取 reka-ui `forwardRef` 里已被移除的 Element 全局。
    expect(
      document.querySelectorAll('[class*="drawer-events-content-"]'),
    ).toHaveLength(0);
  },
);

describe('抽屉关闭按钮', /** 关闭按钮是用户最直接的退出路径，必须即时隐藏内容并回调关闭完成。 */ () => {
  it('点击关闭按钮关闭抽屉并即时隐藏内容', /** 未即时隐藏会让动画缺失时抽屉内容残留在界面上。 */ async () => {
    const onClosed = vi.fn();
    const { api, content, wrapper } = await mountOpenedDrawer({ onClosed });

    await wrapper.findComponent(VbenIconButton).trigger('click');
    await nextTick();

    expect(api.store.state.isOpen).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(content.props('class')).toContain('hidden');
  });

  it('关闭动画事件重复触发时只回调一次关闭完成', /** 动画回调与兜底定时器都会触发，重复回调会让业务侧重复释放资源。 */ async () => {
    const onClosed = vi.fn();
    const { api, content } = await mountOpenedDrawer({
      destroyOnClose: false,
      onClosed,
    });

    await api.close();
    content.vm.$emit('closed');
    await nextTick();
    content.vm.$emit('closed');
    await nextTick();

    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('未关闭时收到关闭动画事件不回调关闭完成', /** 打开状态下收到关闭事件属于异常顺序，不能误报关闭完成。 */ async () => {
    const onClosed = vi.fn();
    const { content } = await mountOpenedDrawer({
      destroyOnClose: false,
      onClosed,
    });

    content.vm.$emit('closed');
    await nextTick();

    expect(onClosed).not.toHaveBeenCalled();
  });

  it('打开动画完成后回调打开完成', /** 业务侧依赖打开回调初始化数据，回调丢失会让抽屉内容为空。 */ async () => {
    const onOpened = vi.fn();
    const { content } = await mountOpenedDrawer({ onOpened });

    content.vm.$emit('opened');
    await nextTick();

    expect(onOpened).toHaveBeenCalledTimes(1);
  });
});

describe('抽屉关闭兜底定时器', /** 关闭动画事件不触发时必须靠兜底收口，否则抽屉内容会永久残留。 */ () => {
  it('关闭后动画事件缺失时由兜底定时器完成关闭', /** 缺少兜底会让部分场景下的抽屉关闭后仍占满屏幕。 */ async () => {
    vi.useFakeTimers();
    const onClosed = vi.fn();
    const { api } = await mountOpenedDrawer({ onClosed });

    await api.close();
    expect(onClosed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(350);

    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('重新打开时取消未到期的兜底定时器', /** 未取消会让重新打开的抽屉被上一轮定时器误判为已关闭。 */ async () => {
    vi.useFakeTimers();
    const onClosed = vi.fn();
    const { api } = await mountOpenedDrawer({ onClosed });

    await api.close();
    api.open();
    await nextTick();
    vi.advanceTimersByTime(400);

    expect(onClosed).not.toHaveBeenCalled();
  });
});

describe('抽屉遮罩关闭事件', /** update:open 是遮罩与关闭按钮的统一出口。 */ () => {
  it('收到关闭事件时关闭抽屉', /** 用户点击遮罩必须能关闭抽屉。 */ async () => {
    const { api, sheet } = await mountOpenedDrawer({ destroyOnClose: false });

    sheet.vm.$emit('update:open', false);
    await vi.waitFor(
      /** 等待异步关闭流程写入状态。 */ () => {
        expect(api.store.state.isOpen).toBe(false);
      },
    );
  });
});

describe('抽屉交互放行判断', /** 提交中或显式关闭交互能力时，任何外部交互都必须被阻止。 */ () => {
  it('默认状态点击遮罩放行关闭流程', /** 正常状态下遮罩必须可关闭抽屉。 */ async () => {
    const { content } = await mountOpenedDrawer({ destroyOnClose: false });
    const event = createEvent();

    content.vm.$emit('interact-outside', event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('提交状态点击遮罩阻止关闭', /** 提交中误触遮罩会丢失已填内容，必须阻止。 */ async () => {
    const { api, content } = await mountOpenedDrawer({ destroyOnClose: false });
    api.lock();
    await nextTick();
    const event = createEvent();

    content.vm.$emit('interact-outside', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('显式关闭点击遮罩能力时阻止关闭', /** 该开关用于强制用户做出选择，失效会让流程被绕过。 */ async () => {
    const { content } = await mountOpenedDrawer({
      closeOnClickModal: false,
      destroyOnClose: false,
    });
    const event = createEvent();

    content.vm.$emit('interact-outside', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('默认状态按 Escape 放行关闭流程', /** 正常状态下 Escape 必须可关闭抽屉。 */ async () => {
    const { content } = await mountOpenedDrawer({ destroyOnClose: false });
    const event = createEvent();

    content.vm.$emit('escape-key-down', event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('提交状态按 Escape 阻止关闭', /** 提交中按 Escape 会丢失已填内容，必须阻止。 */ async () => {
    const { api, content } = await mountOpenedDrawer({ destroyOnClose: false });
    api.lock();
    await nextTick();
    const event = createEvent();

    content.vm.$emit('escape-key-down', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('显式关闭 Escape 能力时阻止关闭', /** 该开关用于强制用户做出选择，失效会让流程被绕过。 */ async () => {
    const { content } = await mountOpenedDrawer({
      closeOnPressEscape: false,
      destroyOnClose: false,
    });
    const event = createEvent();

    content.vm.$emit('escape-key-down', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('指针按下遮罩且标记匹配时放行关闭', /** 标记比对写死会让正常的遮罩点击被误判为不可关闭。 */ async () => {
    const { content } = await mountOpenedDrawer({ destroyOnClose: false });
    const overlay = document.querySelector('[data-dismissable-drawer]');
    expect(overlay).not.toBeNull();
    const event = createEvent(overlay as HTMLElement);

    content.vm.$emit('pointer-down-outside', event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('指针按下位置没有可关闭标记时阻止关闭', /** 未校验标记会让抽屉内的任意点击都触发关闭。 */ async () => {
    const { content } = await mountOpenedDrawer({ destroyOnClose: false });
    const event = createEvent(document.createElement('div'));

    content.vm.$emit('pointer-down-outside', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('提交状态下指针按下遮罩阻止关闭', /** 提交中误触遮罩会丢失已填内容，必须阻止。 */ async () => {
    const { api, content } = await mountOpenedDrawer({ destroyOnClose: false });
    api.lock();
    await nextTick();
    const overlay = document.querySelector('[data-dismissable-drawer]');
    const event = createEvent(overlay as HTMLElement);

    content.vm.$emit('pointer-down-outside', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('抽屉焦点处理', /** 焦点事件写错会让抽屉抢走页面焦点或让焦点逃出抽屉。 */ () => {
  it('默认不自动聚焦时阻止打开自动聚焦', /** 默认关闭自动聚焦可避免移动端键盘弹起，失效会打断用户当前输入。 */ async () => {
    const { content } = await mountOpenedDrawer({ destroyOnClose: false });
    const event = createEvent();

    content.vm.$emit('open-auto-focus', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('显式开启自动聚焦时放行', /** 该开关用于需要立即输入的场景，失效会让用户必须手动点输入框。 */ async () => {
    const { content } = await mountOpenedDrawer({
      destroyOnClose: false,
      openAutoFocus: true,
    });
    const event = createEvent();

    content.vm.$emit('open-auto-focus', event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('焦点移出抽屉时阻止并停止传播', /** 未阻止会让焦点落到抽屉外的不可见元素上，键盘操作失去上下文。 */ async () => {
    const { content } = await mountOpenedDrawer({ destroyOnClose: false });
    const event = createEvent();

    content.vm.$emit('focus-outside', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('关闭时自动聚焦事件同样被阻止并停止传播', /** 关闭阶段的焦点处理与打开阶段同源，漏处理会让焦点残留在已关闭的抽屉上。 */ async () => {
    const { content } = await mountOpenedDrawer({ destroyOnClose: false });
    const event = createEvent();

    content.vm.$emit('close-auto-focus', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });
});

describe('抽屉在 keep-alive 中停用', /** 缓存页面返回时抽屉必须自动关闭，否则会悬停在新的页面上。 */ () => {
  it('未挂载到内容区域时停用即关闭抽屉', /** 停用不关闭会让用户在切换标签页后仍看到上一个页面的抽屉。 */ async () => {
    const captured: { api?: ExtendedDrawerApi } = {};
    const view = ref<'drawer' | 'other'>('drawer');
    const Other = defineComponent({
      name: 'OtherView',
      /**
       * 渲染普通占位节点，用于把抽屉组件挤出渲染位置。
       * @returns 渲染占位节点的渲染函数。
       */
      setup() {
        return /** 输出可定位节点，便于断言切换已生效。 */ () =>
          h('div', { class: 'other-view' });
      },
    });
    const Host = defineComponent({
      name: 'DrawerKeepAliveHost',
      /**
       * 在 keep-alive 中渲染抽屉，并交出命令式 API。
       * @returns 按当前视图渲染的渲染函数。
       */
      setup() {
        const [Drawer, drawerApi] = useVbenDrawer({ destroyOnClose: false });
        captured.api = drawerApi;
        onMounted(
          /** 挂载后打开抽屉，使停用路径有可关闭的对象。 */ () => {
            drawerApi.open();
          },
        );
        return /** 在缓存容器内按视图切换抽屉与占位组件。 */ () =>
          h(KeepAlive, null, {
            /** 渲染当前视图对应的组件。 */
            default: () => (view.value === 'drawer' ? h(Drawer) : h(Other)),
          });
      },
    });

    const wrapper = mount(Host) as VueWrapper;
    mountedWrappers.push(wrapper);
    await nextTick();
    const api = captured.api;
    if (!api) {
      throw new Error('抽屉组件未在 setup 中交出 API');
    }
    expect(api.store.state.isOpen).toBe(true);

    view.value = 'other';
    await nextTick();
    await vi.waitFor(
      /** 等待停用钩子写入关闭状态。 */ () => {
        expect(api.store.state.isOpen).toBe(false);
      },
    );

    expect(wrapper.find('.other-view').exists()).toBe(true);
  });
});

describe('抽屉挂载到主内容区域', /** 挂载目标决定抽屉相对内容区定位还是相对视口定位。 */ () => {
  it('挂载到主内容区域时使用内容区选择器与绝对定位', /** 选择器或定位写错会让抽屉覆盖整个视口或找不到挂载点。 */ async () => {
    const main = document.createElement('div');
    main.id = ELEMENT_ID_MAIN_CONTENT;
    const inner = document.createElement('div');
    const target = document.createElement('div');
    inner.append(target);
    main.append(inner);
    document.body.append(main);

    const { content } = await mountOpenedDrawer({
      appendToMain: true,
      destroyOnClose: false,
    });

    expect(content.props('appendTo')).toBe(
      `#${ELEMENT_ID_MAIN_CONTENT}>div:not(.absolute)>div`,
    );
    expect(content.props('appendTo')).not.toBe('body');
    main.remove();
  });
});

describe('抽屉关闭图标位置', /** 关闭图标位置决定头部布局与左侧分隔线是否出现。 */ () => {
  it('关闭图标放在左侧时头部渲染分隔线并可关闭抽屉', /** 缺少左侧布局会让该配置下头部挤在一起，关闭入口消失。 */ async () => {
    const onClosed = vi.fn();
    const { api, wrapper } = await mountOpenedDrawer({
      closeIconPlacement: 'left',
      onClosed,
    });

    const closeButton = wrapper.findComponent(VbenIconButton);
    expect(closeButton.exists()).toBe(true);
    await closeButton.trigger('click');
    await nextTick();

    expect(api.store.state.isOpen).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

describe('抽屉底部按钮', /** 底部取消与确认按钮是业务提交的主入口。 */ () => {
  it('点击取消按钮触发取消回调', /** 取消回调丢失会让业务侧无法清理未提交的数据。 */ async () => {
    const onCancel = vi.fn();
    const { wrapper } = await mountOpenedDrawer({
      cancelText: '取消本次编辑',
      destroyOnClose: false,
      onCancel,
    });

    const cancelButton = wrapper
      .findAllComponents(VbenButton)
      .find(
        /** 按业务声明的文案定位取消按钮。 */ (item) =>
          item.text() === '取消本次编辑',
      );
    if (!cancelButton) {
      throw new Error('未找到取消按钮');
    }
    await cancelButton.trigger('click');
    await nextTick();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点击确认按钮触发确认回调', /** 确认回调丢失会让提交按钮点了没有任何反应。 */ async () => {
    const onConfirm = vi.fn();
    const { wrapper } = await mountOpenedDrawer({
      confirmText: '保存本次编辑',
      destroyOnClose: false,
      onConfirm,
    });

    const confirmButton = wrapper
      .findAllComponents(VbenButton)
      .find(
        /** 按业务声明的文案定位确认按钮。 */ (item) =>
          item.text() === '保存本次编辑',
      );
    if (!confirmButton) {
      throw new Error('未找到确认按钮');
    }
    await confirmButton.trigger('click');
    await nextTick();

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('抽屉动画结束事件', /** 动画结束事件是抽屉内容真正显示或隐藏的判定来源。 */ () => {
  it('打开状态下动画结束触发打开完成回调', /** 打开动画结束未回调会让业务侧拿不到"内容已可见"的时机。 */ async () => {
    const onOpened = vi.fn();
    const { contentClass } = await mountOpenedDrawer({
      destroyOnClose: false,
      onOpened,
    });

    dispatchAnimationEnd(contentClass);
    await nextTick();

    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it('关闭状态下动画结束触发关闭完成回调', /** 关闭动画结束未回调会让抽屉内容在动画后残留。 */ async () => {
    const onClosed = vi.fn();
    const { api, contentClass } = await mountOpenedDrawer({
      destroyOnClose: false,
      onClosed,
    });

    await api.close();
    await nextTick();
    dispatchAnimationEnd(contentClass);
    await nextTick();

    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
