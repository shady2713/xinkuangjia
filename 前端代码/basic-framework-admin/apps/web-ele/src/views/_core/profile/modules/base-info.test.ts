/**
 * 个人中心基础信息表单（views/_core/profile/modules/base-info）真实行为回归。
 *
 * 表单把昵称、手机号、邮箱与性别组装成“更新个人信息”请求体：昵称必填规则丢失会让用户把
 * 昵称改空；手机号或邮箱规则写松会让脏数据落库；性别取值口径与后端不一致会让后端解析
 * 失败；保存成功未通知外层会让个人中心顶部仍显示旧昵称；失败未复位加载态会让按钮永久
 * 停在提交中；外部资料变化未回填会让用户看不到自己刚更新的资料。用例挂载真实表单模块，
 * 只替换表单渲染边界、字典来源、消息提示、日志与网络边界。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateUserProfile } from '#/api/system/user/profile';

import BaseInfo from './base-info.vue';

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
      setValues: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 日志替身。 */
const spies = vi.hoisted(
  /** 建立用例可断言的日志替身。 */ () => ({
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
  '@vben/hooks',
  /** 字典是外部数据源，用固定选项核对取值口径。 */ () => ({
    /** 返回数字口径的性别选项，与后端字典值一致。 */
    getDictOptions: () => [
      { label: '男', value: 1 },
      { label: '女', value: 2 },
    ],
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

vi.mock(
  '#/api/system/user/profile',
  /** 资料接口是外部边界，由用例决定成功或失败。 */ () => ({
    updateUserProfile: vi.fn(),
  }),
);

/** 表单配置条目契约：用例只读取字段名、规则与组件属性。 */
interface SchemaItem {
  componentProps?: Record<string, unknown>;
  fieldName: string;
  rules?: unknown;
}

/**
 * 挂载基础信息表单。
 * @param props 模块属性，用于驱动外部资料回填。
 * @returns 已挂载的组件包装器。
 */
function mountBaseInfo(props: Record<string, unknown> = {}) {
  return mount(BaseInfo, { props });
}

/**
 * 取出模块声明的表单字段定义。
 * @returns 表单字段数组。
 * @throws Error 模块未声明表单配置时抛出，避免用例静默地什么都不验证。
 */
function schema() {
  const list = formProbe.options?.schema;
  if (!Array.isArray(list)) {
    throw new TypeError('基础信息表单未声明配置');
  }
  return list as SchemaItem[];
}

/**
 * 取出模块声明的提交处理器。
 * @returns 表单提交处理器。
 * @throws Error 模块未声明提交处理器时抛出，避免用例静默地什么都不验证。
 */
function submitHandler() {
  const handler = formProbe.options?.handleSubmit;
  if (typeof handler !== 'function') {
    throw new TypeError('基础信息表单未声明提交处理器');
  }
  return handler as SubmitHandler;
}

beforeEach(
  /** 清空替身调用并登记默认的成功返回，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    formProbe.api.setValues.mockResolvedValue(undefined);
    vi.mocked(updateUserProfile).mockResolvedValue(true as never);
  },
);

describe('基础信息表单装配', /** 字段与按钮配置决定用户能改哪些资料以及如何提交。 */ () => {
  it('声明昵称、手机、邮箱与性别四个字段', /** 字段缺失会让用户无法修改对应资料。 */ () => {
    const wrapper = mountBaseInfo();

    expect(
      schema().map(/** 提取字段名用于断言。 */ (item) => item.fieldName),
    ).toEqual(['nickname', 'mobile', 'email', 'sex']);
    expect(formProbe.options).toMatchObject({
      resetButtonOptions: { show: false },
      submitButtonOptions: { content: '更新信息' },
    });
    expect(wrapper.find('.form-stub').exists()).toBe(true);
  });

  it('性别选项按数字口径来自字典', /** 取值口径与后端不一致会让性别字段解析失败。 */ () => {
    mountBaseInfo();

    const sex = schema().find(
      /** 定位性别字段。 */ (item) => item.fieldName === 'sex',
    );

    expect(sex?.componentProps?.options).toEqual([
      { label: '男', value: 1 },
      { label: '女', value: 2 },
    ]);
  });

  it('手机号与邮箱允许留空但拒绝脏数据', /** 规则写松会让脏数据落库，可选规则写严会让用户无法留空。 */ () => {
    mountBaseInfo();

    const mobile = schema().find(
      /** 定位手机号字段。 */ (item) => item.fieldName === 'mobile',
    )?.rules as SchemaLike;
    const email = schema().find(
      /** 定位邮箱字段。 */ (item) => item.fieldName === 'email',
    )?.rules as SchemaLike;

    expect(mobile.safeParse(undefined).success).toBe(true);
    expect(mobile.safeParse('').success).toBe(true);
    expect(mobile.safeParse('13800000000').success).toBe(true);
    expect(mobile.safeParse('1380000000').success).toBe(false);
    expect(email.safeParse(undefined).success).toBe(true);
    expect(email.safeParse('tester@example.test').success).toBe(true);
    expect(email.safeParse('不是邮箱').success).toBe(false);
  });

  it('性别规则只接受数字', /** 字符串口径会被后端按数字字段拒绝。 */ () => {
    mountBaseInfo();

    const sex = schema().find(
      /** 定位性别字段。 */ (item) => item.fieldName === 'sex',
    )?.rules as SchemaLike;

    expect(sex.safeParse(1).success).toBe(true);
    expect(sex.safeParse('1').success).toBe(false);
  });
});

describe('基础信息外部资料回填', /** 回填决定用户能否在表单里看到自己当前的资料。 */ () => {
  it('资料就绪时把资料写入表单', /** 未回填会让用户面对一张空表单，容易误清已有资料。 */ () => {
    const profile = { nickname: '测试员', sex: 1 };

    mountBaseInfo({ profile });

    expect(formProbe.api.setValues).toHaveBeenCalledWith(profile);
  });

  it('资料未就绪时保持表单原值', /** 首次渲染用 undefined 覆盖会把已填内容清空。 */ () => {
    mountBaseInfo();

    expect(formProbe.api.setValues).not.toHaveBeenCalled();
  });

  it('资料更新后重新回填', /** 未重新回填会让用户保存成功后仍看到旧资料。 */ async () => {
    const wrapper = mountBaseInfo();

    await wrapper.setProps({ profile: { nickname: '改名后' } as never });

    expect(formProbe.api.setValues).toHaveBeenCalledWith({
      nickname: '改名后',
    });
  });
});

describe('基础信息提交', /** 提交链路决定资料是否落库以及用户能否知道保存结果。 */ () => {
  it('提交成功后通知外层并提示成功', /** 未通知外层会让个人中心顶部仍显示旧昵称。 */ async () => {
    const wrapper = mountBaseInfo();
    const values = { mobile: '13800000000', nickname: '新昵称', sex: 1 };
    const { ElMessage } = await import('element-plus');

    await submitHandler()(values);

    expect(updateUserProfile).toHaveBeenCalledWith(values);
    expect(wrapper.emitted('success')).toHaveLength(1);
    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      'ui.actionMessage.operationSuccess',
    );
  });

  it('提交期间置加载态并在结束后复位', /** 未复位会让按钮永久停在提交中，用户无法重试。 */ async () => {
    const { ElMessage } = await import('element-plus');

    await submitHandler()({ nickname: '新昵称' });

    expect(formProbe.api.setLoading.mock.calls).toEqual([[true], [false]]);
    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledTimes(1);
  });

  it('提交失败时记录错误且不通知外层', /** 未捕获会让页面出现未处理拒绝，误报成功会让用户以为已保存。 */ async () => {
    vi.mocked(updateUserProfile).mockRejectedValue(new Error('资料接口不可用'));
    const wrapper = mountBaseInfo();
    const { ElMessage } = await import('element-plus');

    await submitHandler()({ nickname: '新昵称' });

    expect(spies.logError).toHaveBeenCalledWith(
      'profile:base-info:submit',
      expect.any(Error),
    );
    expect(wrapper.emitted('success')).toBeUndefined();
    expect(vi.mocked(ElMessage.success)).not.toHaveBeenCalled();
    expect(formProbe.api.setLoading.mock.calls).toEqual([[true], [false]]);
  });
});
