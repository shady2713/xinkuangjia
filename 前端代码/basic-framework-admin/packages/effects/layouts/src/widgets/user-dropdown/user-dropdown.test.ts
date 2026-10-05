/**
 * 用户下拉（effects/layouts 的 widgets/user-dropdown/user-dropdown.vue）真实交互回归。
 *
 * 该组件是全局唯一的用户级操作入口：头像菜单要真实展开并执行调用方传入的菜单处理器，锁屏入口要
 * 打开真实锁屏弹窗并把密码交给访问状态，退出登录要走「确认弹窗 → 抛出 logout」的完整链路，
 * Alt+L / Alt+Q 快捷键必须与开关和偏好保持一致，hover 触发方式要真的靠鼠标移入展开。菜单处理器
 * 不执行会让「个人中心」点不动；退出事件断链会让用户退不出去；锁屏密码没交出去会让用户按了锁屏
 * 却没锁上。用例挂载真实组件、真实点击菜单项与弹窗按钮、真实按键，断言真实 DOM、真实事件载荷、
 * 真实锁屏调用记录与真实偏好开关。
 */
import type { VueWrapper } from '@vue/test-utils';

import { DOMWrapper, mount } from '@vue/test-utils';
import { createApp, h, nextTick } from 'vue';

import { $t, setupI18n } from '@vben/locales';
import {
  preferences,
  resetPreferences,
  updatePreferences,
} from '@vben/preferences';
import { isWindowsOs } from '@vben/utils';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import UserDropdown from './user-dropdown.vue';

/** 访问状态替身的调用记录：只记录组件真实交出的锁屏密码。 */
const accessState = vi.hoisted(
  /** 建立用例可读取的锁屏调用记录。 */ () => ({
    lockScreenCalls: [] as string[],
  }),
);

vi.mock(
  '@vben/stores',
  /**
   * effects/layouts 没有声明 pinia 依赖，测试里无法建立真实 Pinia 实例；
   * 这里保留 stores 的其余真实导出，只把访问状态换成可观察替身，
   * 组件调用 lockScreen 的分支与参数仍然真实执行并被记录。
   */ async (importOriginal) => {
    const actual = await importOriginal<typeof import('@vben/stores')>();
    return {
      ...actual,
      /** 返回只记录锁屏调用的访问状态替身。 */
      useAccessStore: () => ({
        /**
         * 记录组件交出的锁屏密码。
         * @param password 组件真实提交的锁屏密码。
         */
        lockScreen(password: string) {
          accessState.lockScreenCalls.push(password);
        },
      }),
    };
  },
);

vi.mock(
  '@vben/icons',
  /**
   * 图标来自远程 Iconify，属于外部渲染边界；替换为带名称标识的最小元素，
   * 避免测试联网取图标，同时不影响组件自身的分支与事件。
   */ () => {
    /**
     * 生成带名称标识的图标替身组件。
     * @param name 图标名，同时作为 DOM 上的 data-icon 标识。
     * @returns 渲染为 i 元素的图标替身组件。
     */
    function createIconStub(name: string) {
      return { name, template: `<i data-icon="${name}"></i>` };
    }
    return {
      LockKeyhole: createIconStub('LockKeyhole'),
      LogOut: createIconStub('LogOut'),
    };
  },
);

/** 菜单项契约：文案与点击处理器。 */
interface MenuStub {
  /** 点击菜单项时执行的处理器。 */
  handler: () => void;
  /** 菜单项文案。 */
  text: string;
}

/** 每个用例挂载的用户下拉；用例结束统一卸载并清理传送节点。 */
let mounted: undefined | VueWrapper;

/**
 * 建立仅用于安装 i18n 插件的空应用宿主。
 * @returns 未挂载的空 Vue 应用实例。
 */
function createAppHost() {
  return createApp({
    /** 渲染空节点：宿主只用于安装 i18n 插件，不参与界面断言。 */
    render: () => h('div'),
  });
}

beforeAll(
  /** 装载真实中文语言包：否则 $t 返回空串，所有文案断言都会形同虚设。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

beforeEach(
  /** 为每个用例清空锁屏调用记录并还原默认偏好。 */ () => {
    accessState.lockScreenCalls.length = 0;
    resetPreferences();
  },
);

