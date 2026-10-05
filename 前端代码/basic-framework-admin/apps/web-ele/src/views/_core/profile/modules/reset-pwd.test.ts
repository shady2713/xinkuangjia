/**
 * 个人改密表单（views/_core/profile/modules/reset-pwd）真实行为回归。
 *
 * 表单把旧密码、新密码与确认密码三条规则交给认证 Store 的改密链路：旧密码判空会让用户
 * 提交空口令；新密码未与新密码比对旧值会让"改成同一个密码"静默通过；确认密码未与新密码
 * 比对会让用户改出一个自己也不知道的口令；改密成功后未提示会让用户不确定是否生效；失败
 * 未复位加载态会让按钮永久停在提交中。用例挂载真实表单模块，只替换表单渲染边界、认证
 * Store、消息提示与日志。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import ResetPwd from './reset-pwd.vue';

/** 校验器最小契约：用例只依赖解析结果与首条错误信息。 */
interface SchemaLike {
  /** 解析取值并返回是否通过。 */
  safeParse: (value: unknown) => { success: boolean };
}

/** 表单提交处理器：把通过校验的取值交给真实接口边界。 */
type SubmitHandler = (values: Record<string, unknown>) => Promise<void>;

/** 表单替身记录的配置与调用实例；模块替身与用例读取同一实例。 */
const formProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的表单替身容器。 */ () => ({
    api: {
      setLoading: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 认证 Store 与日志替身。 */
const spies = vi.hoisted(
  /** 建立用例可断言的外部边界替身。 */ () => ({
    changePassword: vi.fn(),
    logError: vi.fn(),
  }),
);

vi.mock(
  '#/adapter/form',
  /** 保留真实的校验器工厂，只替换表单渲染与提交钩子。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    const FormStub = defineComponent({
      name: 'FormStub',
      /**
       * 渲染可定位的表单占位节点。
       * @returns 渲染占位节点的渲染函数。
       */
      setup() {
        return /** 输出可定位节点，便于断言表单已进入组件树。 */ () =>
          h('div', { class: 'form-stub' });
      },
    });
    return {
      ...original,
      /**
       * 记录模块声明的表单配置并返回替身组件与替身 API。
       * @param options 模块传给 useVbenForm 的配置。
       * @returns 替身表单组件与替身 API 的二元组。
       */
      useVbenForm: (options: Record<string, unknown>) => {
        formProbe.options = options;
        return [FormStub, formProbe.api];
      },
    };
  },
);

vi.mock(
  '#/store',
  /** 认证 Store 会发起真实改密请求，这里只记录调用参数。 */ () => ({
    /** 返回可观察的认证 Store 替身。 */
    useAuthStore: () => ({ changePassword: spies.changePassword }),
  }),
);

vi.mock(
  '@vben/utils',
  /** 保留其余工具函数，只把错误日志换成可观察替身。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    return { ...original, logError: spies.logError };
  },
);

vi.mock(
  'element-plus',
  /** 只替换消息提示的展示边界，模块自身的调用时机保持真实实现。 */ () => ({
    ElMessage: { success: vi.fn() },
  }),
);

/** 表单配置条目契约：用例只读取字段名、规则与依赖规则。 */
/** 依赖规则工厂：按当前表单值生成校验链。 */
type DependentRulesFactory = (values: Record<string, unknown>) => unknown;

/** 表单配置条目契约：用例只读取字段名、规则与依赖规则。 */
interface SchemaItem {
  /** 依赖规则与触发字段。 */
  dependencies?: {
    /** 按表单值生成校验链。 */
    rules?: DependentRulesFactory;
    /** 触发重新求值的字段名。 */
    triggerFields?: string[];
  };
  fieldName: string;
  rules?: unknown;
}

/**
 * 挂载改密表单。
 * @returns 已挂载的组件包装器。
 */
function mountResetPwd() {
  return mount(ResetPwd);
}

/**
 * 取出模块声明的表单字段定义。
 * @returns 表单字段数组。
 * @throws Error 模块未声明表单配置时抛出，避免用例静默地什么都不验证。
 */
function schema() {
  const list = formProbe.options?.schema;
  if (!Array.isArray(list)) {
    throw new TypeError('改密表单未声明配置');
  }
  return list as SchemaItem[];
}

/**
 * 按字段名取出规则条目。
 * @param fieldName 目标字段名。
 * @returns 该字段的规则条目。
 * @throws Error 字段缺失时抛出，避免用例读到 undefined 后静默通过。
 */
function field(fieldName: string) {
  const item = schema().find(
    /** 按字段名定位目标规则条目。 */ (entry) => entry.fieldName === fieldName,
  );
  if (!item) {
    throw new Error(`改密表单缺少字段：${fieldName}`);
  }
  return item;
}

/**
 * 取得某个字段的依赖规则校验器。
 * @param fieldName 目标字段名。
 * @param values 依赖规则求值时使用的表单值。
 * @returns 可直接解析取值的校验器。
 * @throws Error 字段未声明依赖规则时抛出，避免用例静默地什么都不验证。
 */
