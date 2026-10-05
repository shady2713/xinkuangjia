/**
 * 帮助入口（effects/layouts 的 widgets/help/help.vue）快捷键与弹窗契约真实回归。
 *
 * 该入口用 Alt+H 组合键打开内置帮助弹窗，并把弹窗配置（可拖拽、遮罩模糊、无底部按钮、取消即关闭）
 * 交给真实 useVbenModal 创建的弹窗：快捷键未注册会让用户按不出帮助；取消回调失效会让取消操作
 * 关不掉弹窗；配置写错会让弹窗丢失拖拽能力或出现多余按钮。用例装载真实中文语言包，按真实键盘
 * 事件触发快捷键，读取传送到 body 的真实弹窗节点，并用弹窗自己的命令式 API 驱动真实取消入口。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { createApp, h } from 'vue';

import { setupI18n } from '@vben/locales';

import { VbenModal } from '@vben-core/popup-ui';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import Help from './help.vue';

/** 被测弹窗对外暴露的命令式 API 片段：用例只驱动真实取消入口并读取真实开关状态。 */
interface HelpModalApi {
  /** 取消操作：弹窗自行声明的 onCancel 回调由此触发。 */
  onCancel: () => void;
  /** 弹窗状态存储，用于核对真实开关状态。 */
  store: { state: { isOpen: boolean } };
}

/** 本文件已挂载的宿主包装器，用例结束后统一卸载以清理快捷键监听与传送节点。 */
const mountedWrappers: VueWrapper[] = [];

/**
 * 建立仅用于安装 i18n 插件的空应用宿主。
 * @returns 未挂载的空 Vue 应用实例。
 */
function createAppHost() {
  return createApp({
    /** 渲染空节点：该宿主只用于安装 i18n 插件，不参与界面断言。 */
    render: () => h('div'),
  });
}

/**
 * 读取被测入口交给真实弹窗的命令式 API。
 * @param wrapper 已挂载的帮助入口包装器。
 * @returns 弹窗 API，用于驱动真实取消入口。
 * @throws Error 组件未渲染出弹窗或未交出 API 时抛出，避免用例静默地不驱动真实弹窗。
 */
function readModalApi(wrapper: VueWrapper) {
  const api = wrapper.findComponent(VbenModal).props('modalApi') as
    | HelpModalApi
    | undefined;
  if (!api) {
    throw new Error('帮助入口未渲染出弹窗 API');
  }
  return api;
}

/**
 * 按真实键盘事件触发 Alt+H 帮助快捷键。
 */
function pressHelpShortcut() {
  // 真实浏览器会先送出修饰键再送出字母键，组合键因此需要两次按下事件。
  window.dispatchEvent(
    new KeyboardEvent('keydown', { altKey: true, code: 'AltLeft', key: 'Alt' }),
  );
  window.dispatchEvent(
    new KeyboardEvent('keydown', { altKey: true, code: 'KeyH', key: 'h' }),
  );
}

/**
 * 挂载帮助入口并记录宿主。
 * @returns 已挂载的组件包装器。
 */
function mountHelp() {
  const wrapper = mount(Help);
  mountedWrappers.push(wrapper);
  return wrapper;
}

beforeAll(
  /** 按真实 API 装载中文语言包，弹窗标题依赖真实翻译。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

afterEach(
  /** 卸载入口、清空传送节点，避免快捷键监听与残留弹窗影响后续用例。 */ () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    document.body.innerHTML = '';
  },
);

describe('帮助弹窗初始状态', /** 未触发快捷键就渲染内容会让帮助弹窗在页面加载时闪现。 */ () => {
  it('未按快捷键时保持关闭且不渲染帮助内容', /** 初始状态写错会让弹窗抢先出现在界面上。 */ () => {
    const wrapper = mountHelp();

    expect(readModalApi(wrapper).store.state.isOpen).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain('快捷说明');
  });
});

describe('快捷键打开帮助弹窗', /** 快捷键注册失败会让用户完全打不开帮助。 */ () => {
  it('按键后打开真实弹窗并渲染标题、内容与入口配置', /** 弹窗配置丢失会让帮助窗口缺少拖拽能力或出现多余按钮。 */ async () => {
    const wrapper = mountHelp();

    pressHelpShortcut();

    await vi.waitFor(
      /** 等待真实弹窗打开并渲染到传送节点。 */ () => {
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('问题 & 帮助');
    expect(dialog?.textContent).toContain('快捷说明');
    expect(dialog?.textContent).toContain('Alt + H');
    expect(dialog?.textContent).toContain('项目支持');
    // 入口声明的宽度类必须落到真实弹窗节点上。
    expect(dialog?.className).toContain('w-1/3');
    // footer: false 的弹窗不渲染底部取消与确认按钮。
    expect(dialog?.textContent).not.toContain('取消');
    expect(readModalApi(wrapper).store.state.isOpen).toBe(true);
  });
});

describe('帮助弹窗取消入口', /** 取消回调失效会让用户取消后弹窗仍留在界面上。 */ () => {
  it('取消回调关闭真实弹窗并移除内容', /** 回调未接线或未关闭会让帮助窗口关不掉。 */ async () => {
    const wrapper = mountHelp();
    pressHelpShortcut();
    await vi.waitFor(
      /** 等待真实弹窗打开后再驱动取消入口。 */ () => {
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );

    const api = readModalApi(wrapper);
    // 帮助弹窗关闭了底部按钮，取消只能由弹窗 API 触发，这里驱动组件自己注册的真实回调。
    api.onCancel();

    await vi.waitFor(
      /** 等待真实状态关闭且内容从传送节点移除。 */ () => {
        expect(api.store.state.isOpen).toBe(false);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      },
      { timeout: 2000 },
    );
  });
});
