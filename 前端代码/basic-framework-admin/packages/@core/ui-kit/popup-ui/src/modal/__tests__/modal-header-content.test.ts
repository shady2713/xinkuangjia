/**
 * 弹窗标题与说明（popup-ui 的 modal.vue）默认文案、提示气泡与无障碍标题的真实渲染回归。
 *
 * 头部是业务弹窗的说明区域：未传标题插槽时组件必须回退到 title/description 属性，否则弹窗
 * 顶部空白、用户不知道自己在操作什么；titleTooltip 的说明气泡漏渲染会让危险操作缺少解释；
 * 未声明标题或说明时仍要补上无障碍隐藏标题，否则读屏软件读不出对话框名称。用例按业务侧用法
 * 挂载 useVbenModal 返回的真实组件，弹窗内容会传送到 body，因此断言读取真实文档节点。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { ExtendedModalApi, ModalApiOptions } from '../modal';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVbenModal } from '../use-modal';

/** 本文件已挂载的宿主包装器，用例结束后统一卸载以清理传送节点。 */
const mountedWrappers: VueWrapper[] = [];

/** 记录挂载结果：命令式弹窗 API 与宿主包装器。 */
interface ModalHarness {
  /** 命令式弹窗 API，用于驱动打开与关闭。 */
  api: ExtendedModalApi;
  /** 宿主组件包装器。 */
  wrapper: VueWrapper;
}

/**
 * 按业务侧用法挂载弹窗并打开。
 * @param options 传给 useVbenModal 的初始弹窗配置。
 * @returns 弹窗 API 与宿主包装器。
 * @throws Error 组件未在 setup 中交出 API 时抛出，避免用例静默地什么都不验证。
 */
async function mountOpenedModal(
  options: ModalApiOptions = {},
): Promise<ModalHarness> {
  const captured: { api?: ExtendedModalApi } = {};
  const Host = defineComponent({
    name: 'ModalHeaderContentHost',
    /** 用真实 useVbenModal 建立弹窗组件与命令式 API，并把 API 交给用例驱动。
     * @returns 渲染弹窗组件的渲染函数。
     */
    setup() {
      const [Modal, modalApi] = useVbenModal(options);
      captured.api = modalApi;
      return /** 渲染真实弹窗组件。 */ () => h(Modal);
    },
  });

  const wrapper = mount(Host) as VueWrapper;
  mountedWrappers.push(wrapper);
  await nextTick();
  const api = captured.api;
  if (!api) {
    throw new Error('弹窗组件未在 setup 中交出 API');
  }
  api.open();
  await nextTick();
  await nextTick();

  return { api, wrapper };
}

/**
 * 读取传送到 body 的弹窗内容元素。
 * @returns 弹窗内容根节点。
 * @throws Error 弹窗内容未渲染时抛出，避免断言落到 undefined。
 */
function readModalContent() {
  const content = document.querySelector('[role="dialog"]');
  if (!content) {
    throw new Error('弹窗内容未渲染到文档');
  }
  return content;
}

afterEach(
  /** 卸载本文件挂载的全部弹窗并清理传送节点，避免残留影响后续用例。 */ () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  },
);

describe('弹窗标题与说明默认文案', /** 默认文案缺失会让弹窗顶部空白，用户无法确认操作对象。 */ () => {
  it('未提供插槽时按属性渲染标题与说明', /** 回退分支失效会让业务传入的文案整体丢失。 */ async () => {
    await mountOpenedModal({
      description: 'DUMMY-说明文案',
      title: 'DUMMY-标题文案',
    });

    const content = readModalContent();
    expect(content.textContent).toContain('DUMMY-标题文案');
    expect(content.textContent).toContain('DUMMY-说明文案');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('标题与说明同时存在时不重复渲染文案', /** 回退内容被渲染两次会让弹窗头部出现重复标题。 */ async () => {
    await mountOpenedModal({
      description: 'DUMMY-说明文案',
      title: 'DUMMY-标题文案',
    });

    const content = readModalContent();
    expect(content.textContent?.match(/DUMMY-标题文案/gu) ?? []).toHaveLength(
      1,
    );
  });
});

describe('弹窗标题提示气泡', /** 提示气泡解释标题背后的影响范围，漏渲染会让危险操作缺少说明。 */ () => {
  it('声明提示文案时渲染说明入口', /** 说明入口缺失会让用户看不到操作影响范围。 */ async () => {
    await mountOpenedModal({
      title: 'DUMMY-标题文案',
      titleTooltip: 'DUMMY-标题提示',
    });

    expect(
      document.querySelector('.lucide-circle-question-mark'),
    ).not.toBeNull();
  });

  it('悬停说明入口时渲染出真实提示文案', /** 提示内容未落地会让说明入口悬停后没有任何反应。 */ async () => {
    await mountOpenedModal({
      title: 'DUMMY-标题文案',
      titleTooltip: 'DUMMY-标题提示',
    });

    const trigger = document.querySelector('.lucide-circle-question-mark');
    if (!trigger) {
      throw new Error('说明入口未渲染');
    }
    trigger.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }),
    );

    await vi.waitFor(
      /** 等待提示面板真实渲染出说明文案。 */ () => {
        expect(document.body.textContent).toContain('DUMMY-标题提示');
      },
      { timeout: 2000 },
    );
  });

  it('未声明提示文案时不渲染说明入口', /** 负对照：没有说明却渲染图标会让用户误以为有额外解释。 */ async () => {
    await mountOpenedModal({ title: 'DUMMY-标题文案' });

    expect(document.querySelector('.lucide-circle-question-mark')).toBeNull();
  });
});

describe('弹窗缺少标题与说明', /** 读屏软件依赖隐藏标题识别对话框，缺少会让无障碍名称变成空串。 */ () => {
  it('未声明标题与说明时仍以隐藏标题标记对话框', /** 隐藏标题缺失会让对话框没有可访问名称。 */ async () => {
    await mountOpenedModal({});

    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) {
      throw new Error('对话框未渲染');
    }
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    // 无障碍名称必须指向文档中真实存在的标题节点，而不是空引用。
    const title = document.querySelector(`[id="${String(labelledBy)}"]`);
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe('');
  });
});
