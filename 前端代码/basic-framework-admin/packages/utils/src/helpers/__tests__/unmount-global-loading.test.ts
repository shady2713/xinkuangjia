/** 首屏 loading 节点卸载的测试：先加隐藏类触发过渡，动画结束后再移除主节点与注入节点。 */
import { afterEach, describe, expect, it } from 'vitest';

import { unmountGlobalLoading } from '../unmount-global-loading';

afterEach(
  /** 清空页面结构，避免残留的 loading 节点影响下一例。 */ () => {
    document.body.innerHTML = '';
  },
);

/** 构造首屏 loading 主体节点与若干注入的 loading 节点。
 * @returns 主体节点，便于手动派发 transitionend。
 */
function createLoadingNodes(): HTMLElement {
  const loading = document.createElement('div');
  loading.id = '__app-loading__';
  const injected = document.createElement('div');
  injected.dataset.appLoading = 'inject-one';
  const injectedAgain = document.createElement('div');
  injectedAgain.dataset.appLoading = 'inject-two';
  document.body.append(loading, injected, injectedAgain);
  return loading;
}

describe('unmountGlobalLoading', /** 过渡动画结束才移除节点，避免渲染过快时出现闪烁。 */ () => {
  it('动画结束后移除主节点与全部注入节点', /** 主节点和注入节点都必须移除，否则遮挡首个页面。 */ () => {
    const loading = createLoadingNodes();

    unmountGlobalLoading();
    loading.dispatchEvent(new Event('transitionend'));

    expect(document.querySelector('#__app-loading__')).toBeNull();
    expect(
      document.querySelectorAll('[data-app-loading^="inject"]'),
    ).toHaveLength(0);
  });

  it('先加 hidden 类再等待动画', /** 直接移除会造成闪烁，必须先触发过渡。 */ () => {
    const loading = createLoadingNodes();

    unmountGlobalLoading();

    expect(loading.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('#__app-loading__')).toBe(loading);
  });

  it('监听只生效一次', /** 重复派发事件不能影响已移除的节点。 */ () => {
    const loading = createLoadingNodes();

    unmountGlobalLoading();
    loading.dispatchEvent(new Event('transitionend'));
    loading.dispatchEvent(new Event('transitionend'));

    expect(document.querySelector('#__app-loading__')).toBeNull();
  });

  it('页面上没有 loading 节点时不抛错', /** 二次调用或未注入 loading 的页面必须安全返回。 */ () => {
    expect(
      /** 缺少 loading 节点时应安全返回而不是抛错。 */ () =>
        unmountGlobalLoading(),
    ).not.toThrow();
    expect(document.body.innerHTML).toBe('');
  });
});
