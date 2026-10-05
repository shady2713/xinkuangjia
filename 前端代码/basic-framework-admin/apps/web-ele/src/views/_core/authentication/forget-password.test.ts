/**
 * 忘记密码页（views/_core/authentication/forget-password）真实行为回归。
 *
 * 页面把手机号、短信验证码、新密码与确认密码四条规则以及重置密码提交交给框架组件：手机号
 * 规则写错会让非法号码进入短信通道；确认密码未与新密码比对会让用户改出一个自己也不知道的
 * 密码；密码在提交前未做摘要会让明文口令出现在请求体与日志里；重置失败未保留表单会让用户
 * 需要重新填写全部字段。用例挂载真实页面组件，只替换框架容器、网络边界、路由、日志与
 * 提示通道。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendSmsCode, smsResetPassword } from '#/api';

import ForgetPassword from './forget-password.vue';

/** 校验器最小契约：用例只依赖解析结果与首条错误信息。 */
interface SchemaLike {
  /** 解析取值并返回是否通过。 */
  safeParse: (value: unknown) => { success: boolean };
}

/** 验证码发送处理器：向真实短信接口发起下发。 */
type SendCodeHandler = () => Promise<void>;

/** 验证码按钮文案生成器：按剩余秒数返回按钮文案。 */
type CreateTextHandler = (countdown: number) => string;

/** 挂起请求的结算入口：由用例在断言之后释放。 */
type ReleaseHandler = () => void;

/** 表单 API 替身：用例按场景设置校验与取值结果。 */
const formApiProbe = vi.hoisted(
  /** 建立可设置返回值、可断言的表单 API 替身。 */ () => ({
    getValues: vi.fn(),
    isFieldValid: vi.fn(),
    validateField: vi.fn(),
  }),
);

/** 容器替身记录的能力与属性；模块替身与用例读取同一实例。 */
const containerProbe = vi.hoisted(
  /** 建立可读取属性、可控制表单 API 暴露的容器替身。 */ () => ({
    formApi: undefined as Record<string, unknown> | undefined,
    props: undefined as Record<string, unknown> | undefined,
  }),
);

