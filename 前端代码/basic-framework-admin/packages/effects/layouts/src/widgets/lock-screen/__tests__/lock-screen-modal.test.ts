/**
 * 锁屏解锁弹窗（widgets/lock-screen/lock-screen-modal.vue）真实提交链路回归。
 *
 * 该弹窗是解锁动作的唯一输入入口，它只收集密码并上抛，由外层容器完成真正的校验：
 * 校验不通过时若仍然下发，空密码会被送到鉴权接口；校验通过时若丢掉输入值，
 * 用户输入正确密码也解不开锁屏；弹窗每次打开若不清空上一次的输入，密码会残留在界面上；
 * 打开动画结束后若不聚焦密码框，键盘用户必须手动点击输入框。
 * 用例按真实消费方式（user-dropdown 的 connectedComponent 连接写法）挂载真实弹窗与真实
 * 弹窗 API，只替换外部边界：国际化语言包。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { ExtendedModalApi } from '@vben-core/popup-ui';

import process from 'node:process';

import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { useVbenModal } from '@vben-core/popup-ui';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LockScreenModal from '../lock-screen-modal.vue';

/** 解锁按钮与占位文案的键名；语言包被固定为返回键名，断言只依赖键名。 */
const SUBMIT_TEXT = 'ui.widgets.lockScreen.screenButton';
const PASSWORD_PLACEHOLDER = 'ui.widgets.lockScreen.placeholder';

vi.mock(
  '@vben/locales',
  /** 语言包是外部边界：固定返回键名，避免用例依赖真实翻译内容。 */ () => ({
    /**
     * 返回文案键本身。
     * @param key 组件请求的文案键。
     * @returns 原样返回的文案键。
     */
    $t: (key: string) => key,
  }),
);

/** 真实弹窗 API；由宿主组件在建立连接时写入，用例通过它驱动弹窗生命周期。 */
let modalApi: ExtendedModalApi | undefined;

/** 内层弹窗向外抛出的解锁密码，用例按提交顺序断言。 */
const submitted: string[] = [];

/** 当前用例挂载的宿主；用例结束统一卸载，避免残留弹窗实例影响后续用例。 */
let wrapper: undefined | VueWrapper;

/**
 * 锁屏弹窗外层宿主：与 user-dropdown 一致，用 connectedComponent 连接内层弹窗。
 * 这样内层弹窗的开关、确认与打开完成回调都走真实 provide/inject 合并逻辑。
 */
const LockScreenModalHost = defineComponent({
  name: 'LockScreenModalHost',
  props: {
    /** 关闭弹窗时是否销毁内容；保留内容才能在同一实例上核对再次打开的重置行为。 */
    destroyOnClose: { default: true, type: Boolean },
  },
  /**
   * 建立真实连接式弹窗并记录 API。
   * @param props 宿主声明的属性，用于决定关闭时是否销毁弹窗内容。
   * @param context 组件上下文。
   * @param context.attrs 调用方透传的属性，包含 submit 监听。
   * @returns 渲染连接式弹窗的渲染函数。
   */
  setup(props, { attrs }) {
    const [Modal, api] = useVbenModal({
      connectedComponent: LockScreenModal,
      destroyOnClose: props.destroyOnClose,
    });
    modalApi = api;
    /**
     * 收窄后的连接式弹窗属性：宿主 attrs 是 Vue 运行时的 Record<string, unknown>，无法匹配 h()
     * 对组件属性的重载；连接式弹窗真正读取的只有 submit 监听，按该监听收窄后再整体透传，运行时行为不变。
     */
    const modalProps = attrs as {
      /** 内层弹窗抛出的解锁密码监听。 */
      onSubmit?: (value: string) => void;
    };
    return /** 渲染真实连接式弹窗并透传 submit 监听。 */ () =>
      h(Modal, modalProps);
  },
});

/**
 * 挂载锁屏弹窗外层宿主并登记，供用例结束统一卸载。
 * @param options 宿主挂载选项：submit 监听与关闭时是否销毁弹窗内容。
 * @param options.attrs 调用方透传的属性，包含 submit 监听。
 * @param options.props 宿主属性，用于决定关闭时是否销毁弹窗内容。
 * @returns 已挂载的宿主组件包装器。
 */
function mountHost(options: {
  attrs: {
    /** 内层弹窗抛出的解锁密码监听。 */
    onSubmit: (value: string) => void;
  };
  /** 关闭弹窗时是否销毁内容。 */
  props?: { destroyOnClose: boolean };
}) {
  wrapper = mount(LockScreenModalHost, options);
  return wrapper;
}

/**
 * 取出真实弹窗 API。
 * @returns 宿主挂载后写入的真实弹窗 API。
 */
function requireModalApi() {
  if (!modalApi) {
    throw new Error('弹窗 API 尚未初始化');
  }
  return modalApi;
}

/**
 * 在当前文档里按选择器取元素：弹窗内容被传送到 body，组件包装器查不到。
 * @param selector 目标元素的选择器。
 * @returns 包住真实 DOM 元素的测试包装器。
 */
