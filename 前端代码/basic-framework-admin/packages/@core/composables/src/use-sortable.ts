/**
 * 拖拽排序封装：按需动态加载 sortablejs 完整版，为容器创建 Sortable 实例。
 * initializeSortable 由调用方在容器就绪后触发，默认动画 300ms、长按 400ms，
 * 调用方 options 可覆盖；拖拽结束后的数据落库与列表同步不归本模块负责。
 */
import type { SortableOptions } from 'sortablejs';
import type Sortable from 'sortablejs';

/**
 * 为容器创建拖拽排序实例，sortablejs 完整版在调用时才动态加载，避免进入首屏包。
 * @param sortableContainer - 需要开启拖拽的容器元素，需已挂载到文档中。
 * @param options - Sortable 选项，会覆盖默认的 300ms 动画与 400ms 长按延时。
 * @returns 含 initializeSortable 的对象；调用它才会真正加载依赖并创建实例。
 */
function useSortable<T extends HTMLElement>(
  sortableContainer: T,
  options: SortableOptions = {},
) {
  /** 动态加载 sortablejs 并按默认动画、长按参数为容器创建实例。 */
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
