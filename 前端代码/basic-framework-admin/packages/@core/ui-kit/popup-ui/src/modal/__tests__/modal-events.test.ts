/**
 * 弹窗组件（popup-ui 的 modal.vue）事件、按钮与生命周期回调的真实消费者回归。
 *
 * 该文件补齐 `modal-priority-context.test.ts` 未覆盖的交互路径：全屏按钮、打开/关闭动画
 * 完成回调、遮罩关闭事件、底部取消与确认按钮、挂载到内容区域以及 keep-alive 停用行为。
 * 用例按业务侧用法挂载 `useVbenModal` 返回的真实组件，通过真实事件与点击驱动处理器，
 * 断言弹窗状态、回调调用与真实渲染结果。弹窗内容会 teleport 到 body，因此 DOM 结果通过
 * 组件暴露的内容引用读取，而不是包装器的 HTML。
 */

import type { VueWrapper } from '@vue/test-utils';

import type { ExtendedModalApi, ModalApiOptions } from '../modal';

import { mount } from '@vue/test-utils';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';

import { Expand, Shrink } from '@vben-core/icons';
import {
  Dialog,
  DialogContent,
  VbenButton,
  VbenIconButton,
} from '@vben-core/shadcn-ui';
import { ELEMENT_ID_MAIN_CONTENT } from '@vben-core/shared/constants';

import { describe, expect, it, vi } from 'vitest';

import { useVbenModal } from '../use-modal';

/** DialogContent 暴露的内容引用读取函数，返回内部真实元素。 */
type ContentRefGetter = () => undefined | { $el: HTMLElement };

/** 记录挂载结果中的弹窗 API 与关键组件包装器。 */
interface ModalHarness {
  /** 命令式弹窗 API，用于驱动状态与读取最终状态。 */
  api: ExtendedModalApi;
  /** 真实 DialogContent 包装器，用于触发动画事件与读取类名。 */
  content: VueWrapper<InstanceType<typeof DialogContent>>;
  /** 真实 Dialog 根包装器，用于触发遮罩关闭事件。 */
  dialog: VueWrapper<InstanceType<typeof Dialog>>;
  /** 宿主组件包装器，用于查找按钮等子组件。 */
  wrapper: VueWrapper;
}

/**
 * 按业务侧用法挂载弹窗并打开。
 * @param options 传给 useVbenModal 的初始弹窗配置。
 * @returns 弹窗 API、Dialog 根、DialogContent 与宿主包装器。
 * @throws Error 组件未在 setup 中交出 API 时抛出，避免用例静默地什么都不验证。
 */
async function mountOpenedModal(
  options: ModalApiOptions = {},
): Promise<ModalHarness> {
  const captured: { api?: ExtendedModalApi } = {};
  const Host = defineComponent({
    name: 'ModalEventsHost',
    /** 用真实 useVbenModal 建立弹窗组件与命令式 API，并把 API 交给用例驱动。
     * @returns 渲染弹窗组件的渲染函数。
     */
    setup() {
      const [Modal, modalApi] = useVbenModal(options);
      captured.api = modalApi;
      /** 渲染真实弹窗组件。 */
      const renderModal = () => h(Modal);
      return renderModal;
    },
  });

  const wrapper = mount(Host) as VueWrapper;
  await nextTick();
  const api = captured.api;
  if (!api) throw new Error('弹窗组件未在 setup 中交出 API');
  api.open();
  await nextTick();

  return {
    api,
    content: wrapper.findComponent(DialogContent),
    dialog: wrapper.findComponent(Dialog),
    wrapper,
  };
}

/**
 * 读取弹窗内容元素的真实 DOM 节点。
 * @param content DialogContent 包装器。
 * @returns 承载位移样式的真实元素。
 * @throws Error DialogContent 未暴露内容引用时抛出，避免断言落到 undefined。
 */
function readContentElement(content: VueWrapper) {
  /** DialogContent 暴露的内容引用形状，仅声明本用例读取到的成员。 */
  type ContentExpose = {
    getContentRef?: ContentRefGetter;
  };
  const exposed = content.vm as unknown as ContentExpose;
  const inner = exposed.getContentRef?.();
  if (!inner) throw new Error('DialogContent 未暴露内容引用');
  return inner.$el;
}

