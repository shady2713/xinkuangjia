/**
 * FormApi 的单元测试：用最小 vee-validate 替身覆盖挂载、读写、提交与 schema 更新。
 * 这里只验证实例自身的行为，真实组件挂载与提交链路由 use-form.test.ts 覆盖。
 */
import type {
  InvalidSubmissionContext,
  InvalidSubmissionHandler,
  SubmissionContext,
  SubmissionHandler,
} from 'vee-validate';

import type { FormActions, FormValues } from '../src/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormApi } from '../src/form-api';

/**
 * 校验通过分支的回调：入参依次是校验后的表单值与 vee-validate 的提交上下文。
 * 返回值类型由工厂声明，替身必须原样透传，提交结果才不会退化成 unknown。
 */
type SubmitSuccess<TReturn = unknown> = SubmissionHandler<
  FormValues,
  FormValues,
  TReturn
>;

/** 校验失败分支的回调：入参是本次提交的校验错误上下文。 */
type SubmitInvalid = InvalidSubmissionHandler<FormValues, FormValues>;

/**
 * 提交函数：工厂必须被调用才开始一次真实校验，调用它才产出提交结果。
 * 校验不通过时兑现 undefined，这正是实例区分合法提交与非法提交的依据。
 */
type SubmitHandler<TReturn = unknown> = (
  e?: Event,
) => Promise<TReturn | undefined>;

/** 本组替身实现的工厂形态：只负责在提交函数里选择成功或失败分支。 */
type SubmitFactory = <TReturn = unknown>(
  onSuccess: SubmitSuccess<TReturn>,
  onInvalid?: SubmitInvalid,
) => SubmitHandler<TReturn>;

/** 工厂调用记录：每调用一次工厂替身触发一次，用于断言提交链路确实走到了工厂。 */
type FactoryCallRecorder = () => void;

/** 替身固定交给成功分支的表单值：等价于一次全部规则通过的校验结果。 */
const VALIDATED_VALUES = { name: 'test' };

/**
 * 成功分支的提交上下文替身。
 * 真实上下文由 vee-validate 在提交过程中构造，被测的 `submitForm` 成功分支只读
 * 第一个入参、从不读上下文；这里只补齐类型要求的写值成员，不伪造任何校验状态。
 */
const SUBMIT_CONTEXT: SubmissionContext<FormValues> = {
  controlledValues: {},
  resetField: vi.fn(),
  resetForm: vi.fn(),
  setErrors: vi.fn(),
  setFieldError: vi.fn(),
  setFieldTouched: vi.fn(),
  setFieldValue: vi.fn(),
  setTouched: vi.fn(),
  setValues: vi.fn(),
};

/**
 * 失败分支的提交上下文替身：带上真实存在的错误项，
 * 使断言覆盖“错误已产生但业务回调仍不执行”这一条缺陷回归。
 */
const INVALID_CONTEXT: InvalidSubmissionContext<FormValues, FormValues> = {
  errors: { name: 'name is required' },
  results: {},
  values: { name: '' },
};

/**
 * 构造一个只暴露被测方法的表单上下文替身。
 * 单元测试只驱动被断言的少数成员，其余 vee-validate 表面 API 在此保持未实现；
 * 这样既不编造无用实现，也不用 `any` 绕过类型检查。
 * @param members 本个用例需要用到的表单上下文成员。
 * @returns 可直接交给 `FormApi.mount` 的替身。
 */
function stubFormActions(members: Partial<FormActions>): FormActions {
  return members as FormActions;
}

/**
 * 模拟 vee-validate 校验通过的 handleSubmit 工厂。
 * 工厂只把固定值交给成功分支，用于验证实例在通过时是否调用业务提交回调。
 * @param onSuccess 实例在校验通过时传入的回调。
 * @returns 可调用的提交函数。
 */