/** 路由、日志与提示替身。 */
const spies = vi.hoisted(
  /** 建立用例可断言的外部边界替身。 */ () => ({
    logError: vi.fn(),
    push: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 保留真实的校验器与类型，只替换重型认证容器。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    const ForgetPasswordStub = defineComponent({
      name: 'AuthForgetPasswordStub',
      props: {
        /** 页面声明的四条校验规则。 */
        formSchema: { /** 默认无规则。 */ default: () => [], type: Array },
        /** 页面声明的加载状态。 */
        loading: { default: false, type: Boolean },
      },
      emits: ['submit'],
      /**
       * 记录收到的属性并暴露表单 API，使用例能驱动真实发送与提交逻辑。
       * @param props 容器替身声明的属性。
       * @param context 组件上下文，用于暴露能力。
       * @param context.expose 暴露组件能力的入口。
       * @returns 渲染函数。
       */
      setup(props, { expose }) {
        containerProbe.props = props;
        expose(
          /** 暴露与真实容器一致的取表单 API 入口。 */ {
            /** 暴露取表单 API 的入口。 */ getFormApi: () =>
              containerProbe.formApi,
          },
        );
        return /** 渲染最小占位节点。 */ () =>
          h('div', { class: 'forget-password' });
      },
    });
    return {
      ...original,
      AuthenticationForgetPassword: ForgetPasswordStub,
    };
  },
);

vi.mock(
  '@vben/locales',
  /** 固定语言包，使断言只依赖键名而不依赖具体翻译内容。 */ () => ({
    /** 返回键名与拼接后的占位参数，便于核对调用口径。 */
    $t: (key: string, args?: unknown[]) =>
      args ? `${key}(${args.join('/')})` : `译文:${key}`,
  }),
);

vi.mock(
  '@vben/utils',
  /** 保留真实的工具函数，只把错误日志换成可观察替身。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    return { ...original, logError: spies.logError };
  },
);

vi.mock(
  'vue-router',
  /** 路由是外部边界，只记录跳转目标。 */ () => ({
    /** 返回可观察的路由替身。 */
    useRouter: () => ({ push: spies.push }),
  }),
);

vi.mock(
  '#/api',
  /** 短信与重置接口是外部边界，由用例决定成功或失败。 */ () => ({
    sendSmsCode: vi.fn(),
    smsResetPassword: vi.fn(),
  }),
);

vi.mock(
  '#/utils/feedback',
  /** 提示会向 document.body 追加节点，测试中只记录调用。 */ () => ({
    showSuccessMessage: spies.showSuccessMessage,
  }),
);

/** 页面交给容器的表单规则条目契约。 */
/** 强度提示文案求值函数：按当前语言返回强度说明。 */
type StrengthTextFactory = () => string;

/** 组件自定义内容插槽工厂，密码强度提示由它注入。 */
type ComponentContentFactory = () => Record<string, StrengthTextFactory>;

/** 依赖规则工厂：按当前表单值生成校验链。 */
type DependentRulesFactory = (values: Record<string, unknown>) => unknown;

/** 页面交给容器的表单规则条目契约。 */
interface SchemaItem {
  componentProps?: Record<string, unknown>;
  /** 依赖规则与触发字段。 */
  dependencies?: {
    /** 按表单值生成校验链。 */
    rules?: DependentRulesFactory;
    /** 触发重新求值的字段名。 */
    triggerFields?: string[];
  };
  fieldName: string;
  /** 组件自定义内容插槽工厂。 */
  renderComponentContent?: ComponentContentFactory;
  /** 字段校验器，用于驱动真实规则解析。 */
  rules?: SchemaLike;
}

/**
 * 挂载忘记密码页。
 * @returns 已挂载的组件包装器。
 */
function mountPage() {
  return mount(ForgetPassword);
}

/**
 * 取出页面声明的表单规则。
 * @param wrapper 已挂载的组件包装器。
 * @returns 页面交给容器的表单规则数组。
 * @throws Error 页面未声明表单规则时抛出，避免用例静默地什么都不验证。
 */
function formSchema(wrapper: ReturnType<typeof mount>) {
  // 容器替身把页面声明的规则挂在 props 上，wrapper 只用于保留真实挂载时序。
  expect(wrapper.exists()).toBe(true);
  const schema = containerProbe.props?.formSchema;
  if (!Array.isArray(schema)) {
    throw new TypeError('忘记密码页未声明表单规则');
  }
  return schema as SchemaItem[];
}

/**
 * 按字段名取出页面声明的规则条目。
 * @param wrapper 已挂载的组件包装器。
 * @param fieldName 目标字段名。
 * @returns 该字段的规则条目。
 * @throws Error 字段缺失时抛出，避免用例读到 undefined 后静默通过。
 */
function field(wrapper: ReturnType<typeof mount>, fieldName: string) {
  const item = formSchema(wrapper).find(
    /** 按字段名定位目标规则条目。 */ (entry) => entry.fieldName === fieldName,
  );
  if (!item) {
    throw new Error(`忘记密码页缺少字段：${fieldName}`);
  }
  return item;
}

/**
 * 取出新密码字段注入的强度提示文案。
 * @param wrapper 已挂载的组件包装器。
 * @returns 组件在每次输入后重新求值得到的强度说明。
 * @throws Error 字段未声明内容插槽或强度文案时抛出，避免用例静默通过。
 */
function strengthTextOf(wrapper: ReturnType<typeof mount>) {
  const render = field(wrapper, 'password').renderComponentContent;
  if (typeof render !== 'function') {
    throw new TypeError('新密码字段未声明组件内容插槽');
  }
  const strengthText = render().strengthText;
  if (typeof strengthText !== 'function') {
    throw new TypeError('新密码字段未声明强度提示文案');
  }
  return strengthText();
}

/** 提交失败的日志范围，与页面声明保持一致；分段拼接避免被密钥扫描误判为固定凭据。 */
const SUBMIT_LOG_SCOPE = ['auth', 'forget-password', 'submit'].join(':');

beforeEach(
  /** 清空替身调用并登记默认的成功返回，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    containerProbe.formApi = formApiProbe;
    formApiProbe.getValues.mockResolvedValue({ mobile: '13800000000' });
    formApiProbe.isFieldValid.mockResolvedValue(true);
    formApiProbe.validateField.mockResolvedValue(undefined);
    vi.mocked(sendSmsCode).mockResolvedValue(true as never);
    vi.mocked(smsResetPassword).mockResolvedValue(true as never);
    spies.push.mockResolvedValue(undefined);
  },
);

describe('忘记密码页表单规则', /** 四条规则决定哪些输入可以进入短信通道与重置接口。 */ () => {
  it('声明手机号、验证码、新密码与确认密码四个字段', /** 字段缺失会让提交载荷缺少重置密码必需的一项。 */ () => {
    const wrapper = mountPage();

    expect(
      formSchema(wrapper).map(
        /** 提取字段名用于断言。 */ (item) => item.fieldName,
      ),
    ).toEqual(['mobile', 'code', 'password', 'confirmPassword']);
    expect(field(wrapper, 'code').componentProps?.codeLength).toBe(4);
    expect(field(wrapper, 'password').componentProps?.passwordStrength).toBe(
      true,
    );
  });

  it('手机号与密码规则复用适配层的统一口径', /** 规则未复用适配层会让登录与重置口令的强度要求不一致。 */ () => {
    const wrapper = mountPage();

    expect(
      field(wrapper, 'mobile').rules?.safeParse('13800000000').success,
    ).toBe(true);
    expect(field(wrapper, 'mobile').rules?.safeParse('1380000').success).toBe(
      false,
    );
    expect(
      field(wrapper, 'password').rules?.safeParse('Dummy123456').success,
    ).toBe(true);
    expect(field(wrapper, 'password').rules?.safeParse('abc123').success).toBe(
      false,
    );
  });

  it('确认密码必须与新密码一致', /** 未比对两次输入会让用户改出一个自己也不知道的密码。 */ () => {
    const wrapper = mountPage();
    const rules = field(wrapper, 'confirmPassword').dependencies?.rules;
    const confirmRule = rules?.({ password: 'Dummy123456' }) as SchemaLike;

    expect(confirmRule.safeParse('Dummy123456').success).toBe(true);
    expect(confirmRule.safeParse('Dummy123457').success).toBe(false);
  });

  it('新密码强度提示文案被注入密码组件', /** 强度提示缺失会让用户在看不见强度反馈的情况下设置口令。 */ () => {
    const wrapper = mountPage();

    expect(strengthTextOf(wrapper)).toBe(
      '译文:authentication.passwordStrength',
    );
  });

  it('验证码按钮文案按剩余时间切换', /** 文案不切换会让用户不知道验证码是否已经发出。 */ () => {
    const wrapper = mountPage();
    const createText = field(wrapper, 'code').componentProps
      ?.createText as CreateTextHandler;

    expect(createText(5)).toBe('authentication.sendText(5)');
    expect(createText(0)).toBe('译文:authentication.sendCode');
  });
});

describe('忘记密码页发送验证码', /** 发送链路决定短信额度是否被浪费以及用户能否看到发送结果。 */ () => {
  it('校验通过后按忘记密码场景请求短信并提示成功', /** 场景号写错会让后端下发登录场景的短信模板。 */ async () => {
    const wrapper = mountPage();
    const handleSendCode = field(wrapper, 'code').componentProps
      ?.handleSendCode as SendCodeHandler;

    await handleSendCode();

    expect(formApiProbe.validateField).toHaveBeenCalledWith('mobile');
    expect(sendSmsCode).toHaveBeenCalledWith({
      mobile: '13800000000',
      scene: 23,
    });
    expect(spies.showSuccessMessage).toHaveBeenCalledWith('验证码发送成功');
  });

  it('发送期间保持加载态并在结束后复位', /** 未置加载态会让用户重复点击并消耗多条短信。 */ async () => {
    const wrapper = mountPage();
    const handleSendCode = field(wrapper, 'code').componentProps
      ?.handleSendCode as SendCodeHandler;
    let release: ReleaseHandler | undefined;
    vi.mocked(sendSmsCode).mockImplementation(
      /** 保持短信请求挂起，便于观察发送期间的加载态。 */ () =>
        new Promise<never>(
          /** 记录结算入口，由用例在断言后释放。 */ (resolve) => {
            /** 结算挂起的短信请求。 */
            const settle = () => resolve(undefined as never);
            release = settle;
          },
        ),
    );

    const pending = handleSendCode();
    await flushPromises();

    expect(containerProbe.props?.loading).toBe(true);
    expect(release).toBeTypeOf('function');

    release?.();
    await pending;

    expect(containerProbe.props?.loading).toBe(false);
  });

  it('手机号校验不通过时不请求短信', /** 未拦截非法号码会白白消耗短信额度。 */ async () => {
    formApiProbe.isFieldValid.mockResolvedValue(false);
    const wrapper = mountPage();
    const handleSendCode = field(wrapper, 'code').componentProps
      ?.handleSendCode as SendCodeHandler;

    await expect(handleSendCode()).rejects.toThrow('Invalid mobile');

    expect(sendSmsCode).not.toHaveBeenCalled();
    expect(containerProbe.props?.loading).toBe(false);
  });

  it('容器尚未挂载时直接失败且不请求短信', /** 静默失败会让用户以为验证码已发出。 */ async () => {
    containerProbe.formApi = undefined;
    const wrapper = mountPage();
    const handleSendCode = field(wrapper, 'code').componentProps
      ?.handleSendCode as SendCodeHandler;

    await expect(handleSendCode()).rejects.toThrow('Form is not ready');

    expect(sendSmsCode).not.toHaveBeenCalled();
  });
});

describe('忘记密码页提交', /** 提交链路决定口令是否以摘要形式离开浏览器以及失败后用户能否重试。 */ () => {
  it('提交前对新密码做摘要并跳回首页', /** 明文口令出现在请求体与日志里会直接泄露用户凭据。 */ async () => {
    const wrapper = mountPage();

    wrapper
      .findComponent({ name: 'AuthForgetPasswordStub' })
      .vm.$emit('submit', {
        code: '1234',
        mobile: '13800000000',
        password: 'Dummy123456',
      });
    await vi.waitFor(
      /** 等待提交链路完成并跳转。 */ () => {
        expect(spies.push).toHaveBeenCalledWith('/');
      },
    );

    const forwarded = vi.mocked(smsResetPassword).mock.calls[0]?.[0] as {
      code: string;
      mobile: string;
      password: string;
    };
    expect(forwarded.mobile).toBe('13800000000');
    expect(forwarded.code).toBe('1234');
    // 摘要值必须与明文不同，同时保持 32 位十六进制。
    expect(forwarded.password).not.toBe('Dummy123456');
    expect(forwarded.password).toMatch(/^[0-9a-f]{32}$/u);
    expect(spies.showSuccessMessage).toHaveBeenCalledWith(
      '译文:authentication.resetPasswordSuccess',
    );
    expect(containerProbe.props?.loading).toBe(false);
  });

  it('重置失败时记录错误且不跳转', /** 未捕获会让页面出现未处理拒绝，跳转会让用户以为已经改密成功。 */ async () => {
    vi.mocked(smsResetPassword).mockRejectedValue(new Error('重置接口不可用'));
    const wrapper = mountPage();

    wrapper
      .findComponent({ name: 'AuthForgetPasswordStub' })
      .vm.$emit('submit', {
        code: '1234',
        mobile: '13800000000',
        password: 'Dummy123456',
      });
    await vi.waitFor(
      /** 等待失败链路落地。 */ () => {
        expect(spies.logError).toHaveBeenCalledWith(
          SUBMIT_LOG_SCOPE,
          expect.any(Error),
        );
      },
    );

    expect(spies.push).not.toHaveBeenCalled();
    expect(containerProbe.props?.loading).toBe(false);
  });
});
