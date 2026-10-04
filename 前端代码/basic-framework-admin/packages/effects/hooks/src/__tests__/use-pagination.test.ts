/**
 * 前端分页 composable（@vben/hooks 的 use-pagination）真实行为回归。
 *
 * 该 composable 负责把列表切成当前页并维护页码：切片边界写错会让最后一页缺记录，
 * 页码校验写松会静默返回空数组，列表变化后不回到首页会让用户停在空页上。
 * 用例用真实响应式列表驱动，断言切片结果、总数、翻页与每页条数变更后的状态，
 * 并覆盖三类非法输入（页码超界、每页条数非法、直接写入暴露的页码 ref）。
 */
import { nextTick, ref } from 'vue';

import { describe, expect, it } from 'vitest';

import { usePagination } from '../use-pagination';

/**
 * 建立一段连续的整数列表，便于按值核对切片。
 * @param size 列表长度，从 1 开始连续编号。
 * @returns 值为 1..size 的响应式列表。
 */
function createList(size: number) {
  return ref(
    Array.from(
      { length: size },
      /** 按序号生成从 1 开始的元素。 */ (_, index) => index + 1,
    ),
  );
}

describe('usePagination', /** 切片边界、页码校验与列表变化后的状态。 */ () => {
  it('按当前页与每页条数切片', /** 切片区间写错会让某页内容与页码不符。 */ () => {
    const list = createList(5);
    const { currentPage, paginationList, total } = usePagination(list, 2);

    expect(currentPage.value).toBe(1);
    expect(total.value).toBe(5);
    expect(paginationList.value).toEqual([1, 2]);
  });

  it('最后一页只返回剩余记录', /** 越过末尾时不能补空位或多切记录。 */ () => {
    const list = createList(5);
    const { paginationList, setCurrentPage } = usePagination(list, 2);

    setCurrentPage(3);

    expect(paginationList.value).toEqual([5]);
  });

  it('超出总页数的页码被拒绝', /** 静默接受越界页码会让用户看到空列表而不是错误。 */ () => {
    const list = createList(5);
    const { currentPage, setCurrentPage } = usePagination(list, 2);

    expect(/** 越界页码必须抛错。 */ () => setCurrentPage(4)).toThrow(
      'Invalid page number',
    );
    expect(currentPage.value).toBe(1);
  });

  it('空列表允许停留在第一页', /** 空数据是正常状态，不能因为总页数为 0 而抛错。 */ () => {
    const list = createList(0);
    const { currentPage, paginationList, setCurrentPage, total } =
      usePagination(list, 10);

    setCurrentPage(1);

    expect(currentPage.value).toBe(1);
    expect(total.value).toBe(0);
    expect(paginationList.value).toEqual([]);
  });

  it('每页条数非法时抛出且不改变状态', /** 每页条数被写成 0 会让切片抛错，必须在入口拦住并保留原值。 */ () => {
    const list = createList(5);
    const { currentPage, paginationList, setCurrentPage, setPageSize } =
      usePagination(list, 2);
    setCurrentPage(2);

    expect(/** 非法每页条数必须抛错。 */ () => setPageSize(0)).toThrow(
      'Page size must be positive',
    );
    expect(paginationList.value).toEqual([3, 4]);

    setPageSize(4);

    // 每页条数变化后回到第一页，避免原页码在新分页下越界。
    expect(currentPage.value).toBe(1);
    expect(paginationList.value).toEqual([1, 2, 3, 4]);
    expect(/** 新分页下的越界页码必须抛错。 */ () => setCurrentPage(3)).toThrow(
      'Invalid page number',
    );
  });

  it('总页数为 0 时直接写入页码 ref 会被切片拦住', /** 暴露的 ref 可被调用方直接写，切片函数必须自己守住参数边界。 */ () => {
    const list = createList(0);
    const { currentPage, paginationList } = usePagination(list, 10);

    currentPage.value = 0;

    expect(
      /** 直接写入的非法页码必须由切片拦住。 */ () => paginationList.value,
    ).toThrow('Page number must be positive');
  });

  it('每页条数直接写成 0 时切片抛出', /** 入参校验只在 setPageSize，构造时的非法值必须由切片拦住。 */ () => {
    const list = createList(3);
    const { paginationList } = usePagination(list, 0);

    expect(
      /** 构造时的非法每页条数必须由切片拦住。 */ () => paginationList.value,
    ).toThrow('Page size must be positive');
  });

  it('开启总数变化回到首页时列表变化后重置页码', /** 过滤条件变化后停在旧页码会让用户看到空页。 */ async () => {
    const list = createList(6);
    const { currentPage, paginationList, setCurrentPage, total } =
      usePagination(list, 2);
    setCurrentPage(3);

    list.value = [1, 2, 3, 4];
    await nextTick();

    expect(total.value).toBe(4);
    expect(currentPage.value).toBe(1);
    expect(paginationList.value).toEqual([1, 2]);
  });

  it('关闭总数变化回到首页时保留当前页码', /** 需要保持浏览位置时不能被强制重置。 */ async () => {
    const list = createList(6);
    const { currentPage, paginationList, setCurrentPage } = usePagination(
      list,
      2,
      false,
    );
    setCurrentPage(2);

    list.value = [1, 2, 3, 4, 5, 6, 7];
    await nextTick();

    expect(currentPage.value).toBe(2);
    expect(paginationList.value).toEqual([3, 4]);
  });
});
