import type { VxeGridProps, VxeUIExport } from 'vxe-table';

import type { Recordable } from '@vben/types';

import type { VxeGridApi } from './api';

import { formatDate, formatDateTime, isFunction } from '@vben/utils';

/**
 * 读取当前搜索表单值的回调，由调用方提供。
 * 扩展层在每次代理请求前调用一次，把表单条件合并进请求参数，
 * 因此必须在调用时返回最新值而不是初始化时的快照。
 * @returns 当前搜索表单的键值集合。
 */
type GetFormValues = () => Recordable<unknown>;

/**
 * 扩展 VxeGrid 代理配置，自动将搜索表单值注入到代理请求参数中。
 * 逐个包装 query 与 queryAll 两条链路的全部回调，
 * 让刷新按钮触发的请求也带上当前表单条件，而不是退回上次查询条件。
 * @param api 网格实例，用于把包装后的代理配置写回内部状态。
 * @param options 网格配置，从中读取各 ajax 回调的原始实现。
 * @param getFormValues 读取当前搜索表单值的回调，每次请求前调用。
 */
export function extendProxyOptions(
  api: VxeGridApi,
  options: VxeGridProps,
  getFormValues: GetFormValues,
) {
  [
    'query',
    'querySuccess',
    'queryError',
    'queryAll',
    'queryAllSuccess',
    'queryAllError',
  ].forEach(
    /**
     * 逐个代理回调名套上同一层表单值注入，缺失的回调会在包装函数内直接跳过。
     * @param key 当前要包装的 ajax 回调名。
     */
    (key) => {
      extendProxyOption(key, api, options, getFormValues);
    },
  );
}

/**
 * 包装单个 ajax 回调，使其在调用时自动附加当前搜索表单值。
 * 原配置里没有该回调时不做任何修改，调用方拿到的仍是原 options。
 * @param key 当前要包装的 ajax 回调名。
 * @param api 网格实例，用于把包装后的代理配置写回内部状态。
 * @param options 网格配置，从中读取该回调的原始实现。
 * @param getFormValues 读取当前搜索表单值的回调，每次请求前调用。
 */
function extendProxyOption(
  key: string,
  api: VxeGridApi,
  options: VxeGridProps,
  getFormValues: GetFormValues,
) {
  const { proxyConfig } = options;
  const configFn = (proxyConfig?.ajax as Recordable<unknown>)?.[key];
  if (!isFunction(configFn)) {
    return options;
  }

  /**
   * 转发原回调并补上表单条件；原回调抛错时异常原样向上传递，不在这里吞掉。
   * @param params vxe-table 组装的本次请求参数。
   * @param customValues 触发本次请求的自定义参数，刷新按钮场景下会是 PointerEvent。
   * @param args 原回调可能收到的其余位置参数，原样透传。
   * @returns 原回调的响应结果。
   */
  const wrapperFn = async (
    params: Recordable<unknown>,
    customValues: Recordable<unknown>,
    ...args: Recordable<unknown>[]
  ) => {
    const formValues = getFormValues();
    const data = await configFn(
      params,
      {
        /**
         * 开启toolbarConfig.refresh功能
         * 点击刷新按钮 这里的值为PointerEvent 会携带错误参数
         */
        ...(customValues instanceof PointerEvent ? {} : customValues),
        ...formValues,
      },
      ...args,
    );
    return data;
  };
  api.setState({
    gridOptions: {
      proxyConfig: {
        ajax: {
          [key]: wrapperFn,
        },
      },
    },
  });
}

export function extendsDefaultFormatter(vxeUI: VxeUIExport) {
  vxeUI.formats.add('formatDate', {
    tableCellFormatMethod({ cellValue }) {
      return formatDate(cellValue) as string;
    },
  });

  vxeUI.formats.add('formatDateTime', {
    tableCellFormatMethod({ cellValue }) {
      return formatDateTime(cellValue) as string;
    },
  });
}
