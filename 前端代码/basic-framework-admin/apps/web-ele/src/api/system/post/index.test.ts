/**
 * 岗位接口（api/system/post）的请求地址、方法与参数回归。
 *
 * 岗位数据用于岗位管理页与用户表单的岗位下拉：地址写错会让增删改落到错误接口，
 * 分页参数未透传会让筛选失效，导出未走文件下载通道会把二进制内容当 JSON 解析。
 * 用例只替换网络边界，保留接口自身的地址拼装与参数传递逻辑，断言真实调用形态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createPost,
  deletePost,
  deletePostList,
  exportPost,
  getPost,
  getPostPage,
  getSimplePostList,
  updatePost,
} from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络边界，保留接口自身的地址拼装与参数传递。 */ () => ({
    requestClient: {
      delete: vi.fn(),
      download: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    },
  }),
);

/** 构造字段完整的岗位记录，作为各用例的合法基线。 */
function validPost() {
  return {
    code: 'engineer',
    id: 21,
    name: '工程师',
    remark: '研发序列',
    sort: 2,
    status: 0,
  };
}

beforeEach(
  /** 每例独立提供响应，不继承上例的调用记录。 */ () => vi.resetAllMocks(),
);

describe('岗位查询接口', /** 列表与详情是页面数据来源，参数与地址必须与后端约定一致。 */ () => {
  it('分页查询透传筛选参数', /** 分页参数未透传会让页面筛选与翻页失效。 */ async () => {
    const page = { list: [validPost()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);
    const params = { pageNo: 2, pageSize: 20, name: '工程', status: 0 };

    await expect(getPostPage(params)).resolves.toBe(page);
    expect(requestClient.get).toHaveBeenCalledWith('/system/post/page', {
      params,
    });
  });

  it('精简列表用于下拉选择', /** 精简列表地址写错会让用户表单的岗位下拉为空。 */ async () => {
    const posts = [validPost()];
    vi.mocked(requestClient.get).mockResolvedValue(posts);

    await expect(getSimplePostList()).resolves.toBe(posts);
    expect(requestClient.get).toHaveBeenCalledWith('/system/post/simple-list');
  });

  it('按编号查询详情', /** 编号必须进入查询串，否则会返回错误岗位。 */ async () => {
    const post = validPost();
    vi.mocked(requestClient.get).mockResolvedValue(post);

    await expect(getPost(21)).resolves.toBe(post);
    expect(requestClient.get).toHaveBeenCalledWith('/system/post/get?id=21');
  });
});

describe('岗位写操作接口', /** 方法与路径是后端约定的直接体现，写错会落到错误操作。 */ () => {
  it('新增岗位提交完整请求体', /** 新增必须使用 POST 并原样提交表单数据。 */ async () => {
    const payload = validPost();
    vi.mocked(requestClient.post).mockResolvedValue(21);

    await expect(createPost(payload)).resolves.toBe(21);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/post/create',
      payload,
    );
  });

  it('修改岗位使用 PUT', /** 修改与新增共用路径时必须靠方法区分。 */ async () => {
    const payload = validPost();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updatePost(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/post/update',
      payload,
    );
  });

  it('按编号删除单个岗位', /** 删除编号必须进入查询串，避免删错岗位。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deletePost(21)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/post/delete?id=21',
    );
  });

  it('批量删除用逗号拼接编号', /** 分隔符由后端约定，写错会漏删或多删。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deletePostList([4, 9, 16])).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/post/delete-list?ids=4,9,16',
    );
  });
});

describe('岗位导出接口', /** 导出走文件下载通道，混用普通请求会把文件名与二进制体丢失。 */ () => {
  it('按筛选条件走下载通道', /** 导出接口用普通 GET 会把二进制内容当 JSON 解析并报错。 */ async () => {
    const stream = new Blob(['excel']);
    vi.mocked(requestClient.download).mockResolvedValue(stream);
    const params = { name: '工程' };

    await expect(exportPost(params)).resolves.toBe(stream);
    expect(requestClient.download).toHaveBeenCalledWith(
      '/system/post/export-excel',
      { params },
    );
  });
});
