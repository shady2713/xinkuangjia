/**
 * 命令式弹窗入口：在调用处即时创建容器并渲染 alert.vue，
 * 用 Promise 把确认或取消的结果交回调用方。
 * vbenPrompt 默认用框架 Input 接收输入并自动聚焦；
 * clearAllAlerts 在路由切换后卸载残留弹窗。
 * 只负责创建与销毁编排，不做权限与业务校验。
 */
import type { Component, VNode } from 'vue';

import type { Recordable } from '@vben-core/typings';

import type { AlertProps, BeforeCloseScope, PromptProps } from './alert';

import { h, nextTick, ref, render } from 'vue';

import { useSimpleLocale } from '@vben-core/composables';
import { Input, VbenRenderContent } from '@vben-core/shadcn-ui';
import { isFunction, isString } from '@vben-core/shared/utils';

import Alert from './alert.vue';

/**
 * 当前打开的命令式弹窗登记簿。
 * 记录容器与组件实例，`clearAllAlerts` 依赖它批量卸载页面切换时残留的弹窗。
 */
const alerts = ref<
  Array<{ container: HTMLElement; instance: Component | null }>
>([]);

const { $t } = useSimpleLocale();

export function vbenAlert(options: AlertProps): Promise<void>;
export function vbenAlert(
  message: string,
  options?: Partial<AlertProps>,
): Promise<void>;
export function vbenAlert(
  message: string,
  title?: string,
  options?: Partial<AlertProps>,
): Promise<void>;

/**
 * 弹出一个命令式 Alert，关闭后 Promise 兑现。
 * 参数顺序同时兼容"只传文案""文案加选项""文案加标题加选项"三种历史调用方式。
 * @param arg0 完整选项对象，或直接作为提示内容的文案。
 * @param arg1 标题文案，或需要合并进选项的部分选项。
 * @param arg2 标题已由 arg1 给出时使用的补充选项。
 * @returns 用户确认关闭后兑现；弹窗被取消时以 `dialog cancelled` 拒绝。
 */
export function vbenAlert(
  arg0: AlertProps | string,
  arg1?: Partial<AlertProps> | string,
  arg2?: Partial<AlertProps>,
): Promise<void> {
  return new Promise(
    /**
     * 在 Promise 内部完成容器创建、渲染与结果结算，
     * 用 isSettled 保证确认与关闭回调先后到达时只结算一次。
     * @param resolve 弹窗被确认时调用，兑现外层 Promise。
     * @param reject 弹窗被取消时调用，以 `dialog cancelled` 拒绝外层 Promise。
     */
    (resolve, reject) => {
      const options: AlertProps = isString(arg0)
        ? {
            content: arg0,
          }
        : { ...arg0 };
      if (arg1) {
        if (isString(arg1)) {
          options.title = arg1;
        } else if (!isString(arg1)) {
          // 如果第二个参数是对象，则合并到选项中
          Object.assign(options, arg1);
        }
      }

      if (arg2 && !isString(arg2)) {
        Object.assign(options, arg2);
      }
      // 创建容器元素
      const container = document.createElement('div');
      document.body.append(container);

      // 创建一个引用，用于在回调中访问实例
      const alertRef: {
        container: HTMLElement;
        instance: Component | null;
      } = { container, instance: null };

      let isConfirmed = false;
      let isSettled = false;

      /**
       * 卸载弹窗：先从登记簿摘除，再卸载渲染并移除容器。
       * 容器已不在文档中时直接返回，保证重复调用是安全的。
       */
      function dispose() {
        if (!container.parentNode) {
          return;
        }
        alerts.value = alerts.value.filter(
          /**
           * 只保留不是当前弹窗的记录，避免登记簿持有已销毁的容器。
           * @param item 登记簿中的一条弹窗记录。
           */
          (item) => item !== alertRef,
        );
        render(null, container);
        container.remove();
      }

      /**
       * 确认分支：置位已结算后销毁弹窗并兑现 Promise。
       * 关闭动画会再触发一次 onClosed，isSettled 保证不会二次兑现。
       */
      function doResolve() {
        if (isSettled) {
          return;
        }
        isSettled = true;
        isConfirmed = true;
        dispose();
        resolve();
      }

      /**
       * 取消分支：置位已结算后销毁弹窗，并以固定原因拒绝 Promise。
       * 遮罩点击、ESC 关闭都走这里，调用方据此区分取消与异常。
       */
      function doReject() {
        if (isSettled) {
          return;
        }
        isSettled = true;
        dispose();
        reject(new Error('dialog cancelled'));
      }

      const props: AlertProps & Recordable<unknown> = {
        onConfirm: doResolve,
        /**
         * 关闭动画结束后结算：确认过的按确认处理，未确认的一律按取消处理，
         * 避免用户直接点遮罩关闭时 Promise 一直悬挂。
         */
        onClosed: () => {
          if (isConfirmed) {
            dispose();
          } else {
            doReject();
          }
        },
        ...options,
        open: true,
        title: options.title ?? $t.value('prompt'),
      };

      // 创建Alert组件的VNode
      const vnode = h(Alert, props);

      // 渲染组件到容器
      render(vnode, container);

      // 保存组件实例引用
      alertRef.instance = vnode.component?.proxy as Component;

      // 将实例和容器添加到alerts数组中
      alerts.value.push(alertRef);
    },
  );
}