afterEach(
  /** 卸载宿主、清理传送节点并还原被用例改动的偏好。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    resetPreferences();
    vi.restoreAllMocks();
  },
);

/**
 * 构造菜单项替身。
 * @param text 菜单项文案。
 * @returns 带可断言处理器的菜单项。
 */
function createMenu(text: string): MenuStub {
  return { handler: vi.fn(), text };
}

/**
 * 挂载用户下拉。
 * @param props 传给组件的属性，未传字段取组件默认值。
 * @param slots 传给组件的插槽。
 * @returns 已挂载的用户下拉宿主。
 */
function mountDropdown(
  props: Record<string, unknown> = {},
  slots?: Record<string, string>,
) {
  mounted = mount(UserDropdown, {
    props: {
      avatar: 'DUMMY-avatar.png',
      description: 'DUMMY-描述',
      text: 'DUMMY-用户名',
      ...props,
    },
    slots,
  });
  return mounted;
}

/**
 * 读取下拉触发件上的真实开合状态。
 * @param wrapper 已挂载的用户下拉宿主。
 * @returns 触发件的 data-state 值。
 */
function readMenuState(wrapper: VueWrapper) {
  return wrapper.get('button[data-state]').attributes('data-state');
}

/**
 * 用真实指针与键盘事件展开下拉菜单。
 * @param wrapper 已挂载的用户下拉宿主。
 */
async function openMenu(wrapper: VueWrapper) {
  const trigger = wrapper.get('button[data-state]');
  await trigger.trigger('pointerdown', { button: 0 });
  await trigger.trigger('click');
  await trigger.trigger('keydown', { key: 'ArrowDown' });
  await new Promise(
    /** 等待传送后的菜单内容真实渲染。 */ (resolve) => {
      setTimeout(resolve, 0);
    },
  );
}

/**
 * 取出传送后真实渲染的菜单项。
 * @returns 菜单项元素数组。
 */
function findMenuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

/**
 * 按文案定位菜单项。
 * @param text 目标菜单项文案。
 * @returns 命中的菜单项，未找到时为 undefined。
 */
function findMenuItem(text: string) {
  return findMenuItems().find(
    /** 菜单项可能带快捷键后缀，因此按文案前缀匹配。 */ (item) =>
      item.textContent?.trim().startsWith(text),
  );
}

/**
 * 按真实文案在传送后的弹窗 DOM 中查找按钮。
 * @param text 目标按钮的文案。
 * @returns 命中的按钮元素，未找到时为 undefined。
 */
function findButtonByText(text: string) {
  return [...document.querySelectorAll('button')].find(
    /** 只保留文案与目标一致的按钮，避免点到相邻的操作。 */ (button) =>
      button.textContent?.trim() === text,
  );
}

/**
 * 读取真实渲染的锁屏密码输入框。
 * @returns 输入框元素，锁屏弹窗未打开时为 null。
 */
function findLockScreenInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    'input[name="lockScreenPassword"]',
  );
}

/**
 * 真实按下并抬起 Alt 组合键（浏览器会先单独派发 Alt 键自身的按下事件）。
 * @param key 组合键里的字母键，与 event.key 一致。
 * @param code 组合键里的物理键码，与 event.code 一致。
 */
async function pressAltKey(key: string, code: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }));
  window.dispatchEvent(
    new KeyboardEvent('keydown', { altKey: true, code, key }),
  );
  await nextTick();
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
  await nextTick();
}

/**
 * 在触发件上派发一次真实的鼠标移入事件。
 * hover 模式下触发件带 disabled（禁止点击），而 @vue/test-utils 的 trigger 会直接跳过 disabled
 * 元素；真实浏览器里悬停禁用按钮同样会派发 mouseenter，因此这里直接派发原生鼠标事件。
 * @param wrapper 已挂载的用户下拉宿主。
 */
async function hoverTrigger(wrapper: VueWrapper) {
  // 悬停监听挂载在渲染后的刷新队列里，先等挂载与刷新结算完再派发。
  await nextTick();
  await nextTick();
  wrapper
    .get('button[data-state]')
    .element.dispatchEvent(new MouseEvent('mouseenter'));
  await nextTick();
}

/** 快捷键提示里的 Alt 展示文案，与组件里的平台判断保持一致。 */
const ALT_SYMBOL = isWindowsOs() ? 'Alt' : '⌥';

