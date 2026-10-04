/**
 * 字段校验规则（apps/web-ele 的 adapter/field-rules）真实行为回归。
 *
 * 该模块为应用所有表单提供取值判定与 zod 校验器工厂：判定写错会让非法账号、密码、
 * 手机号、邮箱、身份证、姓名、银行卡与百分比通过校验并落库；可选校验器把空值判为
 * 非法会让用户无法留空提交；必填校验器丢失提示文案会让用户只看到英文错误码；身份证
 * 校验漏掉出生日期与校验位判断会让编造号码通过；百分比与数量的边界写错会造成金额、
 * 配额类字段失真。用例直接驱动真实校验器解析真实取值，只断言可观察的判定与提示，
 * 不替换被测实现。
 */
import { describe, expect, it } from 'vitest';

import {
  buildLoginPasswordSchema,
  buildOptionalBankCardSchema,
  buildOptionalEmailSchema,
  buildOptionalIdCardSchema,
  buildOptionalMobileSchema,
  buildOptionalPercentSchema,
  buildOptionalRealNameSchema,
  buildRequiredBankCardSchema,
  buildRequiredEmailSchema,
  buildRequiredIdCardSchema,
  buildRequiredMobileSchema,
  buildRequiredPasswordSchema,
  buildRequiredPercentSchema,
  buildRequiredQuantitySchema,
  buildRequiredRealNameSchema,
  buildRequiredUsernameSchema,
  DEFAULT_DATE_FORMAT,
  DEFAULT_DATETIME_FORMAT,
  isQuantityValue,
} from './field-rules';

/** 校验器最小契约：用例只依赖解析结果与首条错误信息。 */
interface SchemaLike {
  /**
   * 解析取值并返回判定结果。
   * @param value 交给校验器解析的取值。
   * @returns 成功时带解析数据，失败时带首条错误信息。
   */
  safeParse(
    value: unknown,
  ):
    | { data: unknown; success: true }
    | { error: { issues: Array<{ message: string }> }; success: false };
}

/** 有效身份证号夹具：出生日期合法且校验位与加权和一致。 */
const VALID_ID_CARD = '11010519491231002X';

/** 加权校验位同样匹配但出生日期为 2 月 31 日的身份证号夹具。 */
const IMPOSSIBLE_BIRTHDAY_ID_CARD = '110105194902310026';

/** 出生年份早于 1900 年的身份证号夹具。 */
const TOO_EARLY_ID_CARD = '110105184912310029';

/** 出生年份位于未来的身份证号夹具。 */
const FUTURE_ID_CARD = '11010520491231002X';

/**
 * 断言取值通过校验并返回解析结果。
 * @param schema 待驱动的真实校验器。
 * @param value 交给校验器解析的取值。
 * @returns 解析成功后的结果数据。
 * @throws Error 取值被拒绝时抛出，并带上真实错误信息。
 */
function parseAccepted(schema: SchemaLike, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `取值被误判为非法：${JSON.stringify(value)}，原因：${result.error.issues[0]?.message}`,
    );
  }
  return result.data;
}

/**
 * 取出取值被拒绝时的首条错误信息。
 * @param schema 待驱动的真实校验器。
 * @param value 交给校验器解析的取值。
 * @returns 首条错误信息。
 * @throws Error 取值意外通过校验时抛出，避免用例静默地什么都不验证。
 */
function firstIssueMessage(schema: SchemaLike, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error(`取值被误判为合法：${JSON.stringify(value)}`);
  }
  const message = result.error.issues[0]?.message;
  if (message === undefined) {
    throw new Error('校验失败但未给出错误信息');
  }
  return message;
}

describe('字段格式常量', /** 日期格式常量决定表单与接口的时间串口径。 */ () => {
  it('导出与后端约定的日期与时间格式', /** 格式写错会让后端收到无法解析的时间串。 */ () => {
    expect(DEFAULT_DATE_FORMAT).toBe('YYYY-MM-DD');
    expect(DEFAULT_DATETIME_FORMAT).toBe('YYYY-MM-DD HH:mm:ss');
  });
});

