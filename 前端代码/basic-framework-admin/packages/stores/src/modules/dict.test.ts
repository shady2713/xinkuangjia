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
});
