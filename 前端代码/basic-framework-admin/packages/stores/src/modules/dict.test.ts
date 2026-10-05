/** 使用真实 Pinia 验证字典迟到结果不能污染新身份。 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDictStore } from './dict';

/** 创建兼容支持工具链的受控 Promise，显式安排请求完成顺序。 */
function deferred<T>() {
  let resolve!: /** 成功释放本例等待的异步结果。 */ (
    value: PromiseLike<T> | T,
  ) => void;
  let reject!: /** 将受控错误传播给本例等待者。 */ (reason?: unknown) => void;
  const promise = new Promise<T>(
    /** 保存仅由本例持有的完成控制器。 */ (accept, fail) => {
      resolve = accept;
      reject = fail;
    },
  );
  return { promise, reject, resolve };
}

describe('字典加载生命周期', /** 集中验证字典加载生命周期的可观察行为。 */ () => {
  beforeEach(
    /** 每例字典缓存独立，不共享上例 Store。 */ () =>
      setActivePinia(createPinia()),
  );

  it('reset 后的旧请求不能覆盖新身份字典', /** 安排明确的响应顺序并验证：reset 后的旧请求不能覆盖新身份字典。 */ async () => {
    const store = useDictStore();
    /** 释放旧身份正在等待的结果。 */
    const response = deferred<Record<string, unknown>[]>();
    let current = true;
    const old = store.setDictCacheByApi(
      /** 旧字典请求等待用例显式释放。 */ () => response.promise,
      {},
      'label',
      'value',
      /** 写入前读取受控会话状态。 */ () => current,
    );
    current = false;
    store.$reset();
    await store.setDictCacheByApi(
      /** 返回新身份可见的字典项。 */ async () => [
        { dictType: 'role', label: 'B', value: 'b' },
      ],
    );
    response.resolve([{ dictType: 'role', label: 'A', value: 'a' }]);
    await old;
    expect(store.getDictOptions('role')).toEqual([{ label: 'B', value: 'b' }]);
  });

  it('接口失败保持已有缓存并让调用方观察失败', /** 安排明确的响应顺序并验证：接口失败保持已有缓存并让调用方观察失败。 */ async () => {
    const store = useDictStore();
    store.setDictCache({ role: [{ label: 'B', value: 'b' }] });
    await expect(
      store.setDictCacheByApi(
        /** 注入外部接口失败，确认失败不会清空已有缓存。 */ async () => {
          throw new Error('offline');
        },
      ),
    ).rejects.toThrow('offline');
    expect(store.getDictOptions('role')).toEqual([{ label: 'B', value: 'b' }]);
  });

  it('畸形字典结果不部分覆盖已有缓存', /** 第一条合法也不能在第二条失败前写入 Store。 */ async () => {
    const store = useDictStore();
    store.setDictCache({ role: [{ label: 'B', value: 'b' }] });
    await expect(
      store.setDictCacheByApi(
        /** 返回混合合法与非法条目。 */ async () => [
          { dictType: 'role', label: 'New', value: 'new' },
          { dictType: 'role', label: 'Bad', value: {} },
        ],
      ),
    ).rejects.toThrow('字典字段类型无效');
    expect(store.getDictOptions('role')).toEqual([{ label: 'B', value: 'b' }]);
  });

  it('只对原始类型执行字典值转换，原型键不充当缓存', /** 未提供值不能触发 toString 异常，也不读取继承属性。 */ () => {
    const store = useDictStore();
    store.setDictCache({ flag: [{ label: 'Yes', value: 'true' }] });
    expect(store.getDictData('flag', true)?.label).toBe('Yes');
    expect(store.getDictData('flag', null)).toBeUndefined();
    expect(store.getDictData('flag', {})).toBeUndefined();
    expect(store.getDictOptions('constructor')).toEqual([]);
    expect(store.getDictData('constructor', 'x')).toBeUndefined();
  });

  it('响应不是数组时拒绝且保留已有缓存', /** 后端返回对象或 null 时不能把非数组写进缓存让下拉框崩溃。 */ async () => {
    const store = useDictStore();
    store.setDictCache({ role: [{ label: 'B', value: 'b' }] });

    await expect(
      store.setDictCacheByApi(
        /** 返回非数组的畸形响应。 */ async () => ({ role: [] }),
      ),
    ).rejects.toThrow('字典响应必须是数组');
    expect(store.getDictOptions('role')).toEqual([{ label: 'B', value: 'b' }]);
  });

  it('字典项不是对象时拒绝且保留已有缓存', /** 传输数组中的标量无法按字段读取，必须中断而不是写入空字典项。 */ async () => {
    const store = useDictStore();
    store.setDictCache({ role: [{ label: 'B', value: 'b' }] });

    await expect(
      store.setDictCacheByApi(
        /** 返回混入标量的字典数组。 */ async () => ['role'],
      ),
    ).rejects.toThrow('字典项必须是对象');
    expect(store.getDictOptions('role')).toEqual([{ label: 'B', value: 'b' }]);
  });

  it('写入前身份失效时整体丢弃请求结果', /** 迟到结果在写入前被判定过期，不能出现在缓存里。 */ async () => {
    const store = useDictStore();
    const response = deferred<Record<string, unknown>[]>();
    const pending = store.setDictCacheByApi(
      /** 旧身份字典请求等待用例显式释放。 */ () => response.promise,
      {},
      'label',
      'value',
      /** 写入前判定该请求已经过期。 */ () => false,
    );

    response.resolve([{ dictType: 'role', label: 'A', value: 'a' }]);
    await pending;
    expect(store.getDictOptions('role')).toEqual([]);
  });

  it('已登记类型的缓存值被清空后按无字典处理', /** 缓存值可能被置空，读取必须退化为"没有字典"而不是抛错或返回脏数据。 */ () => {
    const store = useDictStore();
    store.setDictCache({ emptied: [{ label: 'A', value: 'a' }] });
    // 通过字典口径的索引签名把已登记类型置空，模拟缓存被外部清空后的读取。
    (store.dictCache as Record<string, unknown>).emptied = undefined;

    expect(store.getDictData('emptied', 'a')).toBeUndefined();
    expect(store.getDictOptions('emptied')).toEqual([]);
  });

  it('类型未登记时读取返回空结果', /** 未缓存的字典类型必须返回空结果，不能读取到原型链上的同名键。 */ () => {
    const store = useDictStore();

    expect(store.getDictData('missing-type', 'x')).toBeUndefined();
    expect(store.getDictOptions('missing-type')).toEqual([]);
  });
});
