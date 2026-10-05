/**
 * 手机验证码登录页（views/_core/authentication/code-login）真实行为回归。
 *
 * 页面把手机号与验证码两条校验规则、验证码发送与登录提交交给框架组件：手机号规则写松会让
 * 非法号码进入短信通道、写严会让正常号码无法登录；验证码长度规则与输入框长度不一致会让
 * 用户永远提交不了；发送验证码前未校验手机号会白白消耗短信额度；发送期间未置加载态会让
 * 用户重复点击；提交前未收窄字段会把非法载荷交给认证 Store。用例挂载真实页面组件，
 * 只替换框架的登录容器、网络边界、认证 Store、日志与提示通道。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendSmsCode } from '#/api';

import CodeLogin from './code-login.vue';

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

/** 登录容器替身记录的属性与暴露能力；模块替身与用例读取同一实例。 */
const loginProbe = vi.hoisted(
  /** 建立可读取属性、可暴露表单 API 的登录容器替身。 */ () => ({
    formApi: undefined as Record<string, unknown> | undefined,
    props: undefined as Record<string, unknown> | undefined,
  }),
);

/** 认证 Store 与日志替身。 */
const spies = vi.hoisted(
  /** 建立用例可断言的外部边界替身。 */ () => ({
    authLogin: vi.fn(),
    logError: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 保留真实的校验器与类型，只替换重型登录容器。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    const AuthenticationCodeLoginStub = defineComponent({
      name: 'AuthCodeLoginStub',
      props: {
        /** 页面声明的手机号与验证码规则。 */
        formSchema: { /** 默认无规则。 */ default: () => [], type: Array },
        /** 页面声明的加载状态，用于核对发送验证码期间的按钮状态。 */
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
        loginProbe.props = props;
        expose(
          /** 暴露与真实容器一致的取表单 API 入口。 */ {
            /** 暴露取表单 API 的入口。 */ getFormApi: () => loginProbe.formApi,
          },
        );
        return /** 渲染最小占位节点。 */ () =>
          h('div', { class: 'code-login' });
      },
    });
    return {
      ...original,
      AuthenticationCodeLogin: AuthenticationCodeLoginStub,
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
  /** 保留其余工具函数，只把错误日志换成可观察替身。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    return { ...original, logError: spies.logError };
  },
);

vi.mock(
  '#/api',
  /** 短信接口是外部边界，由用例决定成功或失败。 */ () => ({
    sendSmsCode: vi.fn(),
  }),
);

vi.mock(
  '#/store',
  /** 认证 Store 会发起真实登录请求，这里只记录调用参数。 */ () => ({
    /** 返回可观察的认证 Store 替身。 */
    useAuthStore: () => ({ authLogin: spies.authLogin }),
  }),
);

vi.mock(
  '#/utils/feedback',
  /** 提示会向 document.body 追加节点，测试中只记录调用。 */ () => ({
    showSuccessMessage: spies.showSuccessMessage,
  }),
);

/**
 * 挂载手机验证码登录页。
 * @returns 已挂载的组件包装器。
 */
function mountCodeLogin() {
  return mount(CodeLogin);
}

/**
 * 取出页面声明的表单规则。
 * @param wrapper 已挂载的组件包装器。
 * @returns 页面交给登录容器的表单规则数组。
 * @throws Error 页面未声明表单规则时抛出，避免用例静默地什么都不验证。
 */
function formSchema(wrapper: ReturnType<typeof mount>) {
  // 容器替身把页面声明的规则挂在 props 上，wrapper 只用于保留真实挂载时序。
  expect(wrapper.exists()).toBe(true);
  const schema = loginProbe.props?.formSchema;
  if (!Array.isArray(schema)) {
    throw new TypeError('登录页未声明表单规则');
  }
  return schema as Array<{
    componentProps?: Record<string, unknown>;
    fieldName: string;
    /** 字段校验器，用于驱动真实规则解析。 */
    rules?: SchemaLike;
  }>;
}

beforeEach(
  /** 清空替身调用并登记默认的成功返回，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    loginProbe.formApi = formApiProbe;
    formApiProbe.getValues.mockResolvedValue({
      code: '1234',
      mobile: '13800000000',
    });
    formApiProbe.isFieldValid.mockResolvedValue(true);
    formApiProbe.validateField.mockResolvedValue(undefined);
    vi.mocked(sendSmsCode).mockResolvedValue(true as never);
    spies.authLogin.mockResolvedValue(undefined);
  },
);

describe('手机验证码登录页表单规则', /** 规则决定哪些手机号与验证码可以进入短信通道与登录链路。 */ () => {
  it('声明手机号与验证码两个字段并按语言包取文案', /** 字段名写错会让登录载荷缺失关键字段。 */ () => {
    const wrapper = mountCodeLogin();
    const schema = formSchema(wrapper);

    expect(
      schema.map(/** 提取字段名用于断言。 */ (item) => item.fieldName),
    ).toEqual(['mobile', 'code']);
    expect(schema[0]?.componentProps?.placeholder).toBe(
      '译文:authentication.mobile',
    );
    // 验证码输入框长度必须与规则里的长度一致，否则用户永远提交不了。
    expect(schema[1]?.componentProps?.codeLength).toBe(4);
  });

  it('手机号规则只接受十一位数字', /** 规则写松会让非法号码进入短信通道，写严会让正常号码无法登录。 */ () => {
    const wrapper = mountCodeLogin();
    const mobileRule = formSchema(wrapper)[0]?.rules;

    expect(mobileRule?.safeParse('13800000000').success).toBe(true);
    expect(mobileRule?.safeParse('1380000000').success).toBe(false);
    expect(mobileRule?.safeParse('138000000000').success).toBe(false);
    expect(mobileRule?.safeParse('').success).toBe(false);
    expect(mobileRule?.safeParse('1380000000a').success).toBe(false);
  });

  it('验证码规则只接受四位字符', /** 长度规则与输入框长度不一致会让用户填完却提交不了。 */ () => {
    const wrapper = mountCodeLogin();
    const codeRule = formSchema(wrapper)[1]?.rules;

    expect(codeRule?.safeParse('1234').success).toBe(true);
    expect(codeRule?.safeParse('123').success).toBe(false);
    expect(codeRule?.safeParse('12345').success).toBe(false);
  });

  it('验证码按钮文案按剩余时间切换', /** 文案不切换会让用户不知道验证码是否已经发出。 */ () => {
    const wrapper = mountCodeLogin();
    const createText = formSchema(wrapper)[1]?.componentProps
      ?.createText as CreateTextHandler;

    expect(createText(3)).toBe('authentication.sendText(3)');
    expect(createText(0)).toBe('译文:authentication.sendCode');
  });
});

describe('手机验证码发送', /** 发送链路决定短信额度是否被浪费以及用户能否看到发送结果。 */ () => {
  it('校验通过后按手机号与登录场景请求短信并提示成功', /** 场景号写错会让后端下发错误的短信模板。 */ async () => {
    const wrapper = mountCodeLogin();
    const handleSendCode = formSchema(wrapper)[1]?.componentProps
      ?.handleSendCode as SendCodeHandler;

    await handleSendCode();

    expect(formApiProbe.validateField).toHaveBeenCalledWith('mobile');
    expect(sendSmsCode).toHaveBeenCalledWith({
      mobile: '13800000000',
      scene: 21,
    });
    expect(spies.showSuccessMessage).toHaveBeenCalledWith('验证码发送成功');
  });

  it('发送期间保持加载态并在结束后复位', /** 未置加载态会让用户重复点击并消耗多条短信。 */ async () => {
    const wrapper = mountCodeLogin();
    const handleSendCode = formSchema(wrapper)[1]?.componentProps
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
    // 发送链路内部有多次异步校验，必须先让微任务全部落地才能观察到挂起状态。
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(loginProbe.props?.loading).toBe(true);
    expect(release).toBeTypeOf('function');

    release?.();
    await pending;

    expect(loginProbe.props?.loading).toBe(false);
  });

  it('手机号校验不通过时不请求短信', /** 未拦截非法号码会白白消耗短信额度。 */ async () => {
    formApiProbe.isFieldValid.mockResolvedValue(false);
    const wrapper = mountCodeLogin();
    const handleSendCode = formSchema(wrapper)[1]?.componentProps
      ?.handleSendCode as SendCodeHandler;

    await expect(handleSendCode()).rejects.toThrow('请输入有效的手机号码');

    expect(sendSmsCode).not.toHaveBeenCalled();
    expect(loginProbe.props?.loading).toBe(false);
  });

  it('表单尚未挂载时直接失败且不请求短信', /** 静默失败会让用户以为验证码已发出。 */ async () => {
    // 容器尚未挂载时页面拿不到表单 API，此时必须显式失败并复位加载态。
    loginProbe.formApi = undefined;
    const wrapper = mountCodeLogin();
    const handleSendCode = formSchema(wrapper)[1]?.componentProps
      ?.handleSendCode as SendCodeHandler;

    await expect(handleSendCode()).rejects.toThrow('表单未准备好');

    expect(sendSmsCode).not.toHaveBeenCalled();
    expect(loginProbe.props?.loading).toBe(false);
  });

  it('表单取值不是合法记录时拒绝发送', /** 脏取值进入短信接口会让后端收到无意义的手机号。 */ async () => {
    formApiProbe.getValues.mockResolvedValue('13800000000');
    const wrapper = mountCodeLogin();
    const handleSendCode = formSchema(wrapper)[1]?.componentProps
      ?.handleSendCode as SendCodeHandler;

    await expect(handleSendCode()).rejects.toThrow('手机号字段无效');

    expect(sendSmsCode).not.toHaveBeenCalled();
  });
});

describe('手机验证码登录提交', /** 提交链路决定认证 Store 收到什么身份载荷。 */ () => {
  it('合法取值交给认证 Store 的手机号登录口径', /** 口令口径写错会让后端把手机号登录当成口令登录拒绝。 */ async () => {
    const wrapper = mountCodeLogin();

    wrapper.findComponent({ name: 'AuthCodeLoginStub' }).vm.$emit('submit', {
      code: '1234',
      mobile: '13800000000',
    });
    await wrapper.vm.$nextTick();

    expect(spies.authLogin).toHaveBeenCalledWith('mobile', {
      code: '1234',
      mobile: '13800000000',
    });
  });

  it('字段类型不合法时记录错误且不调用登录', /** 未收窄字段会把非法载荷交给认证 Store，产生难以定位的后端错误。 */ async () => {
    const wrapper = mountCodeLogin();

    wrapper.findComponent({ name: 'AuthCodeLoginStub' }).vm.$emit('submit', {
      code: 1234,
      mobile: '13800000000',
    });
    await vi.waitFor(
      /** 等待提交链路完成并记录失败原因。 */ () => {
        expect(spies.logError).toHaveBeenCalledWith(
          'auth:code-login:submit',
          expect.any(TypeError),
        );
      },
    );

    expect(spies.authLogin).not.toHaveBeenCalled();
  });

  it('登录失败时记录错误且不上抛', /** 未捕获会让页面出现未处理拒绝并让用户看不到失败原因。 */ async () => {
    spies.authLogin.mockRejectedValue(new Error('登录接口不可用'));
    const wrapper = mountCodeLogin();

    wrapper.findComponent({ name: 'AuthCodeLoginStub' }).vm.$emit('submit', {
      code: '1234',
      mobile: '13800000000',
    });
    await vi.waitFor(
      /** 等待失败链路落地。 */ () => {
        expect(spies.logError).toHaveBeenCalledWith(
          'auth:code-login:submit',
          expect.any(Error),
        );
      },
    );
  });
});
