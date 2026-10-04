/** 校验刷新页签 composable 的依赖取值与转发契约，防止刷新动作作用到错误的 Store 或 Router。 */
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRefresh } from '../use-refresh';

/** 被测 composable 的返回值类型，用于在组件外持有并调用 refresh。 */
type RefreshApi = ReturnType<typeof useRefresh>;

const boundary = vi.hoisted(
  /** 用例自有的外部边界：Router 实例与页签 Store 都由替身提供，便于核对转发对象。 */ () => ({
    refresh: vi.fn(),
    router: { currentRoute: { value: { path: '/probe' } }, push: vi.fn() },
  }),
);

vi.mock(
  'vue-router',
  /** 该 composable 只使用 useRouter，这里固定返回用例的 Router 替身。 */ () => ({
    /** 返回当前用例的 Router 替身，使断言能核对同一引用。 */
    useRouter: () => boundary.router,
  }),
);

vi.mock(
  '@vben/stores',
  /** 页签 Store 的真实实现依赖持久化，这里只保留 refresh 契约。 */ () => ({
    /** 返回只含 refresh 的页签 Store 替身。 */
    useTabbarStore: () => ({ refresh: boundary.refresh }),
  }),
);

/** 在真实组件上下文中调用 composable，确保 useRouter/useTabbarStore 的调用时机与生产一致。 */
function mountRefresh(): RefreshApi {
  let api: RefreshApi | undefined;
  const probe = defineComponent({
    /** 探针组件在 setup 中取得 composable 返回值，供用例在组件外调用。
     * @returns 不渲染节点的函数，composable 的取值才是观察对象。
     */
    setup() {
      api = useRefresh();
      return /** 不渲染任何节点，只用于取得 composable 返回值。 */ () => null;
    },
  });
  mount(probe);
  if (!api) throw new Error('useRefresh 未返回可调用的 API');
  return api;
}

describe('useRefresh 页签刷新', /** 布局头部刷新按钮直接调用该 composable，转发对象写错会刷新错误的页签或路由。 */ () => {
  beforeEach(
    /** 每个用例独立记录调用次数，避免跨用例累计。 */ () => {
      boundary.refresh.mockReset();
    },
  );

  it('返回仅含 refresh 方法的对象', /** 对外契约只有一个动作，新增字段会扩大布局层的耦合面。 */ () => {
    const api = mountRefresh();
    expect(Object.keys(api)).toEqual(['refresh']);
    expect(api.refresh).toBeTypeOf('function');
  });

  it('调用 refresh 时把当前 Router 交给页签 Store', /** 页签刷新需要按当前路由重建，传错实例会刷新到别处。 */ async () => {
    const api = mountRefresh();
    boundary.refresh.mockResolvedValue(undefined);

    await api.refresh();

    expect(boundary.refresh).toHaveBeenCalledTimes(1);
    expect(boundary.refresh).toHaveBeenCalledWith(boundary.router);
  });

  it('refresh 等待 Store 的异步刷新完成后再结束', /** 调用方依赖 await 判断刷新结束，提前返回会让后续导航与旧页签竞争。 */ async () => {
    const api = mountRefresh();
    const order: string[] = [];
    boundary.refresh.mockImplementation(
      /** 用可控的异步结果证明 refresh 确实等待了 Store。 */ async () => {
        await Promise.resolve();
        order.push('store');
      },
    );

    await api.refresh().then(
      /** 记录调用方在 refresh 结束后才继续执行。 */ () => {
        order.push('caller');
      },
    );

    expect(order).toEqual(['store', 'caller']);
  });

  it('store 刷新失败时异常向调用方传播', /** 刷新失败必须让按钮层感知，不能静默吞掉导致用户以为已刷新。 */ async () => {
    const api = mountRefresh();
    boundary.refresh.mockRejectedValue(new Error('refresh failed'));

    await expect(api.refresh()).rejects.toThrow('refresh failed');
  });
});
