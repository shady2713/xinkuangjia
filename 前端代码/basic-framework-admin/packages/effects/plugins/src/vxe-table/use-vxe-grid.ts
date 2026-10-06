/**
 * 表格组件工厂：按配置创建 VxeGridApi 并派生带 useStore 选择器的 extendedApi，
 * 再包出 VbenVxeGrid 组件，同步属性与插槽并在卸载时通知 api。
 * 返回 [组件, api] 元组，界面渲染仍由 use-vxe-grid.vue 承担。
 */
import type { VxeGridSlots, VxeGridSlotTypes } from 'vxe-table';

import type { SlotsType } from 'vue';

import type { BaseFormComponentType } from '@vben-core/form-ui';

import type { ExtendedVxeGridApi, VxeGridProps } from './types';

import { defineComponent, h, onBeforeUnmount } from 'vue';

import { useStore } from '@vben-core/shared/store';

import { VxeGridApi } from './api';
import VxeGrid from './use-vxe-grid.vue';

type FilteredSlots<T> = {
  [K in keyof VxeGridSlots<T> as K extends 'form'
    ? never
    : K]: VxeGridSlots<T>[K];
};

/**
 * 创建 VxeGrid 表格组件及其 API 实例的 composable 函数
 * @param options 表格配置，表格行类型由 T 指定
 * @returns 表格组件、API 实例以及默认插槽的类型声明
 */
export function useVbenVxeGrid<
  T extends object = Record<string, unknown>,
  D extends BaseFormComponentType = BaseFormComponentType,
>(options: VxeGridProps<T, D>) {
  const api = new VxeGridApi(options);
  const extendedApi: ExtendedVxeGridApi<T, D> = api as ExtendedVxeGridApi<T, D>;
  extendedApi.useStore = (selector) => {
    return useStore(api.store, selector);
  };

  const Grid = defineComponent(
    (props: VxeGridProps<T>, { attrs, slots }) => {
      onBeforeUnmount(() => {
        api.unmount();
      });
      api.setState({ ...props, ...attrs } as Partial<VxeGridProps<T, D>>);
      const gridProps = {
        ...props,
        ...attrs,
        api: extendedApi,
      } as InstanceType<typeof VxeGrid>['$props'];
      return () => h(VxeGrid, gridProps, slots);
    },
    {
      name: 'VbenVxeGrid',
      inheritAttrs: false,
      slots: Object as SlotsType<
        {
          // 表格标题；插槽由使用方按需提供，类型上保持可选
          'table-title'?: undefined;
          // 工具栏左侧部分
          'toolbar-actions'?: VxeGridSlotTypes.DefaultSlotParams<T>;
          // 工具栏右侧部分
          'toolbar-tools'?: VxeGridSlotTypes.DefaultSlotParams<T>;
        } & FilteredSlots<T>
      >,
    },
  );

  return [Grid, extendedApi] as const;
}

export type UseVbenVxeGrid = typeof useVbenVxeGrid;
