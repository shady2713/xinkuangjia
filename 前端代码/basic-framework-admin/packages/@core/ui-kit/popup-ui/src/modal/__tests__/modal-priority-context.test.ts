/**
 * 弹窗事件处理器读取优先级值的真实消费者测试。
 *
 * 回归点：modal.vue 用 usePriorityValues 生成 closeOnPressEscape、openAutoFocus、
 * closeOnClickModal、draggable 等 computed，而 Escape、打开焦点、点击外部、焦点移出
 * 这些处理器只在事件触发时才读取它们。修复前 computed getter 在事件回调里执行，
 * 没有 active instance，会抛出 `useSlots() called without active instance`。
 * 因此这里不 mock composable，而是按业务侧的方式挂载 useVbenModal 返回的真实组件，
 * 再从 DialogContent 上触发真实事件，断言处理器的可观察行为。
 */
import type { ExtendedModalApi, ModalApiOptions } from '../modal';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { DialogContent, DialogHeader } from '@vben-core/shadcn-ui';

import { describe, expect, it, vi } from 'vitest';

import { useVbenModal } from '../use-modal';

/**
 * 构造一个仅触发指定事件的替身事件对象。
 * @param target 事件目标；指针按下外部用例需要它来读取 dataset 标记。
 * @returns 记录 preventDefault / stopPropagation 调用次数的对象，按 Event 形状使用。
 */
function createEvent(target?: HTMLElement) {
  const event = {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target,
  };
  return event as unknown as Event & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

/**
 * 按业务侧用法挂载弹窗并打开。
 * @description 使用 useVbenModal 生成真实组件与命令式 API，挂载后立即 open，
 * 让 DialogContent 进入可交互状态。
 * 不使用 teleport stub：stub 会让 DialogContent 的渲染副作用反复自触发，
 * 触发 "Maximum recursive updates exceeded"，那是测试替身引入的假象而非产品缺陷。
 * @param options 传给 useVbenModal 的初始弹窗配置。
 * @returns 弹窗 API、DialogContent 与 DialogHeader 组件包装器，以及挂载结果。
 * @throws Error 组件未在 setup 中交出 API 时抛出，避免用例静默地什么都不验证。
 */
async function mountOpenedModal(options: ModalApiOptions = {}) {
  const captured: { api?: ExtendedModalApi } = {};

  const Host = defineComponent({
    name: 'ModalConsumerHost',
    /**
     * 用真实 useVbenModal 建立弹窗组件与命令式 API，并把 API 交给用例驱动。
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

  const wrapper = mount(Host);
  await nextTick();

  const api = captured.api;
  if (!api) {
    throw new Error('弹窗组件未在 setup 中交出 API');
  }
  api.open();
  await nextTick();

  return {
    api,
    content: wrapper.findComponent(DialogContent),
    header: wrapper.findComponent(DialogHeader),
    wrapper,
  };
}

describe('modal 事件处理器读取优先级值', /** 覆盖 Escape、焦点、点击外部与拖拽四类处理器。 */ () => {
  it('默认允许 Escape 关闭时事件回调不抛错且不阻止默认行为', /** 回归点：事件回调内首次求值 computed。 */ async () => {
    const { content } = await mountOpenedModal();
    const event = createEvent();

    // 修复前这里抛出 `useSlots() called without active instance`。
    content.vm.$emit('escape-key-down', event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('关闭 Escape 关闭后事件回调阻止默认行为', /** 状态来源必须真正决定处理器行为。 */ async () => {
    const { content } = await mountOpenedModal({ closeOnPressEscape: false });
    const event = createEvent();

    content.vm.$emit('escape-key-down', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('状态更新后 Escape 处理重新解析最新配置', /** 状态更新必须让 computed 失效。 */ async () => {
    const { api, content } = await mountOpenedModal();
    const allowed = createEvent();
    content.vm.$emit('escape-key-down', allowed);
    expect(allowed.preventDefault).not.toHaveBeenCalled();

    api.setState({ closeOnPressEscape: false });
    await nextTick();

    const blocked = createEvent();
    content.vm.$emit('escape-key-down', blocked);
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('默认 openAutoFocus 为 false 时打开焦点事件被阻止', /** 默认配置下必须阻止自动聚焦。 */ async () => {
    const { content } = await mountOpenedModal();
    const event = createEvent();

    content.vm.$emit('open-auto-focus', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('允许 openAutoFocus 时不阻止打开焦点事件', /** 放开自动聚焦后不得再阻止。 */ async () => {
    const { content } = await mountOpenedModal({ openAutoFocus: true });
    const event = createEvent();

    content.vm.$emit('open-auto-focus', event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('默认允许点击遮罩关闭时不阻止外部交互', /** 默认配置下外部交互放行。 */ async () => {
    const { content } = await mountOpenedModal();
    const event = createEvent();

    content.vm.$emit('interact-outside', event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('禁止点击遮罩关闭时阻止外部交互', /** 禁止遮罩关闭时必须同时阻止默认行为与冒泡。 */ async () => {
    const { content } = await mountOpenedModal({ closeOnClickModal: false });
    const event = createEvent();

    content.vm.$emit('interact-outside', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('指针按下外部时按关闭配置与可关闭标记决定是否阻止', /** 缺少可关闭标记的外部按下必须被阻止。 */ async () => {
    const { content } = await mountOpenedModal();
    // target 缺少 dismissableModal 标记：不允许作为可关闭区域，必须阻止。
    const event = createEvent(document.createElement('div'));

    content.vm.$emit('pointer-down-outside', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('焦点移出始终被阻止', /** 焦点移出不依赖优先级值，必须恒定阻止。 */ async () => {
    const { content } = await mountOpenedModal();
    const event = createEvent();

    content.vm.$emit('close-auto-focus', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('开启拖拽后头部带可拖拽样式，关闭后不带', /** 拖拽计算属性必须在渲染期解析正确。 */ async () => {
    const draggable = await mountOpenedModal({ draggable: true });
    expect(draggable.header.classes()).toContain('cursor-move');

    const fixed = await mountOpenedModal({ draggable: false });
    expect(fixed.header.classes()).not.toContain('cursor-move');
  });
});