/**
 * 按文案查找底部按钮，未命中时直接失败而不是静默跳过点击。
 * @param wrapper 弹窗宿主包装器。
 * @param text 业务传入或内置的按钮文案。
 * @returns 文案匹配的按钮包装器。
 * @throws Error 文案没有匹配到按钮时抛出。
 */
function findButtonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper
    .findAllComponents(VbenButton)
    .find(
      /** 按业务传入的按钮文案定位目标按钮。 */ (item) => item.text() === text,
    );
  if (!button) throw new Error(`未找到文案为 ${text} 的底部按钮`);
  return button;
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

describe('弹窗全屏按钮', /** 全屏按钮决定内容区展示方式，状态与图标必须同步。 */ () => {
  it('点击后切换全屏状态并更换图标', /** 状态已切换但图标不变会让用户无法判断当前是否全屏。 */ async () => {
    const { api, wrapper } = await mountOpenedModal();

    expect(wrapper.findComponent(Shrink).exists()).toBe(false);
    await wrapper.findComponent(VbenIconButton).trigger('click');

    expect(api.store.state.fullscreen).toBe(true);
    await nextTick();
    expect(wrapper.findComponent(Shrink).exists()).toBe(true);
    expect(wrapper.findComponent(Expand).exists()).toBe(false);
  });

  it('再次点击退出全屏', /** 全屏必须可逆，否则用户只能刷新页面。 */ async () => {
    const { api, wrapper } = await mountOpenedModal({ fullscreen: true });

    await wrapper.findComponent(VbenIconButton).trigger('click');

    expect(api.store.state.fullscreen).toBe(false);
    await nextTick();
    expect(wrapper.findComponent(Expand).exists()).toBe(true);
  });
});

describe('弹窗动画完成回调', /** 打开与关闭动画回调是业务侧初始化数据与清理状态的时机。 */ () => {
  it('打开动画完成后在下一帧回调 onOpened', /** 回调必须等动画帧结束，否则业务侧读不到已完成布局的弹窗。 */ async () => {
    const onOpened = vi.fn();
    const requestFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(
        /** 同步执行帧回调，确定性地验证回调时机。 */ (callback) => {
          callback(0);
          return 1;
        },
      );
    const { content } = await mountOpenedModal({ onOpened });

    content.vm.$emit('opened');

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(onOpened).toHaveBeenCalledTimes(1);
    requestFrame.mockRestore();
  });

  it('关闭动画完成后回调 onClosed 并隐藏内容', /** 关闭回调用于释放资源，隐藏标记决定动画结束后是否仍可见。 */ async () => {
    const onClosed = vi.fn();
    const { api, content, wrapper } = await mountOpenedModal({
      destroyOnClose: false,
      onClosed,
    });

    await api.close();
    expect(api.store.state.isOpen).toBe(false);
    content.vm.$emit('closed');
    await nextTick();

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(wrapper.findComponent(DialogContent).props('class')).toContain(
      'hidden',
    );
  });

  it('未关闭时收到关闭动画事件不回调 onClosed', /** 打开状态下收到关闭事件属于异常顺序，不能误报关闭完成。 */ async () => {
    const onClosed = vi.fn();
    const { content } = await mountOpenedModal({
      destroyOnClose: false,
      onClosed,
    });

    content.vm.$emit('closed');

    expect(onClosed).not.toHaveBeenCalled();
  });
});