describe('账号与密码校验器', /** 账号与密码规则决定注册、登录与改密能否拦截非法输入。 */ () => {
  it('账号必填校验接受 4-30 位字母数字并裁剪空白', /** 长度或字符集放宽会让非法账号落库，漏裁剪会让带空格账号被误拒。 */ () => {
    const schema = buildRequiredUsernameSchema();

    expect(parseAccepted(schema, 'abcd')).toBe('abcd');
    expect(parseAccepted(schema, 'ABCD1234')).toBe('ABCD1234');
    expect(parseAccepted(schema, '  abcd  ')).toBe('abcd');
    expect(firstIssueMessage(schema, 'abc')).toBe(
      '用户名必须为 4-30 位字母或数字',
    );
    expect(firstIssueMessage(schema, 'ab-cd')).toBe(
      '用户名必须为 4-30 位字母或数字',
    );
    expect(firstIssueMessage(schema, 'a'.repeat(31))).toBe(
      '用户名必须为 4-30 位字母或数字',
    );
    expect(firstIssueMessage(schema, '')).toBe('请输入用户名');
    expect(firstIssueMessage(schema, undefined)).toBe('请输入用户名');
  });

  it('账号必填校验按标签生成提示', /** 提示里带错字段名会让用户改错输入框。 */ () => {
    const schema = buildRequiredUsernameSchema('登录账号');

    expect(firstIssueMessage(schema, '')).toBe('请输入登录账号');
    expect(firstIssueMessage(schema, 'abc')).toBe(
      '登录账号必须为 4-30 位字母或数字',
    );
  });

  it('密码必填校验要求大小写字母与数字组合', /** 复杂度放宽会让弱密码通过注册与改密。 */ () => {
    const schema = buildRequiredPasswordSchema();

    expect(parseAccepted(schema, 'Abc123')).toBe('Abc123');
    expect(parseAccepted(schema, 'Abcdefghijklmno1')).toBe('Abcdefghijklmno1');
    expect(firstIssueMessage(schema, 'abc123')).toBe(
      '密码必须为 6-16 位，且同时包含大写字母、小写字母和数字',
    );
    expect(firstIssueMessage(schema, 'ABC123')).toBe(
      '密码必须为 6-16 位，且同时包含大写字母、小写字母和数字',
    );
    expect(firstIssueMessage(schema, 'Abc12345678901234')).toBe(
      '密码必须为 6-16 位，且同时包含大写字母、小写字母和数字',
    );
    expect(firstIssueMessage(schema, 'Abc 123')).toBe(
      '密码必须为 6-16 位，且同时包含大写字母、小写字母和数字',
    );
    expect(firstIssueMessage(schema, '')).toBe('请输入密码');
  });

  it('登录密码只校验非空', /** 登录沿用服务端既有密码，附加复杂度会让老密码无法登录。 */ () => {
    const schema = buildLoginPasswordSchema();

    expect(parseAccepted(schema, 'abc')).toBe('abc');
    expect(firstIssueMessage(schema, '')).toBe('请输入密码');
    expect(firstIssueMessage(schema, '   ')).toBe('请输入密码');
    expect(firstIssueMessage(buildLoginPasswordSchema('旧密码'), '')).toBe(
      '请输入旧密码',
    );
  });
});

describe('手机号与邮箱校验器', /** 联系方式规则决定资料与部门表单能否拦截错号。 */ () => {
  it('可选手机号允许留空并拦截格式错误', /** 把空值判为非法会让用户无法只填必填项。 */ () => {
    const schema = buildOptionalMobileSchema();

    expect(parseAccepted(schema, undefined)).toBeUndefined();
    expect(parseAccepted(schema, '')).toBe('');
    expect(parseAccepted(schema, '   ')).toBe('');
    expect(parseAccepted(schema, '13800138000')).toBe('13800138000');
    expect(firstIssueMessage(schema, '1380013800')).toBe('手机号格式不正确');
    expect(firstIssueMessage(schema, '23800138000')).toBe('手机号格式不正确');
    expect(firstIssueMessage(schema, '+8613800138000')).toBe(
      '手机号格式不正确',
    );
    expect(
      firstIssueMessage(buildOptionalMobileSchema('联系电话'), 'abc'),
    ).toBe('联系电话格式不正确');
  });

  it('必填手机号拦截空值与格式错误', /** 漏掉必填判定会让无联系方式的数据落库。 */ () => {
    const schema = buildRequiredMobileSchema();

    expect(parseAccepted(schema, '13800138000')).toBe('13800138000');
    expect(firstIssueMessage(schema, '')).toBe('请输入手机号');
    expect(firstIssueMessage(schema, undefined)).toBe('请输入手机号');
    expect(firstIssueMessage(schema, 'abc')).toBe('手机号格式不正确');
  });

  it('可选邮箱允许留空并拦截格式错误', /** 邮箱格式放宽会让通知与找回密码失败。 */ () => {
    const schema = buildOptionalEmailSchema();

    expect(parseAccepted(schema, undefined)).toBeUndefined();
    expect(parseAccepted(schema, '   ')).toBe('');
    expect(parseAccepted(schema, 'user@example.com')).toBe('user@example.com');
    expect(firstIssueMessage(schema, 'user@example.c')).toBe('邮箱格式不正确');
    expect(firstIssueMessage(schema, 'us er@example.com')).toBe(
      '邮箱格式不正确',
    );
    expect(firstIssueMessage(buildOptionalEmailSchema('通知邮箱'), 'abc')).toBe(
      '通知邮箱格式不正确',
    );
  });

  it('必填邮箱拦截空值与格式错误', /** 漏掉必填判定会让无邮箱账号进入通知链路。 */ () => {
    const schema = buildRequiredEmailSchema();

    expect(parseAccepted(schema, 'user@example.com')).toBe('user@example.com');
    expect(firstIssueMessage(schema, undefined)).toBe('请输入邮箱');
    expect(firstIssueMessage(schema, 'abc')).toBe('邮箱格式不正确');
  });
});