describe('用户下拉渲染', /** 头像、用户信息与菜单项是用户找到自己操作的唯一入口。 */ () => {
  it('渲染头像与用户信息且初始不展开菜单', /** 首屏自动展开会遮挡页面内容。 */ () => {
    const wrapper = mountDropdown();

    expect(wrapper.get('button[data-state]').attributes('data-state')).toBe(
      'closed',
    );
    expect(wrapper.get('button[data-state] img').attributes('src')).toBe(
      'DUMMY-avatar.png',
    );
    expect(findMenuItems()).toHaveLength(0);
  });

  it('展开后渲染菜单项、锁屏项、退出项与分隔线', /** 菜单项漏渲染会让用户找不到锁屏与退出入口。 */ async () => {
    const profile = createMenu('DUMMY-个人中心');
    const setting = createMenu('DUMMY-设置');
    const wrapper = mountDropdown({ menus: [profile, setting] });

    await openMenu(wrapper);

    expect(readMenuState(wrapper)).toBe('open');
    expect(document.body.textContent).toContain('DUMMY-用户名');
    expect(document.body.textContent).toContain('DUMMY-描述');
    expect(document.body.textContent).toContain('DUMMY-个人中心');
    expect(document.body.textContent).toContain('DUMMY-设置');
    expect(document.body.textContent).toContain(
      $t('ui.widgets.lockScreen.title'),
    );
    expect(document.body.textContent).toContain($t('common.logout'));
    expect(findMenuItems()).toHaveLength(4);
    // 自定义菜单前一条、锁屏前一条、锁屏后一条。
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(3);
  });

  it('未配置菜单时不渲染自定义菜单项与菜单分隔线', /** 空菜单仍渲染分隔线会让菜单出现多余横线。 */ async () => {
    const wrapper = mountDropdown();

    await openMenu(wrapper);

    expect(findMenuItems()).toHaveLength(2);
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(2);
  });

  it('tagText 渲染为标签，插槽存在时由插槽内容接管', /** 标签被插槽挤掉会让业务无法自定义身份标识。 */ async () => {
    const withTag = mountDropdown({ tagText: 'DUMMY-标签' });
    await openMenu(withTag);
    expect(document.body.textContent).toContain('DUMMY-标签');
    withTag.unmount();

    const withSlot = mountDropdown(
      { tagText: 'DUMMY-标签' },
      { tagText: '<span data-test="tag-slot">DUMMY-插槽标签</span>' },
    );
    await openMenu(withSlot);
    expect(document.body.textContent).toContain('DUMMY-插槽标签');
    expect(document.body.textContent).not.toContain('DUMMY-标签');
  });

  it('未配置标题文案与标签插槽时不渲染标题行', /** 空标题行会多出一段没有内容的留白。 */ async () => {
    const wrapper = mountDropdown({ tagText: '', text: '' });

    await openMenu(wrapper);

    expect(wrapper.find('div.text-foreground.mb-1').exists()).toBe(false);
    expect(document.body.textContent).toContain('DUMMY-描述');
  });

  it('关闭锁屏偏好后不渲染锁屏入口', /** 关掉锁屏仍显示入口会让用户点开一个不该出现的弹窗。 */ async () => {
    updatePreferences({ widget: { lockScreen: false } });
    const wrapper = mountDropdown();

    await openMenu(wrapper);

    expect(findMenuItem($t('ui.widgets.lockScreen.title'))).toBeUndefined();
    expect(findMenuItems()).toHaveLength(1);
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it('启用快捷键时在锁屏与退出项上渲染按键提示', /** 提示缺失会让用户不知道有快捷键可用。 */ async () => {
    const wrapper = mountDropdown();

    await openMenu(wrapper);

    expect(
      findMenuItem($t('ui.widgets.lockScreen.title'))?.textContent,
    ).toContain(`${ALT_SYMBOL} L`);
    expect(findMenuItem($t('common.logout'))?.textContent).toContain(
      `${ALT_SYMBOL} Q`,
    );
  });

  it('关闭快捷键开关后不渲染按键提示', /** 提示与真实能力不一致会误导用户去按无效组合键。 */ async () => {
    const wrapper = mountDropdown({ enableShortcutKey: false });

    await openMenu(wrapper);

    expect(
      findMenuItem($t('ui.widgets.lockScreen.title'))?.textContent,
    ).not.toContain(`${ALT_SYMBOL} L`);
    expect(findMenuItem($t('common.logout'))?.textContent).not.toContain(
      `${ALT_SYMBOL} Q`,
    );
  });
});

describe('用户下拉菜单交互', /** 菜单处理器与触发方式是用户能否完成操作的关键。 */ () => {
  it('点击菜单项执行真实处理器', /** 处理器不执行会让「个人中心」之类的入口点不动。 */ async () => {
    const profile = createMenu('DUMMY-个人中心');
    const wrapper = mountDropdown({ menus: [profile] });
    await openMenu(wrapper);

    const item = findMenuItem('DUMMY-个人中心');
    expect(item).toBeDefined();
    item?.click();
    await nextTick();

    expect(profile.handler).toHaveBeenCalledTimes(1);
  });

  it('trigger 为 hover 时鼠标移入真实展开菜单', /** 悬停不展开会让侧边栏用户以为入口坏了。 */ async () => {
    const wrapper = mountDropdown({ trigger: 'hover' });

    await hoverTrigger(wrapper);

    await vi.waitFor(
      /** 等待悬停状态真实驱动菜单展开。 */ () => {
        expect(findMenuItems().length).toBeGreaterThan(0);
      },
    );
    expect(readMenuState(wrapper)).toBe('open');
  });

  it('trigger 为 both 时同样支持鼠标移入展开', /** 同时支持两种触发方式时漏掉悬停会让配置失效。 */ async () => {
    const wrapper = mountDropdown({ trigger: 'both' });

    await hoverTrigger(wrapper);

    await vi.waitFor(
      /** 等待悬停状态真实驱动菜单展开。 */ () => {
        expect(findMenuItems().length).toBeGreaterThan(0);
      },
    );
  });

  it('trigger 为 click 时鼠标移入不展开菜单', /** 点击模式下误开菜单会让菜单一直挂在页面上。 */ async () => {
    const wrapper = mountDropdown({ trigger: 'click' });

    await hoverTrigger(wrapper);
    await new Promise(
      /** 留出悬停延迟窗口，确认菜单确实没有被悬停打开。 */ (resolve) => {
        setTimeout(resolve, 50);
      },
    );

    expect(findMenuItems()).toHaveLength(0);
    expect(readMenuState(wrapper)).toBe('closed');
  });
});

describe('用户下拉锁屏与退出链路', /** 这两条链路决定用户能否锁住屏幕并安全退出。 */ () => {
  it('点击锁屏入口打开锁屏弹窗并提交真实密码', /** 密码没交出去会让用户按了锁屏却没锁上。 */ async () => {
    const wrapper = mountDropdown();
    await openMenu(wrapper);

    const lockItem = findMenuItem($t('ui.widgets.lockScreen.title'));
    expect(lockItem).toBeDefined();
    lockItem?.click();

    await vi.waitFor(
      /** 等待真实锁屏弹窗渲染出密码输入框。 */ () => {
        expect(findLockScreenInput()).not.toBeNull();
      },
    );

    const input = findLockScreenInput();
    await new DOMWrapper(input as Element).setValue('DUMMY-锁屏密码');

    const submitButton = findButtonByText(
      $t('ui.widgets.lockScreen.screenButton'),
    );
    expect(submitButton).toBeDefined();
    submitButton?.click();

    await vi.waitFor(
      /** 等待密码真实交给访问状态。 */ () => {
        expect(accessState.lockScreenCalls).toStrictEqual(['DUMMY-锁屏密码']);
      },
    );
    // 提交成功后锁屏弹窗必须真正关闭。
    await vi.waitFor(
      /** 等待锁屏弹窗真实关闭。 */ () => {
        expect(findLockScreenInput()).toBeNull();
      },
    );
  });

  it('点击退出入口打开确认弹窗并收起下拉，确认后抛出 logout', /** 事件断链会让用户点了退出却什么都没发生。 */ async () => {
    const wrapper = mountDropdown();
    await openMenu(wrapper);

    const logoutItem = findMenuItem($t('common.logout'));
    expect(logoutItem).toBeDefined();
    logoutItem?.click();

    await vi.waitFor(
      /** 等待退出确认弹窗真实渲染。 */ () => {
        expect(document.body.textContent).toContain($t('ui.widgets.logoutTip'));
      },
    );
    // 打开确认弹窗的同时必须收起下拉菜单，否则两层浮层会互相遮挡。
    expect(readMenuState(wrapper)).toBe('closed');

    const confirmButton = await vi.waitFor(
      /** 等待确认按钮随弹窗真实渲染。 */ () => {
        const target = findButtonByText($t('common.confirm'));
        expect(target).toBeDefined();
        return target;
      },
    );
    confirmButton?.click();

    await vi.waitFor(
      /** 等待退出事件抛出且确认弹窗真实关闭。 */ () => {
        expect(wrapper.emitted('logout')).toHaveLength(1);
        expect(document.body.textContent).not.toContain(
          $t('ui.widgets.logoutTip'),
        );
      },
    );
  });

  it('取消退出确认弹窗不会抛出 logout，也不影响后续退出', /** 取消仍退出会让用户误触后直接掉线。 */ async () => {
    const wrapper = mountDropdown();
    await openMenu(wrapper);
    findMenuItem($t('common.logout'))?.click();
    await vi.waitFor(
      /** 等待退出确认弹窗真实渲染。 */ () => {
        expect(document.body.textContent).toContain($t('ui.widgets.logoutTip'));
      },
    );

    const cancelButton = findButtonByText($t('common.cancel'));
    expect(cancelButton).toBeDefined();
    cancelButton?.click();

    await vi.waitFor(
      /** 等待取消动作真实关闭确认弹窗。 */ () => {
        expect(document.body.textContent).not.toContain(
          $t('ui.widgets.logoutTip'),
        );
      },
    );
    expect(wrapper.emitted('logout')).toBeUndefined();

    // 取消之后再次走退出链路仍必须能正常抛出，说明取消没有破坏组件状态。
    await openMenu(wrapper);
    findMenuItem($t('common.logout'))?.click();
    const confirmButton = await vi.waitFor(
      /** 等待确认按钮随弹窗再次真实渲染。 */ () => {
        const target = findButtonByText($t('common.confirm'));
        expect(target).toBeDefined();
        return target;
      },
    );
    confirmButton?.click();
    await vi.waitFor(
      /** 等待第二次退出事件真实抛出。 */ () => {
        expect(wrapper.emitted('logout')).toHaveLength(1);
      },
    );
  });
});

describe('用户下拉快捷键', /** 快捷键决定键盘用户能否直接锁屏或退出。 */ () => {
  it('alt+L 打开锁屏弹窗', /** 快捷键失灵会让偏好里开启它的用户按键无反应。 */ async () => {
    mountDropdown();

    await pressAltKey('l', 'KeyL');

    await vi.waitFor(
      /** 等待锁屏弹窗被快捷键真实打开。 */ () => {
        expect(findLockScreenInput()).not.toBeNull();
      },
    );
  });

  it('alt+Q 打开退出确认弹窗并收起下拉', /** 退出快捷键失灵会让键盘用户只能靠鼠标点菜单。 */ async () => {
    const wrapper = mountDropdown();

    await pressAltKey('q', 'KeyQ');

    await vi.waitFor(
      /** 等待退出确认弹窗被快捷键真实打开。 */ () => {
        expect(document.body.textContent).toContain($t('ui.widgets.logoutTip'));
      },
    );
    expect(readMenuState(wrapper)).toBe('closed');
  });

  it('关闭快捷键开关后两个组合键都不再触发', /** 关掉开关仍触发会让用户无法彻底禁用快捷键。 */ async () => {
    mountDropdown({ enableShortcutKey: false });

    await pressAltKey('l', 'KeyL');
    await pressAltKey('q', 'KeyQ');
    await new Promise(
      /** 留出按键回调的响应窗口，确认组合键确实没有任何副作用。 */ (
        resolve,
      ) => {
        setTimeout(resolve, 50);
      },
    );

    expect(findLockScreenInput()).toBeNull();
    expect(document.body.textContent).not.toContain($t('ui.widgets.logoutTip'));
  });

  it('偏好里关闭全局快捷键后组合键不再触发', /** 偏好开关不生效会让用户改不动快捷键行为。 */ async () => {
    updatePreferences({ shortcutKeys: { enable: false } });
    mountDropdown();

    await pressAltKey('l', 'KeyL');
    await new Promise(
      /** 留出按键回调的响应窗口，确认偏好关闭后确实不触发。 */ (resolve) => {
        setTimeout(resolve, 50);
      },
    );

    expect(findLockScreenInput()).toBeNull();
    expect(preferences.shortcutKeys.enable).toBe(false);
  });
});