function bodyElement(selector: string) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`未找到弹窗内元素：${selector}`);
  }
  return new DOMWrapper(element);
}

/**
 * 取弹窗内当前挂载的密码输入框。
 * @returns 密码输入框的测试包装器。
 */
function passwordInput() {
  return bodyElement('input[name="lockScreenPassword"]');
}

/**
 * 在密码输入框中录入指定密码。
 * @param password 要录入的密码明文。
 */
async function typePassword(password: string) {
  await passwordInput().setValue(password);
  await flushPromises();
}

/**
 * 点击弹窗内的解锁按钮。
 */
async function clickUnlock() {
  const button = [...document.querySelectorAll('button')].find(
    /** 只点击解锁按钮，避免误点到标题栏等相邻操作。 */ (item) =>
      item.textContent?.trim() === SUBMIT_TEXT,
  );
  if (!button) {
    throw new Error('未找到解锁按钮');
  }
  await new DOMWrapper(button).trigger('click');
  await flushPromises();
}

/**
 * 打开弹窗并等待内容渲染完成。
 */
async function openModal() {
  requireModalApi().open();
  await nextTick();
  await flushPromises();
}

beforeEach(
  /** 清空提交记录与弹窗 API，避免用例之间互相影响。 */ () => {
    submitted.length = 0;
    modalApi = undefined;
  },
);

