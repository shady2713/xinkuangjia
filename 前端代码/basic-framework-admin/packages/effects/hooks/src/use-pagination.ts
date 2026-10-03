import type { Ref } from 'vue';

import { computed, ref, unref, watch } from 'vue';

/**
 * 对数组按页码和每页条数做切片。
 * @param list 待切片的数组。
 * @param pageNo 当前页码，从 1 开始。
 * @param pageSize 每页条数。
 * @returns 当前页对应的数组切片；页码或每页条数非法时抛出 Error。
 * @throws 页码小于 1 或每页条数小于 1 时抛出 Error，避免静默返回空数组掩盖调用方错误。
 */
function pagination<T = unknown>(
  list: T[],
  pageNo: number,
  pageSize: number,
): T[] {
  if (pageNo < 1) throw new Error('Page number must be positive');
  if (pageSize < 1) throw new Error('Page size must be positive');

  const offset = (pageNo - 1) * Number(pageSize);
  const ret =
    offset + pageSize >= list.length
      ? list.slice(offset)
      : list.slice(offset, offset + pageSize);
  return ret;
}

/**
 * 对列表做前端分页，并暴露翻页所需的响应式状态。
 * 分页结果只做切片，不解释元素含义，因此元素类型未指定时按 unknown 占位。
 * @param list 待分页的响应式列表。
 * @param pageSize 每页条数，初始值。
 * @param totalChangeToFirstPage 列表总数变化时是否回到第一页。
 * @returns 当前页、每页条数、总数、当前页切片以及翻页方法。
 */
export function usePagination<T = unknown>(
  list: Ref<T[]>,
  pageSize: number,
  totalChangeToFirstPage = true,
) {
  const currentPage = ref(1);
  const pageSizeRef = ref(pageSize);

  const totalPages = computed(() =>
    Math.ceil(unref(list).length / unref(pageSizeRef)),
  );

  const paginationList = computed(() => {
    return pagination(unref(list), unref(currentPage), unref(pageSizeRef));
  });

  const total = computed(() => {
    return unref(list).length;
  });

  if (totalChangeToFirstPage) {
    watch(total, () => {
      setCurrentPage(1);
    });
  }

  function setCurrentPage(page: number) {
    if (page === 1 && unref(totalPages) === 0) {
      currentPage.value = 1;
    } else {
      if (page < 1 || page > unref(totalPages)) {
        throw new Error('Invalid page number');
      }
      currentPage.value = page;
    }
  }

  function setPageSize(pageSize: number) {
    if (pageSize < 1) {
      throw new Error('Page size must be positive');
    }
    pageSizeRef.value = pageSize;
    // Reset to first page to prevent invalid state
    currentPage.value = 1;
  }

  return { setCurrentPage, total, setPageSize, paginationList, currentPage };
}
