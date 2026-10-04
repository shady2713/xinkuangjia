/**
 * 对话框内容（DialogContent.vue）的真实行为回归。
 *
 * 覆盖三类只在真实挂载与真实事件下出现的契约：
 * ① appendTo 决定固定定位还是绝对定位，三个取值分支都必须有确定结果；
 * ② 遮罩与关闭按钮的点击都发出 close 事件；
 * ③ 仅在内容节点自身的动画结束时按 open 状态发出 opened 或 closed，其他目标的动画事件被忽略。
 * 断言读取真实 DOM 的内联定位样式与组件发出的事件，不使用测试替身替换被测组件。
 */
import { DOMWrapper, mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui';
import { afterEach, describe, expect, it } from 'vitest';

import DialogContent from './DialogContent.vue';
import DialogOverlay from './DialogOverlay.vue';

/** 每个用例挂载的对话框宿主，用例结束后统一卸载以清理 teleport 到 body 的节点。 */
let mounted: ReturnType<typeof mount> | undefined;

/**
 * 挂载对话框并在对话框根节点打开的状态下返回内容组件包装器。
 * @param contentProps 传给 DialogContent 的属性，用于改变定位与显示配置。
 * @param rootOpen 对话框根节点的打开状态；内容节点只在根节点打开时渲染。
 * @param contentOpen 内容自身的 open 属性，用于区分打开与关闭动画。
 * @returns DialogContent 的组件包装器。
 */
async function mountDialog(
  contentProps: Record<string, unknown> = {},
  rootOpen = true,
  contentOpen = rootOpen,
) {
  mounted = mount(
    h(
      DialogRoot,
      { open: rootOpen },
      {
        /** 渲染对话框内容组件。 */
        default: () =>
          h(
            DialogContent,
            { open: contentOpen, ...contentProps },
            {
              // 标题与说明用于满足无障碍要求，避免对话框在开发模式下持续告警。
              /** 渲染标题、说明与可见内容。 */
              default: () => [
                h(
                  DialogTitle,
                  {},
                  {
                    /** 对话框标题文本。 */
                    default: () => '对话框标题',
                  },
                ),
                h(
                  DialogDescription,
                  {},
                  {
                    /** 对话框说明文本。 */
                    default: () => '对话框说明',
                  },
                ),
                h('span', { class: 'dialog-body' }, '对话框内容'),
              ],
            },
          ),
      },
    ),
  );
  await nextTick();
  await nextTick();
  return mounted.findComponent(DialogContent);
}

/** 组件包装器的最小接口，用于读取组件实例上暴露的内容引用。 */
type ContentWrapper = { vm: unknown };

/** 组件实例上 defineExpose 暴露出的内容引用读取入口。 */
type ExposedContent = {
  /** 读取内容组件实例；尚未挂载时为 null。 */
  getContentRef?: () => unknown;
};

/**
 * 读取内容节点真实的根 DOM 元素。
 * 组件的根是 Teleport，模板中的事件监听与内联样式都落在被传送的真实节点上。
 * @param content DialogContent 的组件包装器。
 * @returns 内容节点的根元素。
 * @throws Error 组件未交出内容引用时抛出，避免用例静默地什么都不验证。
 */
function contentElement(content: ContentWrapper): HTMLElement {
  const exposed = (content.vm as { $: { exposed?: ExposedContent } }).$.exposed;
  const instance = exposed?.getContentRef?.() as null | { $el?: HTMLElement };
  const element = instance?.$el;
  if (!element) {
    throw new Error('对话框内容节点尚未挂载');
  }
  return element;
}

describe('定位与关闭交互（DialogContent.vue）', /** 定位计算与两个关闭入口的真实行为。 */ () => {
  afterEach(
    /** 卸载对话框，避免 teleport 节点残留到后续用例。 */ () => {
      mounted?.unmount();
      mounted = undefined;
    },
  );

  it('默认 appendTo 为 body 时固定定位并渲染遮罩', /** 默认配置必须把内容固定定位并渲染可点击遮罩。 */ async () => {
    const content = await mountDialog({ modal: true });

    expect(contentElement(content).style.position).toBe('fixed');
    expect(content.findComponent(DialogOverlay).exists()).toBe(true);
    expect(content.find('.dialog-body').exists()).toBe(false);
    // 内容被传送到 body，真实节点在文档里而不是包装器内部。
    expect(document.querySelector('.dialog-body')?.textContent).toBe(
      '对话框内容',
    );
  });

  it('appendTo 显式指向 body 元素时仍是固定定位', /** 传入真实 body 元素与传入 'body' 选择符必须得到同一定位结果。 */ async () => {
    const content = await mountDialog({
      appendTo: document.body,
      modal: true,
    });

    expect(contentElement(content).style.position).toBe('fixed');
  });

  it('appendTo 指向容器选择符时改为绝对定位', /** 挂载到内容区域时必须相对容器定位，否则弹窗会脱离业务容器。 */ async () => {
    const container = document.createElement('div');
    container.id = 'dialog-container';
    document.body.append(container);

    try {
      const content = await mountDialog({
        appendTo: '#dialog-container',
        modal: true,
      });

      expect(contentElement(content).style.position).toBe('absolute');
    } finally {
      container.remove();
    }
  });

  it('点击遮罩发出 close 事件', /** 遮罩点击是可关闭入口，必须只发出一次 close。 */ async () => {
    const content = await mountDialog({ modal: true });
    const overlay = content.findComponent(DialogOverlay);

    await overlay.trigger('click');

    expect(content.emitted('close')).toHaveLength(1);
  });

  it('点击关闭按钮发出 close 事件', /** 关闭按钮是可关闭入口，必须只发出一次 close。 */ async () => {
    const content = await mountDialog({ modal: true });
    const button = contentElement(content).querySelector('button');
    expect(button).not.toBe(null);
    expect(button?.disabled).toBe(false);

    await new DOMWrapper(button as HTMLElement).trigger('click');

    expect(content.emitted('close')).toHaveLength(1);
  });

  it('closeDisabled 为真时关闭按钮被禁用', /** 提交中等场景必须真正禁用按钮，不能只依赖视觉样式。 */ async () => {
    const content = await mountDialog({ closeDisabled: true, modal: true });

    expect(contentElement(content).querySelector('button')?.disabled).toBe(
      true,
    );
  });

  it('关闭按钮可以通过 showClose 隐藏', /** showClose 为假时关闭按钮不能出现在内容里。 */ async () => {
    const content = await mountDialog({ modal: true, showClose: false });

    expect(contentElement(content).querySelector('button')).toBe(null);
  });
});

describe('动画结束事件（DialogContent.vue）', /** opened 与 closed 只在内容节点自身动画结束时发出。 */ () => {
  afterEach(
    /** 卸载对话框，避免 teleport 节点残留到后续用例。 */ () => {
      mounted?.unmount();
      mounted = undefined;
    },
  );

  it('打开状态下内容动画结束发出 opened', /** 内容自身的动画结束才代表打开动画完成。 */ async () => {
    const content = await mountDialog({ modal: true }, true);
    const element = contentElement(content);

    element.dispatchEvent(new Event('animationend'));
    await nextTick();

    expect(content.emitted('opened')).toHaveLength(1);
    expect(content.emitted('closed')).toBeUndefined();
  });

  it('关闭状态下内容动画结束发出 closed', /** 根节点仍在渲染但 open 已为假时，动画结束代表关闭动画完成。 */ async () => {
    // 根节点保持打开让内容节点仍在文档中，内容自身按关闭状态判定关闭动画。
    const content = await mountDialog({ modal: true }, true, false);
    const element = contentElement(content);

    element.dispatchEvent(new Event('animationend'));
    await nextTick();

    expect(content.emitted('closed')).toHaveLength(1);
    expect(content.emitted('opened')).toBeUndefined();
  });

  it('子节点冒泡的动画结束事件不触发 opened', /** 只有内容节点自身的动画才结束对话框动画，子节点动画不得提前发出事件。 */ async () => {
    const content = await mountDialog({ modal: true }, true);
    const bubbleChild = document.createElement('span');
    contentElement(content).append(bubbleChild);

    bubbleChild.dispatchEvent(new Event('animationend', { bubbles: true }));
    await nextTick();

    expect(content.emitted('opened')).toBeUndefined();
    expect(content.emitted('closed')).toBeUndefined();
  });
});
