/**
 * 更新检查（widgets/check-updates/check-updates.vue）轮询、版本比对与三条结果分支回归。
 *
 * 该组件长期驻留在布局里，靠定时轮询和页面重新可见两个入口判断线上是否发布了新版本：
 * 首次检查若直接弹窗，用户每次刷新页面都会被无关提示打断；版本未变化却弹窗会让提示失去意义；
 * 版本变化却不弹窗会让用户一直跑在旧代码上；网络失败未兜住会让轮询中断或抛错；
 * 页面隐藏后若不停表，后台标签页会持续发起无意义请求；检查进行中重复触发可见性变化若不加锁，
 * 会出现并发重复检查。用例挂载真实组件与真实弹窗，只替换外部边界：网络请求、页面地址与轮询时钟。
 */
import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CheckUpdates from './check-updates.vue';

/** 检查更新的地址与版本标记夹具，全部使用占位值，避免依赖真实服务。 */
const UPDATE_URL = 'https://example.com/DUMMY-index.html';
const FIRST_TAG = 'DUMMY-版本一';
const SECOND_TAG = 'DUMMY-版本二';

/** 手动结算网络请求的入口签名。 */
type PendingFetchResolver = (value: unknown) => void;

/** 更新提示正文的文案键，语言包被固定为返回键名，断言只依赖键名。 */
const DESCRIPTION_KEY = 'ui.widgets.checkUpdatesDescription';
/** 确认按钮的文案键。 */
const REFRESH_KEY = 'common.refresh';

/** 网络请求替身：请求外部服务属于边界，替换后组件自身的状态机真实执行。 */
const fetchMock = vi.fn();

/** 当前文档的隐藏状态，用例通过它驱动可见性变化的两条分支。 */
let documentHidden = false;

/** 当前用例挂载的组件；用例结束统一卸载，避免残留实例继续监听文档事件。 */
let wrapper: undefined | VueWrapper;

/** 主机名伪装的恢复函数签名。 */
type RestoreHostname = () => void;

/** 主机名伪装的恢复函数；用例结束统一恢复，避免污染后续用例。 */
let restoreHostname: RestoreHostname | undefined;

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

/**
 * 把当前文档的主机名切换为非本机地址，使组件走真实的网络检查分支。
 * @param hostname 要伪装的主机名。
 * @returns 恢复真实主机名的清理函数。
 */
function stubHostname(hostname: string) {
  const original = Object.getOwnPropertyDescriptor(window.location, 'hostname');
  Object.defineProperty(window.location, 'hostname', {
    configurable: true,
    /** 返回用例指定的主机名。 */
    get: () => hostname,
  });
  return /** 删除伪装并恢复原型上的真实主机名。 */ () => {
    if (original) {
      Object.defineProperty(window.location, 'hostname', original);
    } else {
      delete (window.location as { hostname?: string }).hostname;
    }
  };
}

/**
 * 让下一次网络检查返回指定的版本标记。
 * @param tag 服务端返回的版本标记；省略表示响应里没有任何版本头。
 */
function respondWithTag(tag?: string) {
  fetchMock.mockResolvedValue({
    headers: new Headers(tag === undefined ? {} : { etag: tag }),
  });
}

/**
 * 把主机名伪装成远端地址，并登记恢复动作。
 */
function stubRemoteHostname() {
  restoreHostname = stubHostname('example.com');
}

/**
 * 挂载更新检查组件。
 * @param props 组件属性，用于调整轮询间隔。
 * @returns 已挂载的组件包装器。
 */
function mountCheckUpdates(props: Record<string, unknown> = {}) {
  wrapper = mount(CheckUpdates, {
    props: { checkUpdateUrl: UPDATE_URL, ...props },
  });
  return wrapper;
}

/**
 * 让轮询定时器走完一个周期并等待异步检查结算。
 * @param intervalMinutes 轮询间隔的分钟数。
 */
async function tickInterval(intervalMinutes = 1) {
  await vi.advanceTimersByTimeAsync(intervalMinutes * 60 * 1000);
  await flushPromises();
}

/**
 * 触发一次文档可见性变化事件。
 */
async function dispatchVisibilityChange() {
  document.dispatchEvent(new Event('visibilitychange'));
  await flushPromises();
}

/**
 * 在弹窗内按文案点击按钮。
 * @param text 目标按钮的文案键。
 */
async function clickNoticeButton(text: string) {
  const button = [...document.querySelectorAll('button')].find(
    /** 只点击文案精确匹配的按钮。 */ (item) =>
      item.textContent?.trim() === text,
  );
  if (!button) {
    throw new Error(`未找到弹窗按钮：${text}`);
  }
  button.click();
  await flushPromises();
}

beforeEach(
  /** 安装网络替身、时钟与文档可见性替身，保证用例从干净状态开始。 */ () => {
    fetchMock.mockReset();
    documentHidden = false;
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({
      toFake: ['clearInterval', 'clearTimeout', 'setInterval', 'setTimeout'],
    });
    vi.spyOn(document, 'hidden', 'get').mockImplementation(
      /** 返回用例设置的文档隐藏状态。 */ () => documentHidden,
    );
  },
);

