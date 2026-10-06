/**
 * 加载指令：注册 v-loading 与 v-spinning，在绑定元素内挂载
 * 对应加载组件，并在指令值变化时同步组件属性。
 * 指令会给宿主加上相对定位类，卸载时销毁实例并移除该类；
 * 传入布尔值控制显隐，传对象则作为组件属性透传。
 * 只管理遮罩的挂载与更新，请求发起与失败提示由调用方负责。
 */
import type { App, Directive, DirectiveBinding } from 'vue';

import { h, render } from 'vue';

import { VbenLoading, VbenSpinner } from '@vben-core/shadcn-ui';
import { isString } from '@vben-core/shared/utils';

const LOADING_INSTANCE_KEY = Symbol('loading');
const SPINNER_INSTANCE_KEY = Symbol('spinner');

const CLASS_NAME_RELATIVE = 'spinner-parent--relative';

const loadingDirective: Directive = {
  /**
   * 挂载时把加载遮罩渲染进宿主元素，并给宿主加上相对定位类。
   * @param el 指令绑定的宿主元素；遮罩渲染到该元素内部，实例记录在元素上。
   * @param binding 指令绑定信息，其 value 决定遮罩的显示状态与属性。
   */
  mounted(el, binding) {
    const instance = h(VbenLoading, getOptions(binding));
    render(instance, el);

    el.classList.add(CLASS_NAME_RELATIVE);
    el[LOADING_INSTANCE_KEY] = instance;
  },
  /**
   * 卸载时移除相对定位类、卸载虚拟节点并摘掉遮罩 DOM。
   * @param el 指令绑定的宿主元素，其上记录的遮罩实例会被一并清理。
   */
  unmounted(el) {
    const instance = el[LOADING_INSTANCE_KEY];
    el.classList.remove(CLASS_NAME_RELATIVE);
    render(null, el);
    instance.el.remove();

    el[LOADING_INSTANCE_KEY] = null;
  },

  /**
   * 指令值变化时把新属性写入遮罩组件并触发更新；组件实例尚未就绪时跳过。
   * @param el 指令绑定的宿主元素，用于取出已挂载的遮罩实例。
   * @param binding 指令绑定信息，其 value 会被转换为组件属性。
   */
  updated(el, binding) {
    const instance = el[LOADING_INSTANCE_KEY];
    const options = getOptions(binding);
    if (options && instance?.component) {
      try {
        Object.keys(options).forEach((key) => {
          instance.component.props[key] = options[key];
        });
        instance.component.update();
      } catch (error) {
        console.error(
          'Failed to update loading component in directive:',
          error,
        );
      }
    }
  },
};

/**
 * 把指令值转换为加载组件的属性。
 * @param binding 指令绑定信息：未传值时默认显示，传布尔值只控制显隐，传对象则整体作为属性透传。
 * @returns 传给加载组件的属性对象。
 */
function getOptions(binding: DirectiveBinding) {
  if (binding.value === undefined) {
    return { spinning: true };
  } else if (typeof binding.value === 'boolean') {
    return { spinning: binding.value };
  } else {
    return { ...binding.value };
  }
}

const spinningDirective: Directive = {
  /**
   * 挂载时把旋转动画挂载进宿主元素，并给宿主加上相对定位类。
   * @param el 指令绑定的宿主元素；动画渲染到该元素内部，实例记录在元素上。
   * @param binding 指令绑定信息，其 value 决定动画的显示状态与属性。
   */
  mounted(el, binding) {
    const instance = h(VbenSpinner, getOptions(binding));
    render(instance, el);

    el.classList.add(CLASS_NAME_RELATIVE);
    el[SPINNER_INSTANCE_KEY] = instance;
  },
  /**
   * 卸载时移除相对定位类、卸载虚拟节点并摘掉动画 DOM。
   * @param el 指令绑定的宿主元素，其上记录的动画实例会被一并清理。
   */
  unmounted(el) {
    const instance = el[SPINNER_INSTANCE_KEY];
    el.classList.remove(CLASS_NAME_RELATIVE);
    render(null, el);
    instance.el.remove();

    el[SPINNER_INSTANCE_KEY] = null;
  },

  /**
   * 指令值变化时把新属性写入动画组件并触发更新；组件实例尚未就绪时跳过。
   * @param el 指令绑定的宿主元素，用于取出已挂载的动画实例。
   * @param binding 指令绑定信息，其 value 会被转换为组件属性。
   */
  updated(el, binding) {
    const instance = el[SPINNER_INSTANCE_KEY];
    const options = getOptions(binding);
    if (options && instance?.component) {
      try {
        Object.keys(options).forEach((key) => {
          instance.component.props[key] = options[key];
        });
        instance.component.update();
      } catch (error) {
        console.error(
          'Failed to update spinner component in directive:',
          error,
        );
      }
    }
  },
};

/** 加载指令注册参数：分别控制 loading 与 spinning 指令是否注册，或改用自定义指令名。 */
type loadingDirectiveParams = {
  /** 是否注册loading指令。如果提供一个string，则将指令注册为指定的名称 */
  loading?: boolean | string;
  /** 是否注册spinning指令。如果提供一个string，则将指令注册为指定的名称 */
  spinning?: boolean | string;
};

/**
 * 注册loading指令
 * 同时向文档注入遮罩所需的相对定位样式，并支持把指令注册为自定义名称。
 * @param app 目标 Vue 应用实例，指令只注册到该实例上。
 * @param params 注册参数；不传时两条指令都会注册，传 false 可跳过对应指令。
 */
export function registerLoadingDirective(
  app: App,
  params?: loadingDirectiveParams,
) {
  // 注入一个样式供指令使用，确保容器是相对定位
  const style = document.createElement('style');
  style.id = CLASS_NAME_RELATIVE;
  style.innerHTML = `
    .${CLASS_NAME_RELATIVE} {
      position: relative !important;
    }
  `;
  document.head.append(style);
  if (params?.loading !== false) {
    app.directive(
      isString(params?.loading) ? params.loading : 'loading',
      loadingDirective,
    );
  }
  if (params?.spinning !== false) {
    app.directive(
      isString(params?.spinning) ? params.spinning : 'spinning',
      spinningDirective,
    );
  }
}
