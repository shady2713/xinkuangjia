/** 真实请求客户端配合可控响应，验证跨身份刷新与等待者失败语义。 */
import MockAdapter from 'axios-mock-adapter';
import { describe, expect, it, vi } from 'vitest';

import { authenticateResponseInterceptor } from './preset-interceptors';
import { RequestClient } from './request-client';

/** 创建由测试决定完成顺序的异步结果。 */
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

describe('请求刷新身份隔离', /** 集中验证请求刷新身份隔离的可观察行为。 */ () => {
  it('新身份刷新不等待或复用旧身份仍在进行的刷新', /** A 刷新悬挂时完成 B 请求，证明刷新所有权按身份隔离。 */ async () => {
    let epoch = 1;
    const client = new RequestClient({
      /** 同步捕获请求所属身份。 */ getSessionEpoch: () => epoch,
    });
    const mock = new MockAdapter(client.instance);
    const old = deferred<string>();
    const started = deferred<undefined>();
    const logout = vi.fn();
    const refresh = vi.fn(
      /** 仅让旧身份等待，当前身份独立得到刷新结果。 */ async (
        owner: number,
      ) => {
        if (owner === 1) {
          started.resolve(undefined);
          return old.promise;
        }
        return 'new-session-result';
      },
    );
    client.addResponseInterceptor(
      authenticateResponseInterceptor({
        client,
        enableRefreshToken: true,
        /** 返回测试安排的当前身份。 */ getSessionEpoch: () => epoch,
        doReAuthenticate: logout,
        doRefreshToken: refresh,
        /** 保留令牌值用于验证重试不混用。 */ formatToken: (token) => token,
      }),
    );
    mock.onGet('/a').reply(401);
    mock.onGet('/b').replyOnce(401);
    mock.onGet('/b').reply(200, 'B-visible');
    const a = client.get('/a');
    const canceled = expect(a).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    await started.promise;
    epoch = 2;
    await expect(client.get('/b')).resolves.toMatchObject({
      data: 'B-visible',
    });
    expect(
      refresh.mock.calls.map(
        /** 读取真实刷新调用持有的身份。 */ ([owner]) => owner,
      ),
    ).toEqual([1, 2]);
    old.resolve('old-session-result');
    await canceled;
    expect(logout).not.toHaveBeenCalled();
    mock.restore();
  });
  it('请求同步捕获身份，刷新迟到不得以新令牌重发或注销新身份', /** 安排明确的响应顺序并验证：请求同步捕获身份，刷新迟到不得以新令牌重发或注销新身份。 */ async () => {
    let epoch = 1;
    const client = new RequestClient({
      /** 在请求同步入口读取当前身份。 */ getSessionEpoch: () => epoch,
    });
    const mock = new MockAdapter(client.instance);
    const refresh = deferred<string>();
    const started = deferred<undefined>();
    const reAuthenticate = vi.fn(
      /** 记录重新认证调用，不执行页面导航。 */ async () => {},
    );
    client.addResponseInterceptor(
      authenticateResponseInterceptor({
        client,
        enableRefreshToken: true,
        /** 在请求同步入口读取当前身份。 */ getSessionEpoch: () => epoch,
        doReAuthenticate: reAuthenticate,
        /** 标记刷新确已开始，再等待受控结果。 */ doRefreshToken: async () => {
          started.resolve(undefined);
          return refresh.promise;
        },
        /** 按客户端契约生成重试认证头。 */ formatToken: (token) =>
          `Bearer ${token}`,
      }),
    );
    mock.onGet('/private').reply(401);
    const request = client.get('/private');
    const rejected = expect(request).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
    await started.promise;
    epoch = 2;
    refresh.resolve('later-result');
    await rejected;
    expect(mock.history.get).toHaveLength(1);
    expect(reAuthenticate).not.toHaveBeenCalled();
    mock.restore();
  });

  it('旧 401 在新登录后到达时不刷新、不退出、不重试', /** 安排明确的响应顺序并验证：旧 401 在新登录后到达时不刷新、不退出、不重试。 */ async () => {
    let epoch = 1;
    const client = new RequestClient({
      /** 在请求同步入口读取当前身份。 */ getSessionEpoch: () => epoch,
    });
    const mock = new MockAdapter(client.instance);
    const response = deferred<[number]>();
    const started = deferred<undefined>();
    const refresh = vi.fn(
      /** 返回固定测试刷新结果，调用次数由断言核对。 */ async () => 'token',
    );
    const logout = vi.fn(
      /** 记录重新认证调用，不执行页面导航。 */ async () => {},
    );
    client.addResponseInterceptor(
      authenticateResponseInterceptor({
        client,
        enableRefreshToken: true,
        /** 在请求同步入口读取当前身份。 */ getSessionEpoch: () => epoch,
        doRefreshToken: refresh,
        doReAuthenticate: logout,
        /** 按客户端契约生成重试认证头。 */ formatToken: (token) => token,
      }),
    );
    mock.onGet('/private').reply(
      /** 标记真实请求到达传输边界，返回受控未授权结果。 */ () => {
        started.resolve(undefined);
        return response.promise;
      },
    );
    const request = client.get('/private');
    const rejected = expect(request).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
    await started.promise;
    epoch = 2;
    response.resolve([401]);
    await rejected;
    expect(refresh).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    mock.restore();
  });

  it('刷新失败让所有等待者拒绝，只退出一次且不使用空令牌重发', /** 安排明确的响应顺序并验证：刷新失败让所有等待者拒绝，只退出一次且不使用空令牌重发。 */ async () => {
    const client = new RequestClient();
    const mock = new MockAdapter(client.instance);
    const refresh = deferred<string>();
    const ready = deferred<undefined>();
    let responses = 0;
    const logout = vi.fn(
      /** 记录重新认证调用，不执行页面导航。 */ async () => {},
    );
    const doRefreshToken = vi.fn(
      /** 所有本身份等待者共用此受控刷新结果。 */ () => refresh.promise,
    );
    client.addResponseInterceptor(
      authenticateResponseInterceptor({
        client,
        enableRefreshToken: true,
        doRefreshToken,
        doReAuthenticate: logout,
        /** 按客户端契约生成重试认证头。 */ formatToken: (token) => token,
      }),
    );
    mock.onGet('/private').reply(
      /** 标记真实请求到达传输边界，返回受控未授权结果。 */ () => {
        if (++responses === 2) ready.resolve(undefined);
        return [401];
      },
    );
    const results = Promise.allSettled([
      client.get('/private'),
      client.get('/private'),
    ]);
    await ready.promise;
    refresh.reject(new Error('refresh rejected'));
    const settled = await results;
    expect(
      settled.map(
        /** 检查所有排队请求的最终完成状态。 */ (result) => result.status,
      ),
    ).toEqual(['rejected', 'rejected']);
    expect(doRefreshToken).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(mock.history.get).toHaveLength(2);
    mock.restore();
  });
});
