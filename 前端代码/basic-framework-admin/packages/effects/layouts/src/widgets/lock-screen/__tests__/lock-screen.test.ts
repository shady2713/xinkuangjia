/**
 * 锁屏解锁环节的真实消费链路回归测试。
 *
 * 测试挂载真实组件与真实 `useVbenForm`（不替换表单实现），只替换与浏览器环境相关的
 * 图标、国际化与访问状态，用来锁定两条已确认缺陷：
 * 1. setup 期解构出的 `form` 引用必须在表单挂载后仍可读取到真实上下文，
 *    否则设置非空锁屏密码后，输入正确密码也无法解锁；
 * 2. 密码错误时必须把错误写到 password 字段上并渲染出来，不能被 optional chaining 静默吞掉。
 */
import type { Mock } from 'vitest';

import type { VueWrapper } from '@vue/test-utils';
import type { Ref } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LockScreen from '../lock-screen.vue';

/**
 * 锁屏密码错误提示的断言文本。
 * `$t` 在测试中被替换为返回键名，因此这里直接比较键名，避免依赖真实语言包。
 */
const PASSWORD_ERROR_TIP = 'authentication.passwordErrorTip';

vi.mock(
  '@vben/icons',
  /** 图标与解锁流程无关，替换成可点击的最小元素。 */ () => ({
    LockKeyhole: {
      name: 'LockKeyhole',
      template: '<i data-test="lock-keyhole"></i>',
    },
  }),
);

vi.mock(
  '@vben/locales',
  /**
   * 国际化在测试中只承担“稳定文案”的作用：`$t` 返回键名，
   * `useI18n` 提供固定语言标识，避免加载真实语言包。
   */
  async () => {
    const { ref } = await import('vue');
    return {
      /** 返回键名本身，使断言可以按键名定位页面文案。 */
      $t: (key: string) => key,
      /** 固定语言标识，供时间格式化读取。 */
      useI18n: () => ({ locale: ref('zh-CN') }),
    };
  },
);

vi.mock(
  '@vben/stores',
  /**
   * 只替换访问状态，保留 pinia 真实的 `storeToRefs` 解引用行为：
   * 组件必须通过真实 `storeToRefs` 拿到锁屏密码引用，测试则直接写入该引用。
   */
  async (importOriginal) => {
    const { ref } = await import('vue');
    const actual = await importOriginal<typeof import('@vben/stores')>();
    /** 当前生效的锁屏密码；空字符串表示未设置锁屏密码。 */
    const lockScreenPassword = ref<string>('');
    /** 解锁动作记录：只有真正解锁时才会被调用。 */
    const unlockScreen = vi.fn();
    return {
      ...actual,
      lockScreenPassword,
      unlockScreen,
      /** 返回带锁屏状态的访问状态替身，其余状态不参与本组用例。 */
      useAccessStore: () => ({ lockScreenPassword, unlockScreen }),
    };
  },
);

/**
 * 被替换后的 stores 契约：`vi.mock` 在真实模块之上补充锁屏密码引用与解锁记录，
 * 因此这里按替身契约收窄动态导入，不改变组件侧的真实导入。
 */
interface MockedStores {
  /** 当前锁屏密码引用，用例直接写入以驱动组件。 */
  lockScreenPassword: Ref<string>;
  /** 解锁动作替身，用于断言真实解锁次数。 */
  unlockScreen: Mock;
}

/** 取出被替换后的锁屏密码引用与解锁记录，供用例驱动与断言。 */
const { lockScreenPassword, unlockScreen } =
  (await import('@vben/stores')) as unknown as MockedStores;

/** 当前用例挂载的锁屏组件；用例结束统一卸载，避免残留组件影响后续用例。 */
let wrapper: undefined | VueWrapper;

beforeEach(
  /** 每个用例前清空解锁记录与密码，避免状态跨用例串味。 */
  () => {
    unlockScreen.mockClear();
    lockScreenPassword.value = '';
  },
);