function passingHandleSubmit<TReturn = unknown>(
  onSuccess: SubmitSuccess<TReturn>,
): SubmitHandler<TReturn> {
  return /** 以固定值触发成功分支，等价于一次全部规则通过的提交。 */ async () =>
    onSuccess(VALIDATED_VALUES, SUBMIT_CONTEXT);
}

/**
 * 模拟 vee-validate 校验失败的 handleSubmit 工厂。
 * 工厂只触发失败分支、成功分支刻意不调用，用于验证非法值不会进入业务。
 * @param _onSuccess 成功分支回调，此工厂刻意不调用它。
 * @param onInvalid 实例在校验失败时传入的回调。
 * @returns 可调用的提交函数。
 */
function failingHandleSubmit<TReturn = unknown>(
  _onSuccess: SubmitSuccess<TReturn>,
  onInvalid?: SubmitInvalid,
): SubmitHandler<TReturn> {
  return /** 触发失败分支并交回 undefined，与真实校验失败的结果一致。 */ async () => {
    onInvalid?.(INVALID_CONTEXT);
    return undefined;
  };
}

/**
 * 把工厂替身补成 vee-validate 的 `handleSubmit` 成员形状。
 * vee-validate 的成员除工厂外还带一个同形的 `withControlled`；并且工厂本身是泛型签名，
 * 提交函数的返回类型由调用点的业务返回类型决定，所以替身必须保持同样的泛型形态，
 * 不能先降级成固定返回类型再断言回去。
 * @param impl 真正执行成功或失败分支的工厂替身。
 * @param onFactoryCall 工厂每次被调用时触发的记录回调。
 * @returns 可直接挂载的 `handleSubmit` 成员。
 */
function stubHandleSubmit(
  impl: SubmitFactory,
  onFactoryCall: FactoryCallRecorder,
): FormActions['handleSubmit'] {
  /** 记录一次工厂调用后，把分支选择原样委托给被测替身。 */
  function stubbedFactory<TReturn = unknown>(
    onSuccess: SubmitSuccess<TReturn>,
    onInvalid?: SubmitInvalid,
  ): SubmitHandler<TReturn> {
    onFactoryCall();
    return impl(onSuccess, onInvalid);
  }

  return Object.assign(stubbedFactory, { withControlled: stubbedFactory });
}