describe('身份证与姓名校验器', /** 实名规则决定用户资料能否被采信。 */ () => {
  it('身份证校验同时核对格式、出生日期与校验位', /** 只查正则会让编造号码通过实名校验。 */ () => {
    const schema = buildRequiredIdCardSchema();

    expect(parseAccepted(schema, VALID_ID_CARD)).toBe(VALID_ID_CARD);
    // 小写校验位与前后空白按同一口径归一化后仍应通过。
    expect(parseAccepted(schema, ' 11010519491231002x ')).toBe(
      '11010519491231002x',
    );
    expect(firstIssueMessage(schema, '1234')).toBe('身份证号格式不正确');
    expect(firstIssueMessage(schema, IMPOSSIBLE_BIRTHDAY_ID_CARD)).toBe(
      '身份证号格式不正确',
    );
    expect(firstIssueMessage(schema, TOO_EARLY_ID_CARD)).toBe(
      '身份证号格式不正确',
    );
    expect(firstIssueMessage(schema, FUTURE_ID_CARD)).toBe(
      '身份证号格式不正确',
    );
    expect(firstIssueMessage(schema, '110105194912310021')).toBe(
      '身份证号格式不正确',
    );
    expect(firstIssueMessage(schema, undefined)).toBe('请输入身份证号');
  });

  it('可选身份证允许留空并沿用同一套判定', /** 把空值判为非法会让非实名业务无法提交。 */ () => {
    const schema = buildOptionalIdCardSchema();

    expect(parseAccepted(schema, undefined)).toBeUndefined();
    expect(parseAccepted(schema, '')).toBe('');
    expect(parseAccepted(schema, VALID_ID_CARD)).toBe(VALID_ID_CARD);
    expect(firstIssueMessage(schema, '1234')).toBe('身份证号格式不正确');
    expect(firstIssueMessage(buildOptionalIdCardSchema('证件号'), 'abc')).toBe(
      '证件号格式不正确',
    );
  });

  it('姓名校验接受 2-30 位中英文与中点', /** 字符集或长度放宽会让单字与符号姓名落库。 */ () => {
    const schema = buildRequiredRealNameSchema();

    expect(parseAccepted(schema, '张三')).toBe('张三');
    expect(parseAccepted(schema, 'John')).toBe('John');
    expect(parseAccepted(schema, '买买提·艾力')).toBe('买买提·艾力');
    expect(firstIssueMessage(schema, '张')).toBe(
      '姓名必须为 2-30 位中文、英文或中点',
    );
    expect(firstIssueMessage(schema, '张3')).toBe(
      '姓名必须为 2-30 位中文、英文或中点',
    );
    // 当前实现不接受含空格的外文姓名，与后端 RealNameValidator 口径一致。
    expect(firstIssueMessage(schema, 'John Smith')).toBe(
      '姓名必须为 2-30 位中文、英文或中点',
    );
    expect(firstIssueMessage(schema, undefined)).toBe('请输入姓名');
  });

  it('可选姓名允许留空并沿用同一套判定', /** 把空值判为非法会让选填姓名的资料表单无法提交。 */ () => {
    const schema = buildOptionalRealNameSchema();

    expect(parseAccepted(schema, undefined)).toBeUndefined();
    expect(parseAccepted(schema, '  ')).toBe('');
    expect(parseAccepted(schema, '张三')).toBe('张三');
    expect(firstIssueMessage(schema, '张')).toBe(
      '姓名必须为 2-30 位中文、英文或中点',
    );
    expect(firstIssueMessage(buildOptionalRealNameSchema('联系人'), 'A')).toBe(
      '联系人必须为 2-30 位中文、英文或中点',
    );
  });
});