export function vbenConfirm(options: AlertProps): Promise<void>;
export function vbenConfirm(
  message: string,
  options?: Partial<AlertProps>,
): Promise<void>;
export function vbenConfirm(
  message: string,
  title?: string,
  options?: Partial<AlertProps>,
): Promise<void>;

export function vbenConfirm(
  arg0: AlertProps | string,
  arg1?: Partial<AlertProps> | string,
  arg2?: Partial<AlertProps>,
): Promise<void> {
  const defaultProps: Partial<AlertProps> = {
    showCancel: true,
  };
  if (!arg1) {
    return isString(arg0)
      ? vbenAlert(arg0, defaultProps)
      : vbenAlert({ ...defaultProps, ...arg0 });
  } else if (!arg2) {
    return isString(arg1)
      ? vbenAlert(arg0 as string, arg1, defaultProps)
      : vbenAlert(arg0 as string, { ...defaultProps, ...arg1 });
  }
  return vbenAlert(arg0 as string, arg1 as string, {
    ...defaultProps,
    ...arg2,
  });
}

/**
 * 弹出一个带输入框的命令式弹窗，关闭后返回输入结果。
 * 输入组件可由调用方替换，默认使用框架内的 Input；
 * 弹窗打开后会尽力把焦点落到输入控件上，减少用户额外的点击成本。
 * @param options 弹窗选项；`T` 决定输入值与返回值的类型。
 * @returns 用户确认时的输入值；取消时为 undefined。
 */
export async function vbenPrompt<T = unknown>(
  options: PromptProps<T>,
): Promise<T | undefined> {
  const {
    component: _component,
    componentProps: _componentProps,
    componentSlots,
    content,
    defaultValue,
    modelPropName: _modelPropName,
    ...delegated
  } = options;

  const modelValue = ref<T | undefined>(defaultValue);
  const inputComponentRef = ref<null | VNode>(null);
  const staticContents: Component[] = [
    h(VbenRenderContent, { content, renderBr: true }),
  ];

  const modelPropName = _modelPropName || 'modelValue';
  const componentProps = { ..._componentProps };

  // 每次渲染时都会重新计算的内容函数
  const contentRenderer = () => {
    const currentProps = {
      ...componentProps,
      [modelPropName]: modelValue.value,
      [`onUpdate:${modelPropName}`]: (val: T) => {
        modelValue.value = val;
      },
    };

    // 设置当前值

    // 设置更新处理函数

    // 创建输入组件
    inputComponentRef.value = h(
      _component || Input,
      currentProps,
      componentSlots,
    );

    // 返回包含静态内容和输入组件的数组
    return h(
      'div',
      { class: 'flex flex-col gap-2' },
      { default: () => [...staticContents, inputComponentRef.value] },
    );
  };

  const props: AlertProps & Recordable<unknown> = {
    ...delegated,
    async beforeClose(scope: BeforeCloseScope) {
      if (delegated.beforeClose) {
        return await delegated.beforeClose({
          ...scope,
          value: modelValue.value,
        });
      }
    },
    // 使用函数形式，每次渲染都会重新计算内容
    content: contentRenderer,
    contentMasking: true,
    async onOpened() {
      await nextTick();
      const componentRef: null | VNode = inputComponentRef.value;
      if (componentRef) {
        if (
          componentRef.component?.exposed &&
          isFunction(componentRef.component.exposed.focus)
        ) {
          componentRef.component.exposed.focus();
        } else {
          if (componentRef.el) {
            if (
              isFunction(componentRef.el.focus) &&
              ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(
                componentRef.el.tagName,
              )
            ) {
              componentRef.el.focus();
            } else if (isFunction(componentRef.el.querySelector)) {
              const focusableElement = componentRef.el.querySelector(
                'input, select, textarea, button',
              );
              if (focusableElement && isFunction(focusableElement.focus)) {
                focusableElement.focus();
              }
            } else if (
              componentRef.el.nextElementSibling &&
              isFunction(componentRef.el.nextElementSibling.focus)
            ) {
              componentRef.el.nextElementSibling.focus();
            }
          }
        }
      }
    },
  };

  await vbenConfirm(props);
  return modelValue.value;
}

export function clearAllAlerts() {
  alerts.value.forEach((alert) => {
    // 从DOM中移除容器
    render(null, alert.container);
    if (alert.container.parentNode) {
      alert.container.remove();
    }
  });
  alerts.value = [];
}
