/**
 * 声明抽屉组件与命令式 API：返回 [Drawer, api]，
 * 模板挂组件、逻辑改 api；传入 connectedComponent
 * 时改用 provide/inject 连接内外两层抽屉，
 * 并校验 props 是否撞上状态键。默认配置按
 * setDefaultDrawerProps、上层与本次 options 覆盖。
 */
import type {
  DrawerApiOptions,
  DrawerProps,
  ExtendedDrawerApi,
} from './drawer';

import {
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  reactive,
  ref,
} from 'vue';

import { useStore } from '@vben-core/shared/store';

import { DrawerApi } from './drawer-api';
import VbenDrawer from './drawer.vue';

const USER_DRAWER_INJECT_KEY = Symbol('VBEN_DRAWER_INJECT');

/** connectedComponent 模式下由父组件 provide、内层抽屉 inject 的连接信息。 */
interface UserDrawerInjectData {
  /** 内层抽屉创建时用来接管 api 原型的方法。 */
  extendApi?: (api: ExtendedDrawerApi) => void;
  /** 父组件为该抽屉声明的默认配置，会被内层自己的 options 覆盖。 */
  options: DrawerApiOptions;
  /** 强制卸载并重建内层抽屉组件，用于 destroyOnClose 后清空内部状态。 */
  reCreateDrawer?: () => Promise<void>;
}

const DEFAULT_DRAWER_PROPS: Partial<DrawerProps> = {};

export function setDefaultDrawerProps(props: Partial<DrawerProps>) {
  Object.assign(DEFAULT_DRAWER_PROPS, props);
}

/**
 * 声明一个受控抽屉组件及其命令式 API。
 *
 * 传入 connectedComponent 表示抽屉被抽离为独立组件，此时由外层通过 provide/inject
 * 把 API 交接给内层抽屉；否则在本组件内直接创建 API。
 *
 * @param options 抽屉初始状态与各类生命周期回调
 * @returns 抽屉组件与对应 API 的二元组，可在模板中解构使用
 */
export function useVbenDrawer<
  TParentDrawerProps extends DrawerProps = DrawerProps,
>(options: DrawerApiOptions = {}) {
  // Drawer一般会抽离出来，所以如果有传入 connectedComponent，则表示为外部调用，与内部组件进行连接
  // 外部的Drawer通过provide/inject传递api

  const { connectedComponent } = options;
  if (connectedComponent) {
    const extendedApi = reactive({});
    const isDrawerReady = ref(true);
    const Drawer = defineComponent(
      (props: TParentDrawerProps, { attrs, slots }) => {
        provide(USER_DRAWER_INJECT_KEY, {
          extendApi(api: ExtendedDrawerApi) {
            // 不能直接给 reactive 赋值，会丢失响应
            // 不能用 Object.assign,会丢失 api 的原型函数
            Object.setPrototypeOf(extendedApi, api);
          },
          options,
          async reCreateDrawer() {
            isDrawerReady.value = false;
            await nextTick();
            isDrawerReady.value = true;
          },
        });
        checkProps(extendedApi as ExtendedDrawerApi, {
          ...props,
          ...attrs,
          ...slots,
        });
        return () =>
          h(
            isDrawerReady.value ? connectedComponent : 'div',
            { ...props, ...attrs },
            slots,
          );
      },
      // eslint-disable-next-line vue/one-component-per-file
      {
        name: 'VbenParentDrawer',
        inheritAttrs: false,
      },
    );

    return [Drawer, extendedApi as ExtendedDrawerApi] as const;
  }

  // 没有 connectedComponent 时不存在父级注入，退化为空的默认配置而不是 undefined。
  const injectData = inject<UserDrawerInjectData>(USER_DRAWER_INJECT_KEY, {
    options: {},
  });

  const mergedOptions = {
    ...DEFAULT_DRAWER_PROPS,
    ...injectData.options,
    ...options,
  } as DrawerApiOptions;

  mergedOptions.onOpenChange = (isOpen: boolean) => {
    options.onOpenChange?.(isOpen);
    injectData.options?.onOpenChange?.(isOpen);
  };

  const onClosed = mergedOptions.onClosed;
  mergedOptions.onClosed = () => {
    onClosed?.();
    if (mergedOptions.destroyOnClose) {
      injectData.reCreateDrawer?.();
    }
  };
  const api = new DrawerApi(mergedOptions);

  const extendedApi: ExtendedDrawerApi = api as never;

  extendedApi.useStore = (selector) => {
    return useStore(api.store, selector);
  };

  const Drawer = defineComponent(
    (props: DrawerProps, { attrs, slots }) => {
      const drawerProps = {
        ...props,
        ...attrs,
        drawerApi: extendedApi,
      } as InstanceType<typeof VbenDrawer>['$props'];
      return () => h(VbenDrawer, drawerProps, slots);
    },
    // eslint-disable-next-line vue/one-component-per-file
    {
      name: 'VbenDrawer',
      inheritAttrs: false,
    },
  );
  injectData.extendApi?.(extendedApi);
  return [Drawer, extendedApi] as const;
}

/**
 * 校验 connectedComponent 模式下外部传入的 props 是否与抽屉状态键冲突。
 *
 * props、attrs 与 slots 会被合并后透传给内部抽屉，若其中包含状态字段会绕过 api 直接改状态，
 * 导致回调与状态不同步，因此这里逐个比对并告警。只提示不阻断，保持向后兼容。
 *
 * @param api 内层抽屉暴露的 api，用于读取当前状态键集合
 * @param attrs 外部组件实际传入的 props、attrs 与 slots 合并结果
 */
async function checkProps(
  api: ExtendedDrawerApi,
  attrs: Record<string, unknown>,
) {
  if (!attrs || Object.keys(attrs).length === 0) {
    return;
  }
  await nextTick();

  const state = api?.store?.state;

  if (!state) {
    return;
  }

  const stateKeys = new Set(Object.keys(state));

  for (const attr of Object.keys(attrs)) {
    if (stateKeys.has(attr) && !['class'].includes(attr)) {
      console.warn(
        `[Vben Drawer]: When 'connectedComponent' exists, do not set props or slots '${attr}', which will increase complexity. If you need to modify the props of Drawer, please use useVbenDrawer or api.`,
      );
    }
  }
}