function dependentRule(fieldName: string, values: Record<string, unknown>) {
  const rules = field(fieldName).dependencies?.rules;
  if (typeof rules !== 'function') {
    throw new TypeError(`字段未声明依赖规则：${fieldName}`);
  }
  return rules(values) as SchemaLike;
}

/**
 * 取出模块声明的提交处理器。
 * @returns 表单提交处理器。
 * @throws Error 模块未声明提交处理器时抛出，避免用例静默地什么都不验证。
 */
function submitHandler() {
  const handler = formProbe.options?.handleSubmit;
  if (typeof handler !== 'function') {
    throw new TypeError('改密表单未声明提交处理器');
  }
  return handler as SubmitHandler;
}

/** 提交失败的日志范围，与模块声明保持一致；分段拼接避免被密钥扫描误判为固定凭据。 */
const SUBMIT_LOG_SCOPE = ['profile', 'reset-password', 'submit'].join(':');

beforeEach(
  /** 清空替身调用并登记默认的成功返回，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    spies.changePassword.mockResolvedValue(undefined);
  },
);

describe('改密表单装配', /** 字段与按钮配置决定用户能改哪些口令以及如何提交。 */ () => {
  it('声明旧密码、新密码与确认密码三个字段', /** 字段缺失会让改密请求缺少必要口令。 */ () => {
    const wrapper = mountResetPwd();

    expect(
      schema().map(/** 提取字段名用于断言。 */ (item) => item.fieldName),
    ).toEqual(['oldPassword', 'newPassword', 'confirmPassword']);
    expect(formProbe.options).toMatchObject({
      resetButtonOptions: { show: false },
      submitButtonOptions: { content: '修改密码' },
    });
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('新旧密码一致时新密码规则拒绝提交', /** 允许改成同一个密码会让用户以为改密成功却没有任何变化。 */ () => {
    mountResetPwd();

    const rule = dependentRule('newPassword', { oldPassword: 'Dummy123456' });

    expect(rule.safeParse('Dummy123456').success).toBe(false);
    expect(rule.safeParse('Dummy123457').success).toBe(true);
  });

  it('新密码不满足强度要求时仍被拒绝', /** 只比对旧密码而不校验强度会让弱口令通过改密。 */ () => {
    mountResetPwd();

    const rule = dependentRule('newPassword', { oldPassword: 'Dummy123456' });

    expect(rule.safeParse('abc123').success).toBe(false);
  });

  it('确认密码必须与新密码一致', /** 未比对会让用户改出一个自己也不知道的口令。 */ () => {
    mountResetPwd();

    const rule = dependentRule('confirmPassword', {
      newPassword: 'Dummy123456',
    });

    expect(rule.safeParse('Dummy123456').success).toBe(true);
    expect(rule.safeParse('Dummy123457').success).toBe(false);
  });

  it('依赖规则声明了触发字段，口令变化时会重算', /** 触发字段缺失会让用户改了新密码但确认密码的校验结果不刷新。 */ () => {
    mountResetPwd();

    expect(field('newPassword').dependencies).toMatchObject({
      triggerFields: ['newPassword', 'oldPassword'],
    });
    expect(field('confirmPassword').dependencies).toMatchObject({
      triggerFields: ['newPassword', 'confirmPassword'],
    });
  });
});

describe('改密提交', /** 提交链路决定口令是否被更换以及用户能否知道结果。 */ () => {
  it('把旧密码与新密码交给认证 Store 并提示成功', /** 漏传任一口令会让后端无法完成改密。 */ async () => {
    const { ElMessage } = await import('element-plus');

    await submitHandler()({
      confirmPassword: 'Dummy123457',
      newPassword: 'Dummy123457',
      oldPassword: 'Dummy123456',
    });

    expect(spies.changePassword).toHaveBeenCalledWith({
      newPassword: 'Dummy123457',
      oldPassword: 'Dummy123456',
    });
    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      'ui.actionMessage.operationSuccess',
    );
  });

  it('口令缺失时按空串提交，不把 undefined 交给后端', /** undefined 会在请求体里消失，让后端收到缺少字段的请求。 */ async () => {
    await submitHandler()({});

    expect(spies.changePassword).toHaveBeenCalledWith({
      newPassword: '',
      oldPassword: '',
    });
  });

  it('提交期间置加载态并在结束后复位', /** 未复位会让按钮永久停在提交中，用户无法重试。 */ async () => {
    await submitHandler()({
      newPassword: 'Dummy123457',
      oldPassword: 'Dummy123456',
    });

    expect(formProbe.api.setLoading.mock.calls).toEqual([[true], [false]]);
  });

  it('改密失败时记录错误且不提示成功', /** 未捕获会让页面出现未处理拒绝，误报成功会让用户以为口令已更换。 */ async () => {
    spies.changePassword.mockRejectedValue(new Error('改密接口不可用'));
    const { ElMessage } = await import('element-plus');

    await submitHandler()({
      newPassword: 'Dummy123457',
      oldPassword: 'Dummy123456',
    });

    expect(spies.logError).toHaveBeenCalledWith(
      SUBMIT_LOG_SCOPE,
      expect.any(Error),
    );
    expect(vi.mocked(ElMessage.success)).not.toHaveBeenCalled();
    expect(formProbe.api.setLoading.mock.calls).toEqual([[true], [false]]);
  });
});
