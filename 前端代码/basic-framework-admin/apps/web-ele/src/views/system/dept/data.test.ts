/** 验证部门配置不再在模块加载顶层发起请求、支持数字/字符串负责人编号校验并支持响应式用户列表映射。 */
import { describe, expect, it, vi } from 'vitest';

import { useFormSchema, useGridColumns } from './data';

const getSimpleUserListMock = vi.hoisted(() => vi.fn(async () => []));

/**
 * 构造可记录联合类型与可空修饰的轻量 Zod 规则替身，避免单测加载完整 form-ui 上下文。
 *
 * @param kind 规则节点标识
 * @returns 链式规则替身对象
 */
function createSchemaStub(kind: string): Record<string, unknown> {
  return {
    /** 标记当前规则带默认值。 */
    default: vi.fn(() => createSchemaStub(`${kind}.default`)),
    kind,
    /** 标记当前规则允许 null 与 undefined。 */
    nullish: vi.fn(() => createSchemaStub(`${kind}.nullish`)),
  };
}

vi.mock('@vben/constants', () => ({
  CommonStatusEnum: { ENABLE: 0 },
  DICT_TYPE: { COMMON_STATUS: 'common_status' },
}));
vi.mock('@vben/hooks', () => ({
  /** 返回空字典选项避免触发全局 Store 初始化。 */
  getDictOptions: vi.fn(() => []),
}));
vi.mock('@vben/utils', () => ({
  /** 原样透传树形入参。 */
  handleTree: (data: unknown) => data,
}));
vi.mock('#/adapter/form', () => ({
  /** 模拟可选邮箱校验规则。 */
  buildOptionalEmailSchema: vi.fn(() => createSchemaStub('email')),
  /** 模拟可选手机号校验规则。 */
  buildOptionalMobileSchema: vi.fn(() => createSchemaStub('mobile')),
  z: {
    /** 模拟数值规则。 */
    number: vi.fn(() => createSchemaStub('number')),
    /** 模拟字符串规则。 */
    string: vi.fn(() => createSchemaStub('string')),
    /** 记录联合规则子分支以便断言同时放行数字和字符串雪花编号。 */
    union: vi.fn((items: Array<{ kind: string }>) =>
      createSchemaStub(`union(${items.map((item) => item.kind).join('|')})`),
    ),
  },
}));
vi.mock('#/api/system/dept', () => ({
  getDeptList: vi.fn(async () => []),
}));
vi.mock('#/api/system/user', () => ({
  getSimpleUserList: getSimpleUserListMock,
}));

/** 单元格格式化回调函数签名。 */
type CellFormatter = (ctx: { cellValue: unknown }) => string;

/** 部门管理 data.ts 回归测试套件。 */
function describeDeptData() {
  it('模块加载顶层不主动请求用户列表，且负责人校验放行数字与字符串雪花编号', () => {
    expect(getSimpleUserListMock).not.toHaveBeenCalled();

    const leaderField = useFormSchema().find(
      /** 定位负责人表单项以核对校验规则。 */
      (item) => item.fieldName === 'leaderUserId',
    );
    expect(leaderField?.rules).toMatchObject({
      kind: 'union(number|string).nullish',
    });
  });

  it('通过响应式用户列表读取器映射负责人昵称并兜底空值', () => {
    let users = [{ id: 1, nickname: '张三' }] as Array<{
      id: number | string;
      nickname: string;
    }>;
    /** 读取当前用例维护的动态用户快照。 */
    const readUsers = () => users as never;
    const cols = useGridColumns(readUsers);
    const leaderCol = cols?.find(
      /** 定位负责人表格列配置。 */
      (col) => col.field === 'leaderUserId',
    );
    const format = leaderCol?.formatter as CellFormatter;

    expect(format({ cellValue: '1' })).toBe('张三');
    expect(format({ cellValue: null })).toBe('-');
    users = [{ id: 2, nickname: '李四' }];
    expect(format({ cellValue: 2 })).toBe('李四');
  });
}

describe('system dept data', describeDeptData);
