/**
 * 拖拽排序封装：按需动态加载 sortablejs 完整版，为容器创建 Sortable 实例。
 * initializeSortable 由调用方在容器就绪后触发，默认动画 300ms、长按 400ms，
 * 调用方 options 可覆盖；拖拽结束后的数据落库与列表同步不归本模块负责。
 */
import type { SortableOptions } from 'sortablejs';
import type Sortable from 'sortablejs';

function useSortable<T extends HTMLElement>(
  sortableContainer: T,
  options: SortableOptions = {},
) {
  const initializeSortable = async () => {
    const Sortable = await import(
      // @ts-expect-error - This is a dynamic import
      'sortablejs/modular/sortable.complete.esm.js'
    );
    const sortable = Sortable?.default?.create?.(sortableContainer, {
      animation: 300,
      delay: 400,
      delayOnTouchOnly: true,
      ...options,
    });
    return sortable as Sortable;
  };

  return {
    initializeSortable,
  };
}

export { useSortable };

export type { Sortable };
