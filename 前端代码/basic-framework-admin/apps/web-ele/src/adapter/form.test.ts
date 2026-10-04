/**
 * 表单适配层（apps/web-ele 的 adapter/form）真实行为回归。
 *
 * 该模块是应用所有表单的统一入口：它向表单内核登记控件映射与命名校验规则，并重新导出
 * 字段规则与常量。规则实现写错会让非法账号、密码、手机号、邮箱、身份证、姓名、银行卡
 * 与百分比通过校验并落库；必填提示的动作模板写错会让上传字段提示"请输入"；未声明字段
 * 标签时提示会退化成空名称；创建表单时属性未透传会让页面声明的布局与字段配置丢失。
 * 用例只替换表单内核的注册与创建入口以及翻译边界，规则实现与重导出保持真实。
 */
import type { ComponentType, VbenFormProps } from './form';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DATE_FORMAT as FIELD_DATE_FORMAT,
  isEmailValue as fieldIsEmailValue,
} from './field-rules';
import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_DATETIME_FORMAT,
  getRequiredFieldMessage,
  initSetupVbenForm,
  isBankCardNoValue,
  isEmailValue,
  isIdCardValue,
  isMobileValue,
  isPasswordValue,
  isPercentValue,
  isQuantityValue,
  isRealNameValue,
  isUsernameValue,
  useVbenForm,
} from './form';

/** 命名规则签名：与表单内核的 NamedFormRule 契约一致，返回 true 或错误文案。 */
type RuleFn = (
  value: unknown,
  params: Record<string, unknown> | unknown[],
  context: RuleContext,
) => boolean | Promise<boolean | string> | string;

/** 规则读取的校验上下文；真实上下文由 vee-validate 提供，规则只读取字段标签。 */
interface RuleContext {
  /** 字段标签，未声明标签时 undefined。 */
  label?: string;
}

