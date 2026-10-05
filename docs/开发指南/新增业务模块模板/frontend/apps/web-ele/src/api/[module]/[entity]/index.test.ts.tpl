/**
 * [entity-name]接口（api/[module]/[entity]）的地址、方法与参数回归。
 *
 * 地址写错会让增删改落到错误接口，分页参数未透传会让筛选与翻页失效，详情参数未拼接会
 * 让后端收到空编号。用例只替换网络边界，保留接口自身的地址拼装与参数传递逻辑。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  create[Entity],
  delete[Entity],
  get[Entity],
  get[Entity]Page,
  update[Entity],
} from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络边界，保留接口自身的地址拼装与参数传递。 */ () => ({
    requestClient: {
      delete: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    },
  }),
);

/** 构造字段完整的记录，作为各用例的合法基线。 */
function valid[Entity]() {
  return { id: 1024, name: '示例名称', remark: '备注', status: 0 };
}

beforeEach(
  /** 每例独立提供响应，不继承上例的调用记录。 */ () => vi.resetAllMocks(),
);

describe('[entity-name]查询接口', /** 列表与详情是页面数据来源，参数与地址必须与后端约定一致。 */ () => {
  it('分页查询透传筛选与分页参数', /** 参数未透传会让页面筛选与翻页失效。 */ async () => {
    const page = { list: [valid[Entity]()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);
    const params = { pageNo: 2, pageSize: 20, name: '示例', status: 0 };

    await expect(get[Entity]Page(params)).resolves.toBe(page);
    expect(requestClient.get).toHaveBeenCalledWith('/[module]/[entity]/page', {
      params,
    });
  });

  it('详情按编号拼接查询串', /** 编号未拼接会让后端收到空编号并返回空数据。 */ async () => {
    const detail = valid[Entity]();
    vi.mocked(requestClient.get).mockResolvedValue(detail);

    await expect(get[Entity](1024)).resolves.toBe(detail);
    expect(requestClient.get).toHaveBeenCalledWith('/[module]/[entity]/get?id=1024');
  });
});

describe('[entity-name]写入接口', /** 写入地址或动词写错会产生静默失败或改错资源。 */ () => {
  it('新增走 POST 并返回编号', /** 新增走错动词会让后端 405，用户看到无提示的失败。 */ async () => {
    vi.mocked(requestClient.post).mockResolvedValue(1024);

    await expect(create[Entity](valid[Entity]())).resolves.toBe(1024);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/[module]/[entity]/create',
      valid[Entity](),
    );
  });

  it('修改走 PUT 并原样提交记录', /** 修改必须带编号，否则后端会拒绝或改错记录。 */ async () => {
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(update[Entity](valid[Entity]())).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/[module]/[entity]/update',
      valid[Entity](),
    );
  });

  it('删除按编号拼接查询串', /** 删除未定位编号会删错记录或删不掉。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(delete[Entity](1024)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/[module]/[entity]/delete?id=1024',
    );
  });
});
