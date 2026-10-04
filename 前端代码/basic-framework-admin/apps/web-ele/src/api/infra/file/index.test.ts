/**
 * 文件管理接口（apps/web-ele 的 api/infra/file）真实请求契约回归。
 *
 * 该模块负责文件列表与删除，并把上传协议三个入口从核心文件接口原样再导出：路径或编号拼接
 * 写错会让文件管理页删错对象，再导出关系断开会让页面与其它调用方使用两套上传实现。
 * 用例只替换网络收发边界，断言真实方法、地址与参数，并核对再导出的是同一批核心函数。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createFile,
  deleteFile,
  deleteFileList,
  getFilePage,
  getFilePresignedUrl,
  uploadFile,
} from './index';

const coreFileApi = vi.hoisted(
  /** 建立核心上传协议三个入口的替身，用于核对再导出关系。 */ () => ({
    /** 上传单个文件的核心入口替身。 */
    createFile: vi.fn(),
    /** 申请预签名地址的核心入口替身。 */
    getFilePresignedUrl: vi.fn(),
    /** 直传文件的核心入口替身。 */
    uploadFile: vi.fn(),
  }),
);

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，列表与删除接口的参数拼装保持真实实现。 */ () => ({
    requestClient: { delete: vi.fn(), get: vi.fn() },
  }),
);

vi.mock(
  '#/api/core/file',
  /** 只替换核心上传协议的实现，再导出关系本身保持真实。 */ () => coreFileApi,
);

beforeEach(
  /** 每例独立提供响应，不继承上例结果。 */ () => {
    vi.resetAllMocks();
  },
);

describe('文件查询与删除接口', /** 列表与删除接口的请求契约。 */ () => {
  it('分页查询按原样传递分页与筛选参数', /** 参数被丢弃会让文件列表始终显示第一页全量数据。 */ async () => {
    const pageResult = { list: [], total: 0 };
    vi.mocked(requestClient.get).mockResolvedValue(pageResult);
    const params = { pageNo: 1, pageSize: 10, path: 'notes/' };

    const result = await getFilePage(params);

    expect(requestClient.get).toHaveBeenCalledWith('/infra/file/page', {
      params,
    });
    expect(result).toBe(pageResult);
  });

  it('单条与批量删除按不同路径传参', /** 批量删除漏拼编号会删不掉或多删文件。 */ async () => {
    await deleteFile(4);
    await deleteFileList([4, 5]);

    expect(requestClient.delete).toHaveBeenCalledWith(
      '/infra/file/delete?id=4',
    );
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/infra/file/delete-list?ids=4,5',
    );
  });
});

describe('上传协议再导出', /** 文件管理页必须与其它调用方共用同一套上传实现。 */ () => {
  it('三个上传入口就是核心文件接口的同一批函数', /** 再导出断开会让文件管理页保留另一套上传协议。 */ () => {
    expect(createFile).toBe(coreFileApi.createFile);
    expect(getFilePresignedUrl).toBe(coreFileApi.getFilePresignedUrl);
    expect(uploadFile).toBe(coreFileApi.uploadFile);
  });
});