afterEach(
  /** 卸载真实组件并清理替身、时钟与弹窗节点，避免残留实例影响其他用例。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
    restoreHostname?.();
    restoreHostname = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  },
);

describe('更新检查轮询', /** 首次检查与无变化时的提示策略决定用户会不会被打扰。 */ () => {
  it('本机地址下不发起网络检查也不提示更新', /** 本机开发时线上版本号无意义，发起请求会污染日志并误报更新。 */ async () => {
    respondWithTag(SECOND_TAG);
    mountCheckUpdates();

    await tickInterval();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(DESCRIPTION_KEY);
  });

  it('首次检查只记录版本号，不弹出更新提示', /** 首次检查就弹窗会让用户每次打开页面都被提示打断。 */ async () => {
    stubRemoteHostname();
    respondWithTag(FIRST_TAG);
    mountCheckUpdates();

    await tickInterval();

    expect(fetchMock).toHaveBeenCalledWith(
      UPDATE_URL,
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(document.body.textContent).not.toContain(DESCRIPTION_KEY);
  });

  it('版本号未变化时反复检查都不提示更新', /** 版本没变仍弹窗会让提示变成噪音，用户会直接忽略真正的更新。 */ async () => {
    stubRemoteHostname();
    respondWithTag(FIRST_TAG);
    mountCheckUpdates();

    await tickInterval();
    await tickInterval();
    await tickInterval();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(document.body.textContent).not.toContain(DESCRIPTION_KEY);
  });

  it('轮询间隔为 0 时不启动定时器', /** 关闭轮询后仍保留定时器会让用户在无感知的情况下持续发请求。 */ async () => {
    stubRemoteHostname();
    respondWithTag(FIRST_TAG);
    mountCheckUpdates({ checkUpdatesInterval: 0 });

    await tickInterval(10);

    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('更新检查结果分支', /** 三条结果分支决定提示是否出现、是否误报以及轮询是否中断。 */ () => {
  it('版本号变化时弹出更新提示，确认后刷新页面并记住新版本', /** 不弹窗会让用户一直跑旧代码，确认后不刷新则提示毫无作用。 */ async () => {
    stubRemoteHostname();
    const reload = vi.spyOn(window.location, 'reload');
    reload.mockImplementation(
      /** 记录刷新调用，避免测试环境真的重新导航。 */ () => {},
    );
    respondWithTag(FIRST_TAG);
    mountCheckUpdates();
    await tickInterval();

    respondWithTag(SECOND_TAG);
    await tickInterval();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain(DESCRIPTION_KEY);
    await clickNoticeButton(REFRESH_KEY);
    expect(reload).toHaveBeenCalledTimes(1);

    // 已确认的新版本被记住：轮询已停，同一个版本不会触发第二次检查。
    await tickInterval();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('网络检查失败时记录错误并让轮询继续', /** 网络抖动若不兜住会中断轮询，用户再也收不到更新提示。 */ async () => {
    stubRemoteHostname();
    const consoleError = vi.spyOn(console, 'error');
    consoleError.mockImplementation(
      /** 拦截真实错误日志，避免污染输出同时核对内容。 */ () => {},
    );
    fetchMock.mockRejectedValue(new Error('DUMMY-网络故障'));
    mountCheckUpdates();

    await tickInterval();

    expect(consoleError).toHaveBeenCalledWith('Failed to fetch version tag');
    expect(document.body.textContent).not.toContain(DESCRIPTION_KEY);
    // 轮询没有停：下一个周期仍然会发起检查。
    await tickInterval();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('更新检查与页面可见性', /** 可见性变化是后台标签页恢复后的补偿检查入口。 */ () => {
  it('页面隐藏时停止轮询，重新可见时立即检查并重启轮询', /** 后台标签页不停表会持续发起无用请求，恢复后不检查会错过新版本。 */ async () => {
    stubRemoteHostname();
    respondWithTag(FIRST_TAG);
    mountCheckUpdates();
    expect(vi.getTimerCount()).toBe(1);

    documentHidden = true;
    await dispatchVisibilityChange();
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    documentHidden = false;
    await dispatchVisibilityChange();

    // 重新可见时立即检查一次，并重新装上轮询定时器。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('检查进行中重复触发可见性变化不会并发重复检查', /** 缺少进行中标记会让一次恢复触发多次请求，版本比对也会互相覆盖。 */ async () => {
    stubRemoteHostname();
    /** 挂起的检查请求，用例通过它把检查固定在“进行中”。 */
    let resolveFetch: PendingFetchResolver | undefined;
    fetchMock.mockImplementation(
      /** 返回一个由用例手动结算的请求。 */ () =>
        new Promise(
          /** 记录结算入口，用例据此决定何时放行。 */ (resolve) => {
            resolveFetch = resolve;
          },
        ),
    );
    mountCheckUpdates();

    documentHidden = false;
    await dispatchVisibilityChange();
    await dispatchVisibilityChange();
    await dispatchVisibilityChange();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.({
      headers: new Headers({ etag: FIRST_TAG }),
    });
    await flushPromises();

    // 检查结束后重新装上轮询定时器，进行中标记被释放。
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    documentHidden = false;
    await dispatchVisibilityChange();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('组件卸载后停止轮询并不再响应可见性变化', /** 卸载后仍监听会让已销毁的组件继续发请求，泄露在布局切换时尤其明显。 */ async () => {
    stubRemoteHostname();
    respondWithTag(FIRST_TAG);
    const mounted = mountCheckUpdates();
    expect(vi.getTimerCount()).toBe(1);

    // 真实卸载组件：既停表也要摘掉文档事件监听。
    mounted.unmount();
    wrapper = undefined;

    expect(vi.getTimerCount()).toBe(0);
    documentHidden = false;
    await dispatchVisibilityChange();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