describe('formApi', /** 实例挂载、读写、提交与重置的基础行为。 */ () => {
  let formApi: FormApi;

  beforeEach(
    /** 每个用例前重建实例，避免状态在用例之间串味。 */
    () => {
      formApi = new FormApi();
    },
  );

  it('should initialize with default state', /** 新建实例必须带齐默认状态，调用方未声明的属性回落到默认值。 */ () => {
    expect(formApi.state).toEqual(
      expect.objectContaining({
        actionWrapperClass: '',
        collapsed: false,
        collapsedRows: 1,
        commonConfig: {},
        handleReset: undefined,
        handleSubmit: undefined,
        layout: 'horizontal',
        resetButtonOptions: {},
        schema: [],
        showCollapseButton: false,
        showDefaultActions: true,
        submitButtonOptions: {},
        wrapperClass: 'grid-cols-1',
      }),
    );
    expect(formApi.isMounted).toBe(false);
  });

  it('should mount form actions', /** 挂载后实例标记为已挂载，并持有传入的表单上下文。 */ async () => {
    const formActions = stubFormActions({
      resetForm: vi.fn(),
      setFieldValue: vi.fn(),
      setValues: vi.fn(),
      submitForm: vi.fn(),
      validate: vi.fn(),
      values: { name: 'test' },
    });

    await formApi.mount(formActions);
    expect(formApi.isMounted).toBe(true);
    expect(formApi.form).toEqual(formActions);
  });

  it('should get values from form', /** 读取表单值时返回上下文中的当前值，而不是默认值。 */ async () => {
    const formActions = stubFormActions({
      values: { name: 'test' },
    });

    await formApi.mount(formActions);
    const values = await formApi.getValues();
    expect(values).toEqual({ name: 'test' });
  });

  it('should set field value', /** 写入单个字段时按原样透传给表单上下文，不额外触发校验。 */ async () => {
    const setFieldValueMock = vi.fn();
    const formActions = stubFormActions({
      setFieldValue: setFieldValueMock,
      values: { name: 'test' },
    });

    await formApi.mount(formActions);
    await formApi.setFieldValue('name', 'new value');
    expect(setFieldValueMock).toHaveBeenCalledWith(
      'name',
      'new value',
      undefined,
    );
  });

  it('should reset form', /** 重置委托给表单上下文，实例自身不缓存字段值。 */ async () => {
    const resetFormMock = vi.fn();
    const formActions = stubFormActions({
      resetForm: resetFormMock,
      values: { name: 'test' },
    });

    await formApi.mount(formActions);
    await formApi.resetForm();
    expect(resetFormMock).toHaveBeenCalled();
  });

  it('should call handleSubmit on submit', /** 校验通过时，实例必须把工厂的成功分支结果交给业务提交回调。 */ async () => {
    const handleSubmitMock = vi.fn();
    // vee-validate 的 handleSubmit 是工厂：只有校验通过才执行成功分支回调。
    const factoryCallRecorder = vi.fn();
    const formActions = stubFormActions({
      handleSubmit: stubHandleSubmit(passingHandleSubmit, factoryCallRecorder),
      values: { name: 'test' },
    });

    formApi.setState({ handleSubmit: handleSubmitMock });
    await formApi.mount(formActions);

    const result = await formApi.submitForm();
    expect(factoryCallRecorder).toHaveBeenCalled();
    expect(handleSubmitMock).toHaveBeenCalledWith(VALIDATED_VALUES);
    expect(result).toEqual(VALIDATED_VALUES);
  });

  it('should not call the business handler when the form is invalid', /** 缺陷回归：校验不通过时业务提交回调绝不能被调用，提交结果为 undefined。 */ async () => {
    const handleSubmitMock = vi.fn();
    // 校验不通过时 vee-validate 只触发失败分支，绝不执行成功分支回调。
    const factoryCallRecorder = vi.fn();
    const formActions = stubFormActions({
      handleSubmit: stubHandleSubmit(failingHandleSubmit, factoryCallRecorder),
      values: { name: '' },
    });

    formApi.setState({ handleSubmit: handleSubmitMock });
    await formApi.mount(formActions);

    const result = await formApi.submitForm();
    expect(factoryCallRecorder).toHaveBeenCalled();
    expect(handleSubmitMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('should unmount form and reset state', /** 卸载后实例立即标记为未挂载，随后的读取请求随之失败。 */ () => {
    formApi.unmount();
    expect(formApi.isMounted).toBe(false);
  });

  it('should validate form', /** 校验委托给表单上下文，并把结果原样交回调用方。 */ async () => {
    const validateMock = vi.fn().mockResolvedValue(true);
    const formActions = stubFormActions({
      validate: validateMock,
    });

    await formApi.mount(formActions);
    const isValid = await formApi.validate();
    expect(validateMock).toHaveBeenCalled();
    expect(isValid).toBe(true);
  });
});

describe('updateSchema', /** 按字段名合并更新既有 schema，不新增字段。 */ () => {
  let instance: FormApi;

  beforeEach(
    /** 为 schema 用例准备两项固定的初始定义。 */
    () => {
      instance = new FormApi();
      instance.state = {
        schema: [
          { component: 'text', fieldName: 'name' },
          { component: 'number', fieldName: 'age', label: 'Age' },
        ],
      };
    },
  );

  it('should update the schema correctly when fieldName matches', /** 字段名匹配时合并到既有表单项，且不打乱原有顺序。 */ () => {
    const newSchema = [
      { component: 'text', fieldName: 'name' },
      { component: 'number', fieldName: 'age', label: 'Age' },
    ];

    instance.updateSchema(newSchema);

    expect(instance.state?.schema?.[0]?.component).toBe('text');
    expect(instance.state?.schema?.[1]?.label).toBe('Age');
  });

  it('should log an error if fieldName is missing in some items', /** 更新项缺少字段名时整体放弃，并打印可定位的错误信息。 */ () => {
    const newSchema: Record<string, unknown>[] = [
      { component: 'textarea', fieldName: 'name' },
      { component: 'number' },
    ];

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(
      /** 屏蔽错误输出，保持用例输出可读。 */
      () => {},
    );

    instance.updateSchema(newSchema);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'All items in the schema array must have a valid `fieldName` property to be updated',
    );
  });

  it('should not update schema if fieldName does not match', /** 字段名不匹配时不做任何修改，避免误改其他字段。 */ () => {
    const newSchema = [{ component: 'textarea', fieldName: 'unknown' }];

    instance.updateSchema(newSchema);

    expect(instance.state?.schema?.[0]?.component).toBe('text');
    expect(instance.state?.schema?.[1]?.component).toBe('number');
  });

  it('should not update schema if updatedMap is empty', /** 更新项全部缺少字段名时同样整体放弃。 */ () => {
    const newSchema: Record<string, unknown>[] = [{ component: 'textarea' }];

    instance.updateSchema(newSchema);

    expect(instance.state?.schema?.[0]?.component).toBe('text');
    expect(instance.state?.schema?.[1]?.component).toBe('number');
  });

  it('should deep merge a partial update without writing null fields', /** 局部更新只覆盖提及的键，其余键保留，且结果不含 null 字段。 */ () => {
    instance.state = {
      schema: [
        {
          component: 'Input',
          componentProps: { class: 'w-full', placeholder: '旧' },
          fieldName: 'name',
        },
      ],
    };

    instance.updateSchema([
      { componentProps: { placeholder: '新' }, fieldName: 'name' },
    ]);

    const merged = instance.state?.schema?.[0];
    // 深合并：未提及的 class 保留。
    expect(merged?.componentProps).toMatchObject({
      class: 'w-full',
      placeholder: '新',
    });
    // 合法的表单项不允许出现 null 字段。
    for (const value of Object.values(merged ?? {})) {
      expect(value).not.toBe(null);
    }
  });

  it('should replace array component props instead of merging them by element', /** 选项数组必须整体替换，否则会残留已删除的选项。 */ () => {
    instance.state = {
      schema: [
        {
          component: 'Select',
          componentProps: { options: [{ label: 'A', value: 'a' }] },
          fieldName: 'kind',
        },
      ],
    };

    instance.updateSchema([
      {
        componentProps: { options: [{ label: 'B', value: 'b' }] },
        fieldName: 'kind',
      },
    ]);

    expect(
      (instance.state?.schema?.[0]?.componentProps as { options: unknown[] })
        .options,
    ).toEqual([{ label: 'B', value: 'b' }]);
  });

  it('should clear field values and component refs when a schema item is removed', /** 删除表单项必须同时清掉字段值与组件引用，卸载后引用映射也要清空。 */ async () => {
    const setFieldValue = vi.fn();
    const componentRefMap = new Map<string, unknown>([
      ['nickname', { id: 'input' }],
    ]);

    await instance.mount(
      stubFormActions({ resetForm: vi.fn(), setFieldValue, values: {} }),
      componentRefMap,
    );
    expect(instance.getFieldComponentRef('nickname')).toEqual({ id: 'input' });

    // 通过 setState 变更 schema，才能触发“已删除字段”的清理逻辑。
    instance.setState({
      schema: [{ component: 'Input', fieldName: 'nickname' }],
    });
    instance.setState({ schema: [] });
    expect(setFieldValue).toHaveBeenCalledWith('nickname', undefined);

    instance.unmount();
    // 卸载后组件引用映射必须清空，避免把已销毁组件的引用带到下一次挂载。
    expect(instance.getFieldComponentRef('nickname')).toBeUndefined();
  });
});