describe('弹窗遮罩关闭事件', /** update:open 是遮罩与关闭按钮的统一出口。 */ () => {
  it('非提交状态收到关闭事件时关闭弹窗', /** 正常状态下用户点击遮罩必须能关闭弹窗。 */ async () => {
    const { api, dialog } = await mountOpenedModal({ destroyOnClose: false });

    dialog.vm.$emit('update:open', false);
    await vi.waitFor(
      /** 等待异步关闭流程写入状态。 */ () => {
        expect(api.store.state.isOpen).toBe(false);
      },
    );
  });

  it('提交状态收到关闭事件时保持打开', /** 提交中关闭会丢失已提交的数据，必须被忽略。 */ async () => {
    const { api, dialog } = await mountOpenedModal({ destroyOnClose: false });
    api.lock();
    await nextTick();

    dialog.vm.$emit('update:open', false);
    await nextTick();

    expect(api.store.state.isOpen).toBe(true);
  });
});

describe('弹窗外部指针按下', /** 遮罩是弹窗唯一的"可关闭区域"标记来源，标记与提交状态共同决定是否放行。 */ () => {
  it('提交状态下点击遮罩阻止默认行为', /** 提交中误触遮罩会丢失数据，必须阻止。 */ async () => {
    const { api, content } = await mountOpenedModal({ destroyOnClose: false });
    api.lock();
    await nextTick();
    const overlay = document.querySelector('[data-dismissable-modal]');
    expect(overlay).not.toBeNull();
    const event = createEvent(overlay as HTMLElement);

    content.vm.$emit('pointer-down-outside', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('非提交状态下点击遮罩放行关闭流程', /** 正常状态下遮罩必须可关闭弹窗，不能在标记匹配时被误阻止。 */ async () => {
    const { content } = await mountOpenedModal({ destroyOnClose: false });
    const overlay = document.querySelector('[data-dismissable-modal]');
    expect(overlay).not.toBeNull();
    const event = createEvent(overlay as HTMLElement);

    content.vm.$emit('pointer-down-outside', event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
});

describe('弹窗底部按钮', /** 取消与确认按钮是业务表单的提交出口。 */ () => {
  it('点击取消按钮回调 onCancel', /** 取消必须回调业务侧注册的处理函数，而不是静默关闭。 */ async () => {
    const onCancel = vi.fn();
    const { wrapper } = await mountOpenedModal({
      cancelText: '取消操作',
      confirmText: '确认操作',
      onCancel,
    });

    await findButtonByText(wrapper, '取消操作').trigger('click');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点击确认按钮回调 onConfirm', /** 确认必须回调业务侧提交逻辑。 */ async () => {
    const onConfirm = vi.fn();
    const { wrapper } = await mountOpenedModal({
      cancelText: '取消操作',
      confirmText: '确认操作',
      onConfirm,
    });

    await findButtonByText(wrapper, '确认操作').trigger('click');

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('未传入按钮文案时使用内置中文文案', /** 未配置文案时不能渲染空按钮。 */ async () => {
    const { wrapper } = await mountOpenedModal();

    expect(
      wrapper
        .findAllComponents(VbenButton)
        .map(/** 收集底部按钮的真实文案。 */ (button) => button.text())
        .filter(
          /** 只保留有文案的底部按钮，排除图标类按钮。 */ (text) => text !== '',
        ),
    ).toEqual(['取消', '确认']);
  });
});

describe('弹窗挂载位置与居中', /** 挂载点与居中表达式决定弹窗在内容区中的实际位置。 */ () => {
  it('未声明挂载到内容区域时挂载到 body', /** 默认挂载点变化会让弹窗脱离对话框层级。 */ async () => {
    const { content } = await mountOpenedModal();

    expect(content.props('appendTo')).toBe('body');
  });

  it('声明挂载到内容区域时使用内容区选择器', /** appendToMain 必须真实进入 DialogContent，否则弹窗被挂到 body。 */ async () => {
    const mainContent = document.createElement('div');
    mainContent.id = ELEMENT_ID_MAIN_CONTENT;
    mainContent.innerHTML = '<div><div class="inner-content"></div></div>';
    document.body.append(mainContent);

    const { content } = await mountOpenedModal({ appendToMain: true });

    expect(content.props('appendTo')).toBe(
      `#${ELEMENT_ID_MAIN_CONTENT}>div:not(.absolute)>div`,
    );
    // 真实挂载点存在时，弹窗内容必须落在该内容区而不是 body。
    expect(
      mainContent.querySelector('[data-dismissable-modal]') ??
        mainContent.querySelector('[role="dialog"]'),
    ).not.toBeNull();
    mainContent.remove();
  });

  it('居中配置在重新打开时写入居中位移', /** 重新打开必须重新计算位移，否则弹窗会停留在上次位置。 */ async () => {
    const { api, content } = await mountOpenedModal({
      centered: true,
      destroyOnClose: false,
    });

    await api.close();
    api.open();
    await nextTick();

    expect(readContentElement(content).style.transform).toBe(
      'translate(0px, calc(-50% + 0px))',
    );
  });

  it('非居中配置写入普通位移', /** 非居中弹窗不能带上居中偏移，否则弹窗会跳出可视区域。 */ async () => {
    const { api, content } = await mountOpenedModal({
      centered: false,
      destroyOnClose: false,
    });

    await api.close();
    api.open();
    await nextTick();

    expect(readContentElement(content).style.transform).toBe(
      'translate(0px, 0px)',
    );
  });
});

describe('keep-alive 停用行为', /** 页签切换会停用弹窗，未关闭的弹窗必须在返回时保持正确状态。 */ () => {
  it('未挂载到内容区域时停用即关闭弹窗', /** 停用后仍保持打开会让用户返回时看到残留弹窗。 */ async () => {
    const { api, switchAway } = await mountKeepAliveModal();

    await switchAway();

    expect(api.store.state.isOpen).toBe(false);
  });

  it('挂载到内容区域时停用不关闭弹窗', /** 内容区内的弹窗需要跨页签保留，不能随停用被关闭。 */ async () => {
    // appendToMain 需要真实内容区作为挂载目标，否则 teleport 目标为空会导致渲染异常。
    const mainContent = document.createElement('div');
    mainContent.id = ELEMENT_ID_MAIN_CONTENT;
    mainContent.innerHTML = '<div><div class="inner-content"></div></div>';
    document.body.append(mainContent);

    const { api, switchAway } = await mountKeepAliveModal({
      appendToMain: true,
    });

    await switchAway();

    expect(api.store.state.isOpen).toBe(true);
    mainContent.remove();
  });
});

/**
 * 在 keep-alive 中挂载已打开的弹窗。
 * @param options 传给 useVbenModal 的初始弹窗配置。
 * @returns 弹窗 API 与切换到其它视图的驱动函数。
 * @throws Error 组件未在 setup 中交出 API 时抛出。
 */
async function mountKeepAliveModal(options: ModalApiOptions = {}) {
  const captured: { api?: ExtendedModalApi } = {};
  const showModal = ref(true);
  const OtherView = defineComponent({
    name: 'OtherView',
    /** 渲染一个用于替换弹窗的占位视图。
     * @returns 渲染占位节点的渲染函数。
     */
    setup() {
      /** 渲染占位节点。 */
      const renderOther = () => h('div', { class: 'other-view' });
      return renderOther;
    },
  });
  const Host = defineComponent({
    name: 'KeepAliveHost',
    /** 用 keep-alive 承载弹窗，并通过切换视图触发停用。
     * @returns 渲染 keep-alive 的渲染函数。
     */
    setup() {
      const [Modal, modalApi] = useVbenModal(options);
      captured.api = modalApi;
      /** 在弹窗与占位视图之间切换，切换即触发弹窗停用。 */
      const renderKeepAlive = () =>
        h(KeepAlive, null, {
          /** 渲染当前生效的视图，切换视图即触发弹窗停用。 */
          default: () => (showModal.value ? h(Modal) : h(OtherView)),
        });
      return renderKeepAlive;
    },
  });
  const wrapper = mount(Host);
  await nextTick();
  const api = captured.api;
  if (!api) throw new Error('弹窗组件未在 setup 中交出 API');
  api.open();
  await nextTick();

  /** 切换到其它视图以停用弹窗。 */
  const switchAway = async () => {
    showModal.value = false;
    await nextTick();
    expect(wrapper.findComponent(OtherView).exists()).toBe(true);
  };

  return { api, switchAway };
}