/** 表单内核替身记录：登记内容、创建参数与返回值；模块替身与用例读取同一实例。 */
const kernelProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的表单内核替身容器。 */ () => ({
    /** 创建表单时返回的组件替身。 */
    formComponent: { name: 'FormStub' },
    /** 创建表单时返回的操作实例替身。 */
    formApi: { getValues: vi.fn() },
    /** 应用登记的控件映射与命名规则。 */
    setupOptions: undefined as
      | undefined
      | { config?: unknown; defineRules?: Record<string, RuleFn> },
    /** 创建表单时收到的属性，按调用顺序排列。 */
    useFormArgs: [] as unknown[],
    /** 重新导出的 z 校验对象替身。 */
    z: { marker: 'DUMMY-z' },
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换表单内核的注册与创建入口，命名规则实现与重导出保持真实。 */ () => ({
    /**
     * 记录应用登记的控件映射与命名规则。
     * @param options 应用传给表单内核的注册配置。
     */
    setupVbenForm: vi.fn(
      /** 记录注册配置供用例取出真实规则集合。 */ (options: {
        config?: unknown;
        defineRules?: Record<string, RuleFn>;
      }) => {
        kernelProbe.setupOptions = options;
      },
    ),
    /**
     * 记录创建表单时收到的属性并返回可断言的组件与实例。
     * @param options 页面传给表单适配层的属性。
     * @returns 表单组件替身与操作实例替身的二元组。
     */
    useVbenForm: vi.fn(
      /** 记录创建参数并返回固定替身。 */ (options: unknown) => {
        kernelProbe.useFormArgs.push(options);
        return [kernelProbe.formComponent, kernelProbe.formApi];
      },
    ),
    z: kernelProbe.z,
  }),
);

vi.mock(
  '@vben/locales',
  /** 只替换翻译边界，便于核对规则请求的语言键与占位参数。 */ () => ({
    /**
     * 把语言键与占位参数拼成可预期的译文。
     * @param key 规则请求的语言键。
     * @param args 语言键的可选占位参数。
     * @returns 带参数时拼接参数，否则回显键名。
     */
    $t: (key: string, args?: string[]) =>
      args ? `${key}(${args.join('/')})` : key,
  }),
);

/**
 * 触发一次应用表单初始化并取出登记的命名规则。
 * @returns 应用登记的命名规则集合。
 * @throws Error 应用未登记命名规则时抛出，避免用例静默地什么都不验证。
 */
async function registerRules() {
  await initSetupVbenForm();
  const rules = kernelProbe.setupOptions?.defineRules;
  if (!rules) {
    throw new Error('应用未登记命名规则');
  }
  return rules;
}

/**
 * 用最小校验上下文调用命名规则；规则只读取字段标签。
 * @param rules 应用登记的规则集合。
 * @param name 规则名。
 * @param value 待校验的控件值。
 * @param label 字段标签，省略时按未声明标签处理。
 * @returns 规则返回的通过状态或错误文案。
 * @throws Error 规则未登记时抛出，避免用例静默地什么都不验证。
 */
async function runRule(
  rules: Record<string, RuleFn>,
  name: string,
  value: unknown,
  label?: string,
) {
  const rule = rules[name];
  if (!rule) {
    throw new Error(`应用未登记规则：${name}`);
  }
  return await rule(value, [], label === undefined ? {} : { label });
}

beforeEach(
  /** 清空内核替身调用，避免上一例的登记与创建记录影响断言。 */ () => {
    vi.clearAllMocks();
    kernelProbe.useFormArgs.length = 0;
    kernelProbe.setupOptions = undefined;
  },
);

describe('必填规则与提示模板', /** 必填判定与提示文案直接面向用户，判错会让空值落库。 */ () => {
  it('空值被拒并给出必填文案', /** 空串与空白文本必须判为空，否则会写入空字段。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'required', undefined, '用户名')).toBe(
      'ui.formRules.required(用户名)',
    );
    expect(await runRule(rules, 'required', '   ', '用户名')).toBe(
      'ui.formRules.required(用户名)',
    );
    expect(await runRule(rules, 'required', [], '用户名')).toBe(
      'ui.formRules.required(用户名)',
    );
  });

  it('数值 0 与布尔 false 视为有效取值', /** 把 0 或 false 判为空会让合法配置无法保存。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'required', 0, '排序')).toBe(true);
    expect(await runRule(rules, 'required', false, '开关')).toBe(true);
  });

  it('字段未声明标签时提示保留空名称', /** 直接拼接 undefined 会出现 "请输入undefined"。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'required', '', undefined)).toBe(
      'ui.formRules.required()',
    );
  });

  it('选择规则使用选择文案', /** 复用输入文案会让用户误以为要手动输入。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'selectRequired', undefined, '状态')).toBe(
      'ui.formRules.selectRequired(状态)',
    );
    expect(await runRule(rules, 'selectRequired', 0, '状态')).toBe(true);
  });

  it('上传规则使用上传文案并在有值时通过', /** 上传字段提示"请输入"会让用户找不到输入框。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'uploadRequired', '', '附件')).toBe(
      '请上传附件',
    );
    expect(
      await runRule(rules, 'uploadRequired', ['DUMMY-file.png'], '附件'),
    ).toBe(true);
  });

  it('必填提示按动作类型选择模板', /** 动作模板选错会让上传字段出现输入提示。 */ () => {
    expect(getRequiredFieldMessage('用户名')).toBe(
      'ui.formRules.required(用户名)',
    );
    expect(getRequiredFieldMessage('状态', 'select')).toBe(
      'ui.formRules.selectRequired(状态)',
    );
    expect(getRequiredFieldMessage('附件', 'upload')).toBe('请上传附件');
    expect(getRequiredFieldMessage(undefined, 'upload')).toBe('请上传');
  });
});

describe('账号与密码规则', /** 账号密码是最敏感的落库字段，校验过松会写入弱凭据。 */ () => {
  it('可选账号规则放行空值并校验字符集与长度', /** 长度或字符集写错会让非法账号通过。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'username', '', '用户名')).toBe(true);
    expect(await runRule(rules, 'username', 'abcd1234', '用户名')).toBe(true);
    expect(await runRule(rules, 'username', 'abc', '用户名')).toBe(
      '用户名必须为 4-30 位字母或数字',
    );
    expect(await runRule(rules, 'username', '用户名123', '用户名')).toBe(
      '用户名必须为 4-30 位字母或数字',
    );
  });

  it('必填账号规则对空值给出必填文案', /** 空值只报格式错误会让用户不知道必须填写。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'usernameRequired', '', '用户名')).toBe(
      'ui.formRules.required(用户名)',
    );
    expect(await runRule(rules, 'usernameRequired', 'abc', '用户名')).toBe(
      '用户名必须为 4-30 位字母或数字',
    );
  });

  it('可选密码规则放行空值并要求大小写与数字组合', /** 复杂度校验过松会写入弱密码。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'password', '', '密码')).toBe(true);
    expect(await runRule(rules, 'password', 'Abc123', '密码')).toBe(true);
    expect(await runRule(rules, 'password', 'abcdef', '密码')).toBe(
      '密码必须为 6-16 位，且同时包含大写字母、小写字母和数字',
    );
    expect(await runRule(rules, 'password', 'Abcdefgh', '密码')).toBe(
      '密码必须为 6-16 位，且同时包含大写字母、小写字母和数字',
    );
  });

  it('必填密码规则对空值给出必填文案', /** 空值只报复杂度错误会让用户不知道必须填写。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'passwordRequired', undefined, '密码')).toBe(
      'ui.formRules.required(密码)',
    );
    expect(await runRule(rules, 'passwordRequired', 'abc', '密码')).toBe(
      '密码必须为 6-16 位，且同时包含大写字母、小写字母和数字',
    );
  });
});

describe('联系方式与身份规则', /** 这些字段会用于通知与实名，格式写错会造成无法送达或实名失败。 */ () => {
  it('可选手机号规则放行空值并校验号段格式', /** 接受非 1 开头或长度不足的号码会让短信无法送达。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'mobile', '', '手机号')).toBe(true);
    expect(await runRule(rules, 'mobile', '13800000000', '手机号')).toBe(true);
    expect(await runRule(rules, 'mobile', '2380000000', '手机号')).toBe(
      'ui.formRules.mobile(手机号)',
    );
  });

  it('必填手机号规则对空值给出必填文案', /** 空值只报格式错误会让用户不知道必须填写。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'mobileRequired', '', '手机号')).toBe(
      'ui.formRules.required(手机号)',
    );
    expect(await runRule(rules, 'mobileRequired', '1380000000', '手机号')).toBe(
      'ui.formRules.mobile(手机号)',
    );
  });

  it('可选邮箱规则放行空值并校验域名后缀', /** 缺少顶级域名校验会让非法邮箱落库。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'email', '', '邮箱')).toBe(true);
    expect(await runRule(rules, 'email', 'user@example.com', '邮箱')).toBe(
      true,
    );
    expect(await runRule(rules, 'email', 'user@', '邮箱')).toBe(
      '邮箱格式不正确',
    );
  });

  it('必填邮箱规则对空值给出必填文案', /** 空值只报格式错误会让用户不知道必须填写。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'emailRequired', undefined, '邮箱')).toBe(
      'ui.formRules.required(邮箱)',
    );
    expect(await runRule(rules, 'emailRequired', 'user@', '邮箱')).toBe(
      '邮箱格式不正确',
    );
  });

  it('身份证规则校验生日与校验位', /** 只校验长度会让错误号码通过实名。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'idCard', '', '身份证号')).toBe(true);
    expect(
      await runRule(rules, 'idCard', '11010519491231002X', '身份证号'),
    ).toBe(true);
    // 校验位大小写不敏感，小写 x 与空格同样合法。
    expect(
      await runRule(rules, 'idCard', ' 11010519491231002x ', '身份证号'),
    ).toBe(true);
    expect(
      await runRule(rules, 'idCard', '110105194912310021', '身份证号'),
    ).toBe('身份证号格式不正确');
  });

  it('姓名规则要求中文、英文或中点且至少两位', /** 单位姓名与数字姓名会让实名核验失败。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'realName', '', '姓名')).toBe(true);
    expect(await runRule(rules, 'realName', '张三', '姓名')).toBe(true);
    expect(await runRule(rules, 'realName', 'A', '姓名')).toBe(
      '姓名必须为 2-30 位中文、英文或中点',
    );
    expect(await runRule(rules, 'realName', '张三1', '姓名')).toBe(
      '姓名必须为 2-30 位中文、英文或中点',
    );
  });

  it('银行卡号规则校验长度与校验位', /** 只校验数字会让错误卡号通过并导致打款失败。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'bankCardNo', '', '银行卡号')).toBe(true);
    expect(
      await runRule(rules, 'bankCardNo', '6222021234567894', '银行卡号'),
    ).toBe(true);
    expect(
      await runRule(rules, 'bankCardNo', '6222021234567890', '银行卡号'),
    ).toBe('银行卡号格式不正确');
  });

  it('百分比规则限制在 0-100 且最多两位小数', /** 越界或过多小数会让比例计算失真。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'percent', '', '百分比')).toBe(true);
    expect(await runRule(rules, 'percent', '50.25', '百分比')).toBe(true);
    expect(await runRule(rules, 'percent', '100', '百分比')).toBe(true);
    expect(await runRule(rules, 'percent', '101', '百分比')).toBe(
      '百分比必须在 0-100 之间，最多保留两位小数',
    );
    expect(await runRule(rules, 'percent', '1.234', '百分比')).toBe(
      '百分比必须在 0-100 之间，最多保留两位小数',
    );
  });

  it('数量规则只接受非负整数并转换字符串取值', /** 接受小数或负数会让库存与配额出现非法值。 */ async () => {
    const rules = await registerRules();

    expect(await runRule(rules, 'quantity', '', '数量')).toBe(true);
    expect(await runRule(rules, 'quantity', 5, '数量')).toBe(true);
    expect(await runRule(rules, 'quantity', '5', '数量')).toBe(true);
    expect(await runRule(rules, 'quantity', -1, '数量')).toBe(
      '数量必须为非负整数',
    );
    expect(await runRule(rules, 'quantity', 1.5, '数量')).toBe(
      '数量必须为非负整数',
    );
  });
});

describe('表单适配入口', /** 登记与创建入口决定应用表单是否使用统一的控件映射与规则。 */ () => {
  it('登记控件映射与全部命名规则', /** 漏登记会让控件取值绑定错字段或规则不生效。 */ async () => {
    const rules = await registerRules();

    expect(kernelProbe.setupOptions?.config).toEqual({
      modelPropNameMap: {
        CheckboxGroup: 'model-value',
        Upload: 'fileList',
      },
    });
    expect(Object.keys(rules).toSorted()).toEqual([
      'bankCardNo',
      'email',
      'emailRequired',
      'idCard',
      'mobile',
      'mobileRequired',
      'password',
      'passwordRequired',
      'percent',
      'quantity',
      'realName',
      'required',
      'selectRequired',
      'uploadRequired',
      'username',
      'usernameRequired',
    ]);
  });

  it('重复初始化保持同一份注册内容', /** 非幂等注册会让后一次启动覆盖掉规则或控件映射。 */ async () => {
    const first = await registerRules();
    const second = await registerRules();

    expect(Object.keys(second)).toEqual(Object.keys(first));
    expect(kernelProbe.setupOptions?.config).toEqual({
      modelPropNameMap: {
        CheckboxGroup: 'model-value',
        Upload: 'fileList',
      },
    });
  });

  it('创建表单时把属性透传给表单内核并返回内核结果', /** 属性未透传会让页面声明的布局与字段配置丢失。 */ () => {
    const options = {} as VbenFormProps<ComponentType>;

    const result = useVbenForm(options);

    expect(kernelProbe.useFormArgs).toEqual([options]);
    expect(result).toEqual([kernelProbe.formComponent, kernelProbe.formApi]);
  });

  it('重新导出字段规则与日期格式常量', /** 页面只从适配层导入，漏导出会让页面拿到 undefined。 */ () => {
    expect(DEFAULT_DATE_FORMAT).toBe(FIELD_DATE_FORMAT);
    expect(DEFAULT_DATE_FORMAT).toBe('YYYY-MM-DD');
    expect(DEFAULT_DATETIME_FORMAT).toBe('YYYY-MM-DD HH:mm:ss');
    expect(isEmailValue).toBe(fieldIsEmailValue);
    expect(isEmailValue('user@example.com')).toBe(true);
    expect(isUsernameValue('abcd1234')).toBe(true);
    expect(isPasswordValue('Abc123')).toBe(true);
    expect(isMobileValue('13800000000')).toBe(true);
    expect(isIdCardValue('11010519491231002X')).toBe(true);
    expect(isRealNameValue('张三')).toBe(true);
    expect(isBankCardNoValue('6222021234567894')).toBe(true);
    expect(isPercentValue('50.25')).toBe(true);
    expect(isQuantityValue(5)).toBe(true);
  });
});
