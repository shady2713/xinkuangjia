/**
 * Iconify 图标集数据获取（icon-picker/icons）的缓存、去重与失败兜底契约回归。
 *
 * 图标选择器一次要拉取整包图标名：同一图标集在页面生命周期内只能请求一次，多个选择器
 * 同时打开时只能共享一次在途请求，否则会重复打满 Iconify 公共接口；拉取失败必须收敛为
 * 空列表而不是让选择器崩溃。模块内的两份缓存不对外暴露，用例为每个场景使用独立图标集
 * 名称以避免相互影响；除全局 fetch 外，缓存、在途去重与结果组装全部走真实实现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchIconsData, ICONS_MAP } from '../icons';

/** 构造一次可控的 Iconify 集合响应，供用例按需裁剪字段。 */
function collectionResponse() {
  return {
    categories: { outline: ['home', 'user'] },
    prefix: 'test-icons',
    title: 'Test Icons',
    total: 3,
    uncategorized: ['search'],
  };
}

/**
 * 建立只由当前用例释放的响应，用于制造真实的重叠请求窗口。
 * @returns 手动完成的 fetch 结果控制器与对应 Promise。
 */
function deferredFetch() {
  let resolve!: /** 释放本例等待的 JSON 响应体。 */ (value: unknown) => void;
  const promise = new Promise<unknown>(
    /** 保存仅由本用例持有的完成控制器。 */ (accept) => {
      resolve = accept;
    },
  );
  return { promise, resolve };
}

describe('fetchIconsData', /** 缓存、在途共享与失败兜底是选择器可用性的三条底线。 */ () => {
  const fetchMock = vi.fn();

  beforeEach(
    /** 每例独立提供网络结果。 */ () => {
      fetchMock.mockReset();
      vi.stubGlobal('fetch', fetchMock);
    },
  );

  afterEach(
    /** 撤销全局 fetch 替身，避免影响其它用例。 */ () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  );

  it('展开未分类与分类图标并统一加前缀', /** 漏掉分类图标会让选择器只显示部分图标，前缀缺失会让插入的图标名无效。 */ async () => {
    fetchMock.mockResolvedValue({
      /** 交出 Iconify 集合响应体。 */ json: () => collectionResponse(),
    });

    const icons = await fetchIconsData('test-icons-expand');

    expect(icons).toEqual([
      'test-icons-expand:search',
      'test-icons-expand:home',
      'test-icons-expand:user',
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.iconify.design/collection?prefix=test-icons-expand',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(ICONS_MAP['test-icons-expand']).toBe(icons);
  });

  it('没有分类字段时只返回未分类图标', /** 缺省分类不能导致结果里出现 undefined 图标名。 */ async () => {
    fetchMock.mockResolvedValue({
      /** 交出不含分类的集合响应。 */ json: () => ({
        prefix: 'plain-icons',
        title: 'Plain',
        total: 1,
        uncategorized: ['search'],
      }),
    });

    await expect(fetchIconsData('plain-icons')).resolves.toEqual([
      'plain-icons:search',
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.iconify.design/collection?prefix=plain-icons',
      expect.anything(),
    );
  });

  it('同一图标集的后续请求直接复用缓存结果', /** 重复请求会打满公共接口，页面刷新前必须复用已缓存的结果。 */ async () => {
    fetchMock.mockResolvedValue({
      /** 交出 Iconify 集合响应体。 */ json: () => collectionResponse(),
    });

    const first = await fetchIconsData('test-icons-cache');
    const second = await fetchIconsData('test-icons-cache');

    expect(second).toBe(first);
    expect(ICONS_MAP['test-icons-cache']).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('并发的多个选择器共享同一份在途请求', /** 同时打开多个选择器时不能各发一次请求。 */ async () => {
    const deferred = deferredFetch();
    fetchMock.mockReturnValue(deferred.promise);

    const first = fetchIconsData('test-icons-pending');
    const second = fetchIconsData('test-icons-pending');
    deferred.resolve({
      /** 交出 Iconify 集合响应体。 */ json: () => collectionResponse(),
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      [
        'test-icons-pending:search',
        'test-icons-pending:home',
        'test-icons-pending:user',
      ],
      [
        'test-icons-pending:search',
        'test-icons-pending:home',
        'test-icons-pending:user',
      ],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('拉取失败时告警并返回空列表', /** 网络异常不能让选择器抛错，只能退化为空图标列表。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默预期内的失败日志，避免污染测试输出。 */ () => {},
      );
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(fetchIconsData('failing-icons')).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to fetch icons for prefix failing-icons:',
      expect.any(Error),
    );
    expect(ICONS_MAP['failing-icons']).toBeUndefined();

    // 失败结果同样被在途表记住，页面刷新前不会再次请求，也不会抛出。
    await expect(fetchIconsData('failing-icons')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