afterEach(
  /** 卸载组件并清理文档，确保用例之间没有残留实例与节点。 */
  () => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 挂载锁屏组件并登记到用例级变量，供 afterEach 统一卸载。
 * @returns 已挂载的锁屏组件包装器。
 */
function mountLockScreen() {
  const mounted = mount(LockScreen);
  wrapper = mounted;
  return mounted;
}

/**
 * 展开解锁表单并等待真实表单组件挂载完成。
 * @param target 已挂载的锁屏组件。
 */
async function openUnlockForm(target: VueWrapper) {
  await target.get('[data-test="lock-keyhole"]').trigger('click');
  await flushPromises();
}

/**
 * 在密码输入框中录入指定密码。
 * @param target 已挂载的锁屏组件。
 * @param password 要录入的密码明文。
 */
async function typePassword(target: VueWrapper, password: string) {
  const input = target.get('input[name="password"]');
  await input.setValue(password);
  await flushPromises();
}

/**
 * 按渲染文案点击按钮；文案在测试中被替换为键名，因此按键名精确定位。
 * @param target 已挂载的锁屏组件。
 * @param text 目标按钮的文案键名。
 */
async function clickButtonByText(target: VueWrapper, text: string) {
  const button = target
    .findAll('button')
    .find(
      /** 只匹配文案完全一致的按钮，避免点到相邻操作。 */ (item) =>
        item.text() === text,
    );
  expect(button).toBeDefined();
  await button?.trigger('click');
  await flushPromises();
}

/**
 * 点击解锁按钮并等待提交链路结算。
 * @param target 已挂载的锁屏组件。
 */
async function clickUnlock(target: VueWrapper) {
  await clickButtonByText(target, 'ui.widgets.lockScreen.entry');
}

describe('锁屏解锁', /** 锁屏表单与真实 FormApi 的交互结果。 */ () => {
  it('设置非空锁屏密码后，输入正确密码必须真正解锁（缺陷回归）', /** 挂载后解构持有的 `form` 引用仍要能读到当前密码，正确密码必须触发解锁。 */ async () => {
    lockScreenPassword.value = 'DUMMY-s3cret';
    const screen = mountLockScreen();

    await openUnlockForm(screen);
    await typePassword(screen, 'DUMMY-s3cret');
    await clickUnlock(screen);

    expect(unlockScreen).toHaveBeenCalledTimes(1);
  });

  it('密码错误时必须把错误写到 password 字段上（缺陷回归）', /** 错误提示必须落到字段上并渲染给用户，不能被 optional chaining 静默吞掉。 */ async () => {
    lockScreenPassword.value = 'DUMMY-s3cret';
    const screen = mountLockScreen();

    await openUnlockForm(screen);
    await typePassword(screen, 'wrong-password');
    await clickUnlock(screen);

    expect(unlockScreen).not.toHaveBeenCalled();
    expect(screen.text()).toContain(PASSWORD_ERROR_TIP);
  });

  it('收起再展开解锁表单后，正确密码仍然可以解锁', /** 解锁表单销毁重建会重建表单实例，解构持有的引用必须在重新挂载后再次可用。 */ async () => {
    lockScreenPassword.value = 'DUMMY-s3cret';
    const screen = mountLockScreen();

    await openUnlockForm(screen);
    // 触发“返回”按钮收起表单，销毁当前表单实例。
    await clickButtonByText(screen, 'common.back');

    await openUnlockForm(screen);
    await typePassword(screen, 'DUMMY-s3cret');
    await clickUnlock(screen);

    expect(unlockScreen).toHaveBeenCalledTimes(1);
  });

  it('点击返回登录按钮时向外抛出 toLogin 事件', /** 返回登录属于锁屏对外的导航契约，必须由组件抛出事件交给外层决定去向。 */ async () => {
    const screen = mountLockScreen();

    await openUnlockForm(screen);
    await clickButtonByText(screen, 'ui.widgets.lockScreen.backToLogin');

    expect(screen.emitted('toLogin')).toHaveLength(1);
  });
});
