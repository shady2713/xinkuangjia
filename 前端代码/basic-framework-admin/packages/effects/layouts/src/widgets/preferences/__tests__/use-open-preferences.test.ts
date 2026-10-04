/** 校验偏好设置抽屉的打开状态入口：初始值、打开动作与跨消费方的共享引用。 */
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import { useOpenPreferences } from '../use-open-preferences';

/** 被测 composable 的返回值类型，供用例在组件外持有共享状态。 */
type OpenPreferencesApi = ReturnType<typeof useOpenPreferences>;

/** 最近一次挂载的探针返回值，用于在组件外核对共享状态。 */
let lastApi: OpenPreferencesApi | undefined;

/** 在真实组件上下文中调用 composable，返回本次取得的共享状态入口。 */
function mountPreferences() {
  const probe = defineComponent({
    /** 探针组件在 setup 中取得 composable 返回值，供用例在组件外调用。
     * @returns 不渲染节点的函数，共享状态才是观察对象。
     */
    setup() {
      lastApi = useOpenPreferences();
      return /** 不渲染任何节点，只用于取得共享状态入口。 */ () => null;
    },
  });
  mount(probe);
  if (!lastApi) throw new Error('useOpenPreferences 未返回可用入口');
  return lastApi;
}

describe('useOpenPreferences 偏好设置打开状态', /** 该模块是布局包对外导出的入口，模块级共享状态必须保持单例语义。 */ () => {
  afterEach(
    /** 共享状态跨用例存活，恢复初始值避免影响后续断言。 */ () => {
      if (lastApi) lastApi.openPreferences.value = false;
      lastApi = undefined;
    },
  );

  it('初始状态为关闭', /** 首屏不得自动弹出偏好抽屉，初始值必须为 false。 */ () => {
    const api = mountPreferences();
    expect(api.openPreferences.value).toBe(false);
  });

  it('调用打开动作后状态变为 true', /** 外部按钮通过该动作打开抽屉，动作失效会导致入口点击无响应。 */ () => {
    const api = mountPreferences();
    api.handleOpenPreference();
    expect(api.openPreferences.value).toBe(true);
  });

  it('重复打开保持 true 且不产生额外副作用', /** 连续点击不能翻转状态，否则第二次点击会把抽屉关掉。 */ () => {
    const api = mountPreferences();
    api.handleOpenPreference();
    api.handleOpenPreference();
    expect(api.openPreferences.value).toBe(true);
  });

  it('多次调用返回同一份共享状态引用', /** 抽屉组件与触发按钮必须观察同一个 ref，各自持有副本会让开关状态失联。 */ () => {
    const first = mountPreferences();
    const second = mountPreferences();
    expect(second.openPreferences).toBe(first.openPreferences);

    second.handleOpenPreference();
    expect(first.openPreferences.value).toBe(true);
  });
});
