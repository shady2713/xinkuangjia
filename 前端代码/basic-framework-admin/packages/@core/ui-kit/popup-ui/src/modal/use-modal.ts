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
    const Modal = defineComponent(
      (props: TParentModalProps, { attrs, slots }) => {
        provide(USER_MODAL_INJECT_KEY, {
          extendApi(api: ExtendedModalApi) {
            // 不能直接给 reactive 赋值，会丢失响应
            // 不能用 Object.assign,会丢失 api 的原型函数
            Object.setPrototypeOf(extendedApi, api);
          },
          consumed: false,
          options,
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
