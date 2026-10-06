/**
 * 声明弹窗组件与命令式 API：返回 [Modal, api]，
 * 模板挂组件、逻辑改 api；传入 connectedComponent
 * 时改用 provide/inject 配对内外两层弹窗，
 * 嵌套弹窗不继承上层配置。默认配置按
 * setDefaultModalProps、上层与本次 options 覆盖。
 */
import type { ExtendedModalApi, ModalApiOptions, ModalProps } from './modal';

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

import { ModalApi } from './modal-api';
import VbenModal from './modal.vue';

const USER_MODAL_INJECT_KEY = Symbol('VBEN_MODAL_INJECT');

/** connectedComponent 模式下由父组件 provide、内层弹窗 inject 的连接信息。 */
interface UserModalInjectData {
  /** 本次注入是否已被内层弹窗消费；已消费说明当前是嵌套弹窗，不再合并上层配置。 */
  consumed: boolean;
  /** 内层弹窗创建时用来接管 api 原型的方法。 */
  extendApi?: (api: ExtendedModalApi) => void;
  /** 父组件为该弹窗声明的默认配置，会被内层自己的 options 覆盖。 */
  options: ModalApiOptions;
  /** 强制卸载并重建内层弹窗组件，用于 destroyOnClose 后清空内部状态。 */
  reCreateModal?: () => Promise<void>;
}

const DEFAULT_MODAL_PROPS: Partial<ModalProps> = {};

/**
 * 改写之后创建的每个弹窗都会套用的默认选项，按调用顺序逐个覆盖。
 * 只影响之后创建的弹窗，已经建好的 api 状态不会被回写。
 * @param props 要覆盖的默认字段，通常是标题文案、按钮文案一类全局偏好。
 */
export function setDefaultModalProps(props: Partial<ModalProps>) {
  Object.assign(DEFAULT_MODAL_PROPS, props);
}

/**
 * 声明一个受控弹窗组件及其命令式 API。
 *
 * 传入 connectedComponent 表示弹窗被抽离为独立组件，此时由外层通过 provide/inject
 * 把 API 交接给内层弹窗；否则在本组件内直接创建 API。嵌套弹窗不会继承上层配置。
 *
 * @param options 弹窗初始状态与各类生命周期回调
 * @returns 弹窗组件与对应 API 的二元组，可在模板中解构使用
 */
export function useVbenModal<TParentModalProps extends ModalProps = ModalProps>(
  options: ModalApiOptions = {},
) {
  // Modal一般会抽离出来，所以如果有传入 connectedComponent，则表示为外部调用，与内部组件进行连接
  // 外部的Modal通过provide/inject传递api

  const { connectedComponent } = options;
  if (connectedComponent) {
    const extendedApi = reactive({});
    const isModalReady = ref(true);
    /**
     * connectedComponent 模式的外层壳组件：只负责把连接信息 provide 出去、
     * 校验外部传入的 props，并渲染真正的弹窗组件；自身不持有弹窗状态。
     */
    const Modal = defineComponent(
      (props: TParentModalProps, { attrs, slots }) => {
        provide(USER_MODAL_INJECT_KEY, {
          /**
           * 内层弹窗创建后把它的 api 原型接到外层响应式对象上，
           * 用原型而不是赋值或 Object.assign，是为了既保留响应式又不丢掉原型方法。
           * @param api 内层弹窗刚创建出来的 api。
           */
          extendApi(api: ExtendedModalApi) {
            // 不能直接给 reactive 赋值，会丢失响应
            // 不能用 Object.assign,会丢失 api 的原型函数
            Object.setPrototypeOf(extendedApi, api);
          },
          consumed: false,
          options,
          /**
           * 配合 destroyOnClose：把渲染目标切成占位 div 再切回来，
           * 强制内层弹窗重建，借此清掉上一次残留的内部状态。
           */
          async reCreateModal() {
            isModalReady.value = false;
            await nextTick();
            isModalReady.value = true;
          },
        });
        checkProps(extendedApi as ExtendedModalApi, {
          ...props,
          ...attrs,
          ...slots,
        });
        return () =>
          h(
            isModalReady.value ? connectedComponent : 'div',
            {
              ...props,
              ...attrs,
            },
            slots,
          );
      },
      // eslint-disable-next-line vue/one-component-per-file
      {
        name: 'VbenParentModal',
        inheritAttrs: false,
      },
    );

    return [Modal, extendedApi as ExtendedModalApi] as const;
  }

  let injectData: UserModalInjectData = inject<UserModalInjectData>(
    USER_MODAL_INJECT_KEY,
    { consumed: false, options: {} },
  );
  // 这个数据已经被使用了，说明这个弹窗是嵌套的弹窗，不应该merge上层的配置
  if (injectData.consumed) {
    injectData = { consumed: false, options: {} };
  } else {
    injectData.consumed = true;
  }

  const mergedOptions = {
    ...DEFAULT_MODAL_PROPS,
    ...injectData.options,
    ...options,
  } as ModalApiOptions;

  mergedOptions.onOpenChange = (isOpen: boolean) => {
    options.onOpenChange?.(isOpen);
    injectData.options?.onOpenChange?.(isOpen);
  };

  const onClosed = mergedOptions.onClosed;
  mergedOptions.onClosed = () => {
    onClosed?.();
    if (mergedOptions.destroyOnClose) {
      injectData.consumed = false;
      injectData.reCreateModal?.();
    }
  };

  const api = new ModalApi(mergedOptions);

  const extendedApi: ExtendedModalApi = api as never;

  extendedApi.useStore = (selector) => {
    return useStore(api.store, selector);
  };

  /**
   * 直接内嵌模式下的弹窗组件：把 props 与 attrs 透传给 modal.vue，
   * 并把自己的 api 一起传下去，模板侧只管渲染、状态全部走 api。
   */
  const Modal = defineComponent(
    (props: ModalProps, { attrs, slots }) => {
      const modalProps = {
        ...props,
        ...attrs,
        modalApi: extendedApi,
      } as InstanceType<typeof VbenModal>['$props'];
      return () => h(VbenModal, modalProps, slots);
    },
    // eslint-disable-next-line vue/one-component-per-file
    {
      name: 'VbenModal',
      inheritAttrs: false,
    },
  );
  injectData.extendApi?.(extendedApi);

  return [Modal, extendedApi] as const;
}

/**
 * 校验 connectedComponent 模式下外部传入的 props 是否与弹窗状态键冲突。
 *
 * props、attrs 与 slots 会被合并后透传给内部弹窗，若其中包含状态字段会绕过 api 直接改状态，
 * 导致回调与状态不同步，因此这里逐个比对并告警。只提示不阻断，保持向后兼容。
 *
 * @param api 内层弹窗暴露的 api，用于读取当前状态键集合
 * @param attrs 外部组件实际传入的 props、attrs 与 slots 合并结果
 */
async function checkProps(
  api: ExtendedModalApi,
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
      // connectedComponent存在时，不要传入Modal的props，会造成复杂度提升，如果你需要修改Modal的props，请使用 useModal 或者api
      console.warn(
        `[Vben Modal]: When 'connectedComponent' exists, do not set props or slots '${attr}', which will increase complexity. If you need to modify the props of Modal, please use useVbenModal or api.`,
      );
    }
  }
}
