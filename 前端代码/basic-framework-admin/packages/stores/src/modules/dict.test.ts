/** 验证字典 Store 的空值防护、O(N) 分组缓存及接口失败隔离兜底行为。 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDictStore } from './dict';

const logErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@vben-core/shared/utils', async () => {
  const actual = await vi.importActual<
    typeof import('@vben-core/shared/utils')
  >('@vben-core/shared/utils');
  return {
    ...actual,
    logError: logErrorMock,
  };
});

/** 模拟正常返回多组字典项的异步接口。 */
async function succeedingDictApi(): Promise<Record<string, any>[]> {
  return [
    { colorType: 'primary', dictType: 'a', label: 'A1', value: '1' },
    { colorType: 'info', dictType: 'b', label: 'B1', value: '2' },
  ];
}

/** 模拟请求异常失败的字典接口。 */
async function failingDictApi(): Promise<Record<string, any>[]> {
  throw new Error('network down');
}

/** 字典 Store 单测套件。 */
function describeDictStore() {
  beforeEach(() => {
    setActivePinia(createPinia());
    logErrorMock.mockReset();
  });

  it('getDictData 对 null、undefined 和缺失类型安全返回 undefined', () => {
    const store = useDictStore();
    store.setDictCache({
      common_status: [{ label: '开启', value: '0' }],
    });

    expect(store.getDictData('common_status', null)).toBeUndefined();
    expect(store.getDictData('common_status', undefined)).toBeUndefined();
    expect(store.getDictData('', '0')).toBeUndefined();
    expect(store.getDictData('missing_type', '0')).toBeUndefined();
    expect(store.getDictData('common_status', 0)?.label).toBe('开启');
  });

  it('setDictCacheByApi 正常分组缓存且在接口失败时保留现有缓存并记录日志', async () => {
    const store = useDictStore();
    const ok = await store.setDictCacheByApi(succeedingDictApi);
    expect(ok).toBe(true);
    expect(store.getDictOptions('a')).toHaveLength(1);
    expect(store.getDictData('b', '2')?.label).toBe('B1');

    const failed = await store.setDictCacheByApi(failingDictApi);
    expect(failed).toBe(false);
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(store.getDictData('a', '1')?.label).toBe('A1');
  });
}

describe('useDictStore', describeDictStore);