describe('银行卡与数值校验器', /** 银行卡、百分比与数量规则决定资金与配额字段的可信度。 */ () => {
  it('银行卡号校验按 Luhn 规则拦截错号', /** 只查长度会让输错的卡号进入打款流程。 */ () => {
    const schema = buildRequiredBankCardSchema();

    expect(parseAccepted(schema, '4111111111111111')).toBe('4111111111111111');
    // 该卡号在 Luhn 加权过程中出现大于 9 的乘积，用于验证进位处理。
    expect(parseAccepted(schema, '6222021234567894')).toBe('6222021234567894');
    expect(firstIssueMessage(schema, '4111111111111112')).toBe(
      '银行卡号格式不正确',
    );
    expect(firstIssueMessage(schema, '4111111111')).toBe('银行卡号格式不正确');
    expect(firstIssueMessage(schema, 'undefined')).toBe('银行卡号格式不正确');
    expect(firstIssueMessage(schema, undefined)).toBe('请输入银行卡号');
  });

  it('可选银行卡号允许留空并沿用同一套判定', /** 把空值判为非法会让选填收款信息的表单无法提交。 */ () => {
    const schema = buildOptionalBankCardSchema();

    expect(parseAccepted(schema, undefined)).toBeUndefined();
    expect(parseAccepted(schema, '')).toBe('');
    expect(parseAccepted(schema, '4111111111111111')).toBe('4111111111111111');
    expect(firstIssueMessage(schema, '4111111111111112')).toBe(
      '银行卡号格式不正确',
    );
    expect(
      firstIssueMessage(buildOptionalBankCardSchema('收款卡号'), '1'),
    ).toBe('收款卡号格式不正确');
  });

  it('可选百分比接受数字与数字字符串并拦截越界值', /** 取值范围或小数位放宽会让比例字段失真。 */ () => {
    const schema = buildOptionalPercentSchema();

    expect(parseAccepted(schema, undefined)).toBeUndefined();
    expect(parseAccepted(schema, '')).toBe('');
    expect(parseAccepted(schema, '   ')).toBe('   ');
    expect(parseAccepted(schema, 0)).toBe(0);
    expect(parseAccepted(schema, 100)).toBe(100);
    expect(parseAccepted(schema, '50.25')).toBe('50.25');
    expect(parseAccepted(schema, '100.00')).toBe('100.00');
    expect(firstIssueMessage(schema, '101')).toBe(
      '百分比必须在 0-100 之间，最多保留两位小数',
    );
    expect(firstIssueMessage(schema, '50.555')).toBe(
      '百分比必须在 0-100 之间，最多保留两位小数',
    );
    expect(firstIssueMessage(schema, '-1')).toBe(
      '百分比必须在 0-100 之间，最多保留两位小数',
    );
    expect(firstIssueMessage(buildOptionalPercentSchema('折扣'), 'abc')).toBe(
      '折扣必须在 0-100 之间，最多保留两位小数',
    );
  });

  it('必填百分比拦截空值并沿用同一套判定', /** 漏掉必填判定会让比例字段以空值提交。 */ () => {
    const schema = buildRequiredPercentSchema();

    expect(parseAccepted(schema, 0)).toBe(0);
    expect(parseAccepted(schema, '50')).toBe('50');
    expect(firstIssueMessage(schema, '')).toBe(
      '百分比必须在 0-100 之间，最多保留两位小数',
    );
    // 未填写的必填百分比被联合类型直接拒绝：zod 先判类型再执行精化，
    // 因此 isPresent 的空值守卫在当前契约下无法被外部调用触达。
    expect(schema.safeParse(undefined).success).toBe(false);
    expect(firstIssueMessage(schema, 'abc')).toBe(
      '百分比必须在 0-100 之间，最多保留两位小数',
    );
    expect(firstIssueMessage(buildRequiredPercentSchema('税率'), '')).toBe(
      '税率必须在 0-100 之间，最多保留两位小数',
    );
  });

  it('必填数量只接受非负整数', /** 接受负数或小数会让数量、库存类字段出现无意义取值。 */ () => {
    const schema = buildRequiredQuantitySchema();

    expect(parseAccepted(schema, 0)).toBe(0);
    expect(parseAccepted(schema, 12)).toBe(12);
    expect(firstIssueMessage(schema, -1)).toBe('数量必须为非负整数');
    expect(firstIssueMessage(schema, 1.5)).toBe('数量必须为非负整数');
    expect(firstIssueMessage(schema, undefined)).toBe('请输入数量');
    expect(firstIssueMessage(buildRequiredQuantitySchema('库存'), -1)).toBe(
      '库存必须为非负整数',
    );
    // 数量判定同时被适配层直接复用于表格与接口入参校验，边界必须一致。
    expect(isQuantityValue(0)).toBe(true);
    expect(isQuantityValue(1.5)).toBe(false);
    expect(isQuantityValue(-1)).toBe(false);
  });
});