afterEach(
  /** 卸载宿主并清理被传送到 body 的弹窗节点，避免残留实例影响后续用例。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = '';
  },
);

describe('锁屏解锁弹窗', /** 密码提交链路直接决定用户能否解锁，任何分支错误都会锁死入口。 */ () => {
  it('输入正确密码后点击解锁按钮会把密码抛给外层', /** 丢掉输入值会让用户输入正确密码也无法解锁。 */ async () => {
    mountHost({
      attrs: {
        /** 记录内层弹窗抛出的解锁密码。 */
        onSubmit: (value: string) => submitted.push(value),
      },
    });
    await openModal();

    await typePassword('DUMMY-锁屏密码');
    await clickUnlock();

    expect(submitted).toEqual(['DUMMY-锁屏密码']);
  });

  it('密码为空时校验失败，既不下发也把错误渲染给用户', /** 空密码下发会把无效请求送到鉴权接口，用户也看不到失败原因。 */ async () => {
    mountHost({
      attrs: {
        /** 记录内层弹窗抛出的解锁密码。 */
        onSubmit: (value: string) => submitted.push(value),
      },
    });
    await openModal();

    await clickUnlock();

    expect(submitted).toEqual([]);
    // 校验规则用的就是占位文案键，错误提示必须真实渲染在弹窗里。
    expect(document.body.textContent).toContain(PASSWORD_PLACEHOLDER);
  });

  it('在弹窗上按回车走同一条提交链路', /** 回车是最常用的提交方式，漏接会让键盘用户无法解锁。 */ async () => {
    mountHost({
      attrs: {
        /** 记录内层弹窗抛出的解锁密码。 */
        onSubmit: (value: string) => submitted.push(value),
      },
    });
    await openModal();

    await typePassword('DUMMY-回车密码');
    const container = document.querySelector(
      '.mb-10.flex.w-full.flex-col.items-center',
    );
    if (!container) {
      throw new Error('未找到弹窗内容容器');
    }
    await new DOMWrapper(container).trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(submitted).toEqual(['DUMMY-回车密码']);
  });

  it('弹窗确认动作复用同一条提交链路', /** 确认回调接错会让带页脚的弹窗确认按钮失去作用。 */ async () => {
    mountHost({
      attrs: {
        /** 记录内层弹窗抛出的解锁密码。 */
        onSubmit: (value: string) => submitted.push(value),
      },
    });
    await openModal();

    await typePassword('DUMMY-确认密码');
    requireModalApi().onConfirm();
    await flushPromises();

    expect(submitted).toEqual(['DUMMY-确认密码']);
  });

  it('重新打开弹窗会清空上一次的输入', /** 密码残留会让用户误以为输入框已清空，重复输入变成错误密码。 */ async () => {
    mountHost({
      props: {
        // 保留弹窗内容，使表单实例跨关闭/打开保持同一份，重置行为才能在同一个输入框上核对。
        destroyOnClose: false,
      },
      attrs: {
        /** 记录内层弹窗抛出的解锁密码。 */
        onSubmit: (value: string) => submitted.push(value),
      },
    });
    await openModal();

    await typePassword('DUMMY-旧密码');
    expect((passwordInput().element as HTMLInputElement).value).toBe(
      'DUMMY-旧密码',
    );

    requireModalApi().close();
    await nextTick();
    await flushPromises();
    await openModal();

    expect((passwordInput().element as HTMLInputElement).value).toBe('');
  });

  it('默认关闭即销毁时重新打开不会产生未处理的表单重置拒绝', /** 重新打开时表单还没重建就先重置，会把「表单已卸载」变成未处理拒绝。 */ async () => {
    /** 本用例捕获到的未处理拒绝原因。 */
    const rejections: unknown[] = [];
    /** 记录未处理拒绝的原因，供用例判定。 */
    const onUnhandledRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    /** 重置链路的错误日志：既不能有未处理拒绝，也不能靠兜底日志掩盖重置失败。 */
    const consoleError = vi.spyOn(console, 'error');
    consoleError.mockImplementation(
      /** 拦截错误日志，避免污染用例输出。 */ () => {},
    );

    try {
      // 不传 destroyOnClose：走默认值（弹窗关闭即销毁内容并在下次打开时重建）。
      mountHost({
        attrs: {
          /** 记录内层弹窗抛出的解锁密码。 */
          onSubmit: (value: string) => submitted.push(value),
        },
      });
      await openModal();
      // 先在重建前的实例上留下校验错误，重新打开时重置必须真实执行。
      await clickUnlock();
      expect(document.body.textContent).toContain(PASSWORD_PLACEHOLDER);

      requireModalApi().close();
      await nextTick();
      await flushPromises();

      // 重新打开：内容被销毁后重建，表单在打开回调触发时尚未挂载。
      await openModal();
      // 未处理拒绝要等微任务队列清空后才由运行环境判定，这里推进一个宏任务。
      await new Promise(
        /** 让出一个宏任务，使未处理拒绝有机会被上报。 */ (resolve) => {
          setTimeout(resolve, 0);
        },
      );

      expect(rejections).toEqual([]);
      // 重置真实完成：没有走到「重置失败」的兜底日志（校验失败等其它日志与本断言无关）。
      const resetFailureLogged = consoleError.mock.calls.some(
        /** 只匹配重置链路的兜底日志。 */ (call) =>
          String(call[0]).includes('Failed to reset lock screen form'),
      );
      expect(resetFailureLogged).toBe(false);
      // 重建后的表单仍然是干净的：上一次的校验错误随重置一起清空。
      expect(document.body.textContent).not.toContain(PASSWORD_PLACEHOLDER);

      // 重建后的表单仍然可用：重新输入并解锁仍然走同一条链路。
      await typePassword('DUMMY-新密码');
      await clickUnlock();
      expect(submitted).toEqual(['DUMMY-新密码']);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      consoleError.mockRestore();
    }
  });

  it('打开后立即关闭导致表单在重置前销毁时只记录日志', /** 这条竞态的拒绝若没有接收方，会变成未处理拒绝上抛到运行环境。 */ async () => {
    /** 本用例捕获到的未处理拒绝原因。 */
    const rejections: unknown[] = [];
    /** 记录未处理拒绝的原因，供用例判定。 */
    const onUnhandledRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const consoleError = vi.spyOn(console, 'error');
    consoleError.mockImplementation(
      /** 拦截错误日志，避免污染用例输出。 */ () => {},
    );

    try {
      mountHost({
        attrs: {
          /** 记录内层弹窗抛出的解锁密码。 */
          onSubmit: (value: string) => submitted.push(value),
        },
      });

      // 同一个 tick 内打开又关闭：表单挂载后立刻被销毁，等待挂载的重置链路
      // 在真正重置前发现挂载代次已变化（内部抛出的原因是「表单挂载已失效」）。
      requireModalApi().open();
      requireModalApi().close();
      await nextTick();
      await flushPromises();
      // 未处理拒绝要等微任务队列清空后才由运行环境判定，这里推进一个宏任务。
      await new Promise(
        /** 让出一个宏任务，使未处理拒绝有机会被上报。 */ (resolve) => {
          setTimeout(resolve, 0);
        },
      );

      // 重置失败必须留下可定位的日志，且不能中断弹窗自身的开合流程。
      const failureLog = consoleError.mock.calls.find(
        /** 只匹配重置链路的兜底日志。 */ (call) =>
          String(call[0]).includes('Failed to reset lock screen form'),
      );
      expect(failureLog).toBeDefined();
      expect((failureLog?.[1] as Error).message).toBe('表单挂载已失效');
      // 关键契约：拒绝被真实接收，不会变成未处理拒绝。
      expect(rejections).toEqual([]);
      // 开合流程没有被中断：弹窗已关闭，也没有把任何密码下发出去。
      // 关闭结果读公开的 store.state（ModalApi 的 state 是私有副本，store 才是对外可读的状态源）。
      expect(requireModalApi().store.state.isOpen).toBe(false);
      expect(submitted).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      consoleError.mockRestore();
    }
  });

  it('打开动画结束后聚焦密码输入框', /** 打开完成回调漏接会让用户每次都要手动点击输入框。 */ async () => {
    mountHost({
      attrs: {
        /** 记录内层弹窗抛出的解锁密码。 */
        onSubmit: (value: string) => submitted.push(value),
      },
    });
    await openModal();

    requireModalApi().onOpened();

    await vi.waitFor(
      /** 聚焦发生在下一帧，等待真实动画帧回调执行完成。 */ () => {
        expect(document.activeElement).toBe(passwordInput().element);
      },
    );
  });
});
