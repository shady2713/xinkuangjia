/**
 * 标签页拖拽排序组合式函数：在标签栏容器挂载 sortable。
 * 只查找容器、过滤固定标签与不可拖拽项，并在样式切换或卸载时销毁实例；
 * 移动端不注册拖拽，排序结果经 sortTabs 交给上层实际调整标签顺序。
 */
import type { Sortable } from '@vben-core/composables';
import type { EmitType } from '@vben-core/typings';

import type { TabsProps } from './types';

import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { useIsMobile, useSortable } from '@vben-core/composables';

/**
 * sortablejs 的 onEnd 事件在运行时附带 originalEvent（原生鼠标/触摸事件），
 * 但 @types/sortablejs 未声明该字段，这里按实际读取的形状局部补齐，不放宽整体类型。
 */
type SortableEndEvent = {
  originalEvent?: { srcElement?: HTMLElement };
};

// 可能会找到拖拽的子元素，这里需要确保拖拽的dom时tab元素
function findParentElement(element: HTMLElement) {
  const parentCls = 'group';
  return element.classList.contains(parentCls)
    ? element
    : element.closest(`.${parentCls}`);
}

/**
 * 为标签页启用拖拽排序，并把拖拽结果交给调用方更新顺序。
 * 排序实例只在本组件内部持有，调用方无需也不能读取；组件卸载时必须销毁它，
 * 否则 sortable 的全局监听会残留在已移除的 DOM 上。
 * 移动端不注册拖拽；样式切换时先销毁旧实例再按新容器重建。
 * @param props 标签页渲染属性，contentClass 决定排序容器的选择器。
 * @param emit 排序完成事件，载荷依次为来源下标与目标下标；顺序固定不可颠倒。
 */
export function useTabsDrag(
  props: TabsProps,
  emit: EmitType<'sortTabs', [number, number]>,
) {
  const sortableInstance = ref<null | Sortable>(null);

  /**
   * 在当前标签栏容器上初始化拖拽排序，并把排序结果交给调用方。
   * 容器尚未渲染时只告警不初始化，等待下一次调用。
   * @returns 初始化完成或提前结束的信号
   */
  async function initTabsSortable() {
    await nextTick();

    const el = document.querySelectorAll(
      `.${props.contentClass}`,
    )?.[0] as HTMLElement;

    if (!el) {
      console.warn('Element not found for sortable initialization');
      return;
    }

    /**
     * 复位拖拽期间的样式：光标恢复默认并摘掉标签上的 dragging 类，
     * 拖拽结束或校验未通过时调用，清掉 sortable 留下的视觉痕迹。
     */
    const resetElState = async () => {
      el.style.cursor = 'default';
      // el.classList.remove('dragging');
      el.querySelector('.draggable')?.classList.remove('dragging');
    };

    const { initializeSortable } = useSortable(el, {
      /**
       * 拖拽过滤：命中的目标不是可拖拽标签，或未开启 draggable 时一律拒绝，
       * 固定标签与标签栏空白处因此都拖不动。
       */
      filter: (_evt, target: HTMLElement) => {
        const parent = findParentElement(target);
        const draggable = parent?.classList.contains('draggable');
        return !draggable || !props.draggable;
      },
      /**
       * 拖拽结束回调：校验拖拽源确实落在可拖动的标签上，再把新旧下标交给调用方。
       * @param evt sortablejs 的拖拽结束事件
       * @param evt.newIndex 拖拽后的下标，无效时为 undefined
       * @param evt.oldIndex 拖拽前的下标，无效时为 undefined
       */
      onEnd(evt) {
        const { newIndex, oldIndex } = evt;
        // srcElement 取自原生事件，取不到时按"没有有效拖拽源"处理并复位，不抛出。
        const { srcElement } = (evt as SortableEndEvent).originalEvent ?? {};

        if (!srcElement) {
          resetElState();
          return;
        }

        const srcParent = findParentElement(srcElement);

        if (!srcParent) {
          resetElState();
          return;
        }

        if (!srcParent.classList.contains('draggable')) {
          resetElState();

          return;
        }

        if (
          oldIndex !== undefined &&
          newIndex !== undefined &&
          !Number.isNaN(oldIndex) &&
          !Number.isNaN(newIndex) &&
          oldIndex !== newIndex
        ) {
          emit('sortTabs', oldIndex, newIndex);
        }
        resetElState();
      },
      /**
       * 拖拽过程中判断能否落到当前位置：固定标签与非固定标签之间不允许互相跨越，
       * 其余可拖拽场景一律放行。
       * @param evt sortablejs 的移动事件，dragged 是被拖的标签，related 是当前指向的标签。
       * @returns 允许落到该位置为 true；指向的不是可拖拽标签或未开启拖拽时为 false。
       */
      onMove(evt) {
        const parent = findParentElement(evt.related);
        if (parent?.classList.contains('draggable') && props.draggable) {
          const isCurrentAffix = evt.dragged.classList.contains('affix-tab');
          const isRelatedAffix = evt.related.classList.contains('affix-tab');
          // 不允许在固定的tab和非固定的tab之间互相拖拽
          return isCurrentAffix === isRelatedAffix;
        } else {
          return false;
        }
      },
      /**
       * 拖拽开始：光标切成抓取态，并给标签加上 dragging 类供样式区分；
       * 标签尚未渲染时只改容器光标，不做额外处理。
       */
      onStart: () => {
        el.style.cursor = 'grabbing';
        el.querySelector('.draggable')?.classList.add('dragging');
        // el.classList.add('dragging');
      },
    });

    sortableInstance.value = await initializeSortable();
  }

  /**
   * 拖拽初始化入口：移动端不注册拖拽直接返回，其余情况等一次更新后按当前标签栏容器重建排序实例。
   */
  async function init() {
    const { isMobile } = useIsMobile();

    // 移动端下tab不需要拖拽
    if (isMobile.value) {
      return;
    }
    await nextTick();
    initTabsSortable();
  }

  onMounted(init);

  watch(
    () => props.styleType,
    () => {
      sortableInstance.value?.destroy();
      init();
    },
  );

  onUnmounted(() => {
    sortableInstance.value?.destroy();
  });
}
