import type { Component, VNode } from 'vue';

import type { Recordable } from '@vben-core/typings';

import type { AlertProps, BeforeCloseScope, PromptProps } from './alert';

import { h, nextTick, ref, render } from 'vue';

import { useSimpleLocale } from '@vben-core/composables';
import { Input, VbenRenderContent } from '@vben-core/shadcn-ui';
import { isFunction, isString } from '@vben-core/shared/utils';

import Alert from './alert.vue';

const alerts = ref<Array<{ container: HTMLElement; instance: Component }>>([]);

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
 * 打开通用提示框，并在确认或关闭后结束 Promise。
 * @param arg0 提示内容，或完整的提示框属性
 * @param arg1 标题，或要合并的提示框属性
 * @param arg2 前两个参数分别为内容和标题时要合并的属性
 * @returns 用户确认后兑现；关闭且未确认时拒绝
 */
export function vbenAlert(
  arg0: AlertProps | string,
  arg1?: Partial<AlertProps> | string,
  arg2?: Partial<AlertProps>,
): Promise<void> {
  return new Promise(
    /**
     * 挂载提示框，并在确认或取消时结束 Promise。
     * @param resolve 用户确认时兑现
     * @param reject 用户关闭且未确认时拒绝
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
      const alertRef = { container, instance: null as any };

      let isConfirmed = false;
      let isSettled = false;

      /** 卸载当前提示框并从队列中移除。 */
      function dispose() {
        if (!container.parentNode) {
          return;
        }
        alerts.value = alerts.value.filter(
          /** 去掉当前正在关闭的提示框实例。 */
          (item) => item !== alertRef,
        );
        render(null, container);
        container.remove();
      }

      /** 用户确认后兑现 Promise 并清理容器。 */
      function doResolve() {
        if (isSettled) {
          return;
        }
        isSettled = true;
        isConfirmed = true;
        dispose();
        resolve();
      }

      /** 用户关闭且未确认时拒绝 Promise 并清理容器。 */
      function doReject() {
        if (isSettled) {
          return;
        }
        isSettled = true;
        dispose();
        reject(new Error('dialog cancelled'));
      }

      const props: AlertProps & Recordable<any> = {
        onConfirm: doResolve,
        /** 对话框关闭后：已确认则只清理容器，否则按取消拒绝。 */
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

export async function vbenPrompt<T = any>(
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

  const props: AlertProps & Recordable<any> = {
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
