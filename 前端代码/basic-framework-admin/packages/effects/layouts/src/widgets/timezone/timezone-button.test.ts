/**
 * 时区设置入口（widgets/timezone/timezone-button.vue）真实时区切换回归。
 *
 * 该部件用真实弹窗列出时区选项，确认后必须把选中的时区写进真实时区 store 并同步全局时区设置：
 * 列表加载失败会让用户看不到可选项，确认时漏写会让界面显示旧时区，取值写错会让全局时区与
 * 用户选择不一致，进而让所有时间显示偏差。用例按真实业务用法挂载组件、用真实点击打开弹窗、
 * 选中真实选项并点击真实确认按钮，断言真实 store 状态、真实弹窗开关与真实全局时区。
 */
import { mount } from '@vue/test-utils';
import { createApp, h } from 'vue';

import { setupI18n } from '@vben/locales';
import { initStores, useTimezoneStore } from '@vben/stores';

import { getCurrentTimezone } from '@vben-core/shared/utils';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import TimezoneButton from './timezone-button.vue';

vi.hoisted(
  /**
   * `initStores` 读取运行时配置里的持久化密钥，测试进程没有加载生产配置脚本，
   * 因此在导入 Stores 之前建立最小替身；该键值不参与任何真实加密。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_APP_STORE_SECURE_KEY: '',
    });
  },
);

/** 与挂载组件共享的 Pinia 实例类型，取自真实初始化入口，避免新增 pinia 类型依赖。 */
type PiniaInstance = Awaited<ReturnType<typeof initStores>>;

/** 用例共享的 pinia 实例，保证组件与断言读取同一份时区状态。 */
let pinia: PiniaInstance;

/** 时区 store 在下拉框中真实提供的选项；弹窗与断言都以它为准。 */
let timezoneOptions: { label: string; value: string }[] = [];

/** 用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

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
 * 读取弹窗里真实渲染的时区选项标签文案。
 * @returns 按渲染顺序排列的选项文案数组。
 */
function optionLabels() {
  return [...document.querySelectorAll('.timezone-container label')].map(
    /** 取标签的可见文案并去掉首尾空白。 */ (label) =>
      label.textContent?.trim() ?? '',
  );
}

/**
 * 取出弹窗底部真实渲染的确认按钮。
 * @returns 确认按钮元素。
 * @throws 弹窗未渲染或已关闭时抛出，避免断言作用在 undefined 上。
 */
function confirmButton() {
  const button = [...document.querySelectorAll<HTMLElement>('button')].find(
    /** 按确认文案定位弹窗底部的主按钮。 */ (item) =>
      item.textContent?.trim() === '确认' &&
      item.className.includes('bg-primary'),
  );
  if (!button) {
    throw new Error('弹窗未渲染确认按钮');
  }
  return button;
}

/**
 * 取出弹窗底部真实渲染的取消按钮。
 * @returns 取消按钮元素。
 * @throws 弹窗未渲染时抛出，避免断言作用在 undefined 上。
 */
function cancelButton() {
  const button = [...document.querySelectorAll<HTMLElement>('button')].find(
    /** 按取消文案定位底部取消按钮。 */ (item) =>
      item.textContent?.includes('取消'),
  );
  if (!button) {
    throw new Error('弹窗未渲染取消按钮');
  }
  return button;
}

/** 弹窗是否已真实关闭：关闭动画结束后弹窗节点会从文档中移除。 */
function dialogClosed() {
  return document.querySelector('[role="dialog"]') === null;
}

beforeAll(
  /** 按真实 API 装载中文语言包，弹窗标题与按钮文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

beforeEach(
  /** 每例使用独立真实 pinia，并清空上一例残留的弹窗节点与持久化时区。 */ async () => {
    document.body.innerHTML = '';
    localStorage.clear();
    pinia = await initStores(
      createApp({
        /** 只为安装 Pinia 提供应用实例，不渲染任何界面。 */
        render: () => null,
      }),
      { namespace: 'timezone-button-test' },
    );
    // 选项列表来自真实 store 的默认处理模块，用真实返回值驱动断言。
    timezoneOptions = await useTimezoneStore(pinia).getTimezoneOptions();
  },
);

afterEach(
  /** 卸载宿主，避免残留的响应式副作用影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

/**
 * 挂载时区入口并真实打开弹窗。
 * @returns 已挂载的时区入口宿主。
 */
async function mountAndOpen() {
  mounted = mount(TimezoneButton, { global: { plugins: [pinia] } });
  await mounted.get('button').trigger('click');
  await vi.waitFor(
    /** 等待弹窗真实加载出全部时区选项。 */ () => {
      expect(optionLabels()).toHaveLength(timezoneOptions.length);
    },
    { timeout: 2000 },
  );
  return mounted;
}

describe('时区入口渲染与弹窗打开', /** 入口或选项缺失会让用户无法设置时区。 */ () => {
  it('点击图标按钮打开弹窗并加载真实时区选项', /** 列表加载或开关写错会让用户看不到任何可选项。 */ async () => {
    // 时区 store 的初值取自运行环境的 dayjs.tz.guess()，而默认选项列表只含 5 个固定时区；
    // 在 UTC 主机（CI）上该初值不在列表内，弹窗不会有任何选项被选中。先显式写入一个列表内的
    // 时区，使"默认选中当前时区"这一断言只取决于实现，不取决于运行环境。
    await useTimezoneStore(pinia).setTimezone(timezoneOptions[0]!.value);
    const wrapper = await mountAndOpen();

    expect(wrapper.find('button').exists()).toBe(true);
    expect(document.body.textContent).toContain('设置时区');
    expect(optionLabels()).toEqual(
      timezoneOptions.map(
        /** 逐项核对弹窗展示的真实时区文案。 */ (option) => option.label,
      ),
    );
    // 弹窗打开后默认选中当前时区。
    expect(
      document.querySelector('[role="radio"][data-state="checked"]')?.id,
    ).toBe(getCurrentTimezone());
  });
});

describe('时区确认写入', /** 写错时区会让所有时间显示偏差。 */ () => {
  it('选中其他时区并确认后写入真实 store 与全局时区', /** 确认漏写或写错项会让偏好与界面不一致。 */ async () => {
    await mountAndOpen();
    const store = useTimezoneStore(pinia);
    const setTimezone = vi.spyOn(store, 'setTimezone');
    const target = timezoneOptions.find(
      /** 选一个与默认时区不同的真实选项。 */ (option) =>
        option.value !== getCurrentTimezone(),
    );
    const targetItem = document.querySelector<HTMLElement>(
      `[role="radio"][id="${target?.value}"]`,
    );

    targetItem?.click();
    confirmButton().click();

    await vi.waitFor(
      /** 等待真实 store 写入与全局时区同步完成。 */ () => {
        expect(getCurrentTimezone()).toBe(target?.value);
      },
      { timeout: 2000 },
    );
    expect(setTimezone).toHaveBeenCalledWith(target?.value);
    expect(store.timezone).toBe(target?.value);
    await vi.waitFor(
      /** 等待弹窗真实关闭。 */ () => {
        expect(dialogClosed()).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('确认提交期间按钮进入禁用与 loading 状态', /** 提交态不设置会让用户重复提交，不复位会让弹窗永久卡住。 */ async () => {
    await mountAndOpen();
    const confirm = confirmButton();
    const store = useTimezoneStore(pinia);
    // 让真实写入挂在 pending 上，从而稳定观察到提交中的真实状态；放行开关由用例持有。
    let releasePending = () => {};
    const pending = new Promise<void>(
      /** 把解除挂起的开关交给用例，由用例决定何时结束提交。 */ (resolve) => {
        releasePending = resolve;
      },
    );
    const originalSetTimezone = store.setTimezone;
    store.setTimezone =
      /**
       * 先等待用例放行，再执行真实的时区写入。
       * @param timezone 本次要写入的时区。
       */
      async (timezone: string) => {
        await pending;
        await originalSetTimezone.call(store, timezone);
      };

    confirm.click();
    await vi.waitFor(
      /** 等待提交态真实落到按钮上。 */ () => {
        expect(confirmButton().hasAttribute('disabled')).toBe(true);
      },
      { timeout: 2000 },
    );
    // 提交中的按钮渲染真实 loading 图标。
    expect(confirmButton().querySelector('.animate-spin')).not.toBeNull();

    releasePending();
    await vi.waitFor(
      /** 等待提交结束、弹窗关闭。 */ () => {
        expect(dialogClosed()).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('未改动选中项时确认只提交当前时区并关闭弹窗', /** 未改动即提交写错会让用户每次确认都改动时区。 */ async () => {
    const wrapper = await mountAndOpen();
    const before = getCurrentTimezone();

    confirmButton().click();

    await vi.waitFor(
      /** 等待弹窗真实关闭。 */ () => {
        expect(dialogClosed()).toBe(true);
      },
      { timeout: 2000 },
    );
    expect(getCurrentTimezone()).toBe(before);
    expect(wrapper.find('button').exists()).toBe(true);
  });
});

describe('时区弹窗取消', /** 取消不应改动任何时区状态。 */ () => {
  it('直接关闭弹窗不改动时区', /** 取消也写入会让用户被迫接受未确认的时区。 */ async () => {
    await mountAndOpen();
    const before = getCurrentTimezone();

    cancelButton().click();

    await vi.waitFor(
      /** 等待弹窗真实关闭。 */ () => {
        expect(dialogClosed()).toBe(true);
      },
      { timeout: 2000 },
    );
    expect(getCurrentTimezone()).toBe(before);
  });
});

describe('时区全局同步', /** 全局时区不同步会让时间格式化继续使用旧时区。 */ () => {
  it('store 写入时区后新开弹窗默认选中新时区', /** 默认选中不跟随会让用户误以为设置没生效。 */ async () => {
    await useTimezoneStore(pinia).setTimezone('Europe/London');
    expect(getCurrentTimezone()).toBe('Europe/London');

    await mountAndOpen();

    expect(
      document.querySelector('[role="radio"][data-state="checked"]')?.id,
    ).toBe('Europe/London');
  });
});
