/**
 * 提示弹窗骨架（alert-dialog 系列组件）的真实行为回归。
 *
 * 这三个组件是提示弹窗的渲染骨架：内容容器必须在动画结束后转发打开/关闭事件、
 * 点击遮罩必须请求关闭、暴露的内容引用必须可被外部读取，描述容器必须合并外部类名
 * 并渲染插槽内容。用例挂载真实骨架组件，通过真实 DOM 事件与真实插槽驱动，
 * 只替换第三方对话框根组件的受控开关。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '../index';

/** 内容容器的公开实例类型，仅声明用例真正读取的暴露成员。 */
type ContentExposed = {
  /** 读取内容容器实例引用。 */
  getContentRef: () => unknown;
};

/**
 * 挂载受控的弹窗骨架。
 * @param open 初始打开状态。
 * @param listeners 本次要观察的内容容器事件。
 * @returns 已挂载的包装器与受控开关。
 */
async function mountDialog(
  open: boolean,
  listeners: Record<string, unknown> = {},
) {
  const openState = ref(open);
  const contentRef = ref<null | unknown>(null);
  const Harness = defineComponent({
    name: 'AlertDialogHarness',
    /** 渲染真实对话框根与内容容器。 */
    render: /** 组合根组件、遮罩与内容容器。 */ () =>
      h(
        AlertDialog,
        { open: openState.value },
        {
          /** 渲染弹窗内容容器。 */
          default: () =>
            h(
              AlertDialogContent,
              { open: openState.value, ref: contentRef, ...listeners },
              {
                /** 渲染可识别的弹窗内容。 */
                default: () => [
                  h(AlertDialogTitle, null, {
                    /** 渲染标题文本。 */
                    default: () => '标题',
                  }),
                  h(
                    AlertDialogDescription,
                    { class: 'probe-desc' },
                    {
                      /** 渲染描述文本。 */
                      default: () => '描述内容',
                    },
                  ),
                ],
              },
            ),
        },
      ),
  });
  const wrapper = mount(Harness, { attachTo: document.body });
  await nextTick();
  return { contentRef, openState, wrapper };
}

/**
 * 读取文档中的内容容器元素。
 * @returns 内容容器元素；未渲染时返回 null。
 */
function contentElement() {
  return document.querySelector('[role="alertdialog"]');
}

describe('提示弹窗骨架', /** 骨架的动画事件与遮罩点击是弹窗关闭链路的真实入口。 */ () => {
  it('动画结束后转发打开与关闭事件', /** 事件不转发会让命令式弹窗永远悬挂。 */ async () => {
    const opened = vi.fn();
    const closed = vi.fn();
    const { openState, wrapper } = await mountDialog(true, {
      onClosed: closed,
      onOpened: opened,
    });

    contentElement()?.dispatchEvent(
      new Event('animationend', { bubbles: true }),
    );
    await nextTick();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();

    openState.value = false;
    await nextTick();
    contentElement()?.dispatchEvent(
      new Event('animationend', { bubbles: true }),
    );
    await nextTick();
    expect(closed).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('点击遮罩请求关闭', /** 遮罩点击失效会让用户点空白处没反应。 */ async () => {
    const close = vi.fn();
    const { wrapper } = await mountDialog(true, { onClose: close });

    document.querySelector<HTMLElement>('.bg-overlay')?.click();
    await nextTick();

    expect(close).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('暴露的内容引用可被外部读取', /** 命令式弹窗依赖该引用做焦点与关闭处理。 */ async () => {
    const { wrapper } = await mountDialog(true);

    const content = wrapper.findComponent(AlertDialogContent);
    const exposed = content.vm as unknown as ContentExposed;
    expect(exposed.getContentRef()).toBeTruthy();
    wrapper.unmount();
  });

  it('描述容器合并外部类名并渲染插槽内容', /** 类名丢失会让弹窗正文排版与设计不符。 */ async () => {
    const { wrapper } = await mountDialog(true);

    const description = wrapper.findComponent(AlertDialogDescription);
    expect(description.classes()).toContain('probe-desc');
    expect(description.classes()).toContain('text-muted-foreground');
    expect(description.text()).toBe('描述内容');
    wrapper.unmount();
  });
});
