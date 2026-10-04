/**
 * FormApi 组合提交、字段定位与值转换的补充回归。
 *
 * 本文件补齐 form-api 中未被既有用例覆盖的行为：聚焦字段定位写错会让弹窗把焦点还给错误字段；
 * 组合提交未整体成功会让部分表单的数据被提交；字段定位未按 DOM 名称回退会让校验失败时页面
 * 不滚动；写入值未过滤未声明字段会把脏键写进表单；时间区间未展开或数组字段未按分隔符转换
 * 会让后端收到控件原始形态；禁用与加载状态未写进公共配置会让表单在弹窗之外无法控制。
 *
 * 用例真实构造 FormApi 实例并挂载最小表单上下文替身，组合提交、值过滤与区间展开保持真实实现。
 */
import type { Ref } from 'vue';

import type { FormActions, FormValues } from '../src/types';

import { ref } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormApi } from '../src/form-api';

/** 组合视图契约：只读取挂载标记与状态读取方法。 */
interface MergedView {
  /**
   * 读取组合视图底层实例的状态。
   * @returns 表单状态对象。
   */
  getState(): unknown;
  /** 组合视图是否处于已挂载状态。 */
  isMounted: boolean;
}

/** 单字段校验结果视图：只读取是否通过与错误表。 */
interface FieldValidateResult {
  /** 字段级错误表，空对象表示通过。 */
  errors: Record<string, string>;
  /** 是否通过校验。 */
  valid: boolean;
}

/**
 * 构造只暴露被测成员的表单上下文替身。
 * @param members 本个用例需要用到的上下文成员。
 * @returns 可直接交给 FormApi.mount 的替身。
 */
function stubActions(members: Partial<FormActions>): FormActions {
  return members as FormActions;
}

/**
 * 构造 vee-validate 校验结果替身：字段级用例只关心是否通过与错误表，其余成员按契约补齐。
 * @param valid 是否通过校验。
 * @param errors 字段级错误表，默认空对象表示没有错误。
 * @returns 满足 FormValidationResult 契约的校验结果。
 */
function validationResult(valid: boolean, errors: Record<string, string> = {}) {
  return { errors, results: {}, source: 'fields' as const, valid };
}

/**
 * 读取已挂载表单的实例状态，避免断言读到挂载前的空状态。
 * @param api 表单实例。
 * @returns 挂载后的实例状态。
 * @throws TypeError 表单尚未挂载时抛出，让用例直接暴露装配错误。
 */
function stateOf(api: FormApi) {
  const state = api.getState();
  if (!state) {
    throw new TypeError('表单实例必须已挂载');
  }
  return state;
}

/**
 * 构造一个成员表单的读取与校验替身。
 * @param values 该校验通过后返回的表单值。
 * @returns 含 validate 与 values 的最小表单上下文。
 */
function memberActions(values: FormValues) {
  return stubActions({
    /** 声明该成员校验通过。 */
    validate: async () => validationResult(true),
    values,
  });
}

/** 提交成功分支签名：校验通过时接收表单值与 vee-validate 上下文。 */
type SubmitSuccessCallback = (validated: FormValues, context: never) => unknown;

/**
 * 构造最小提交工厂替身：校验通过时把固定值交给成功分支。
 * @param values 校验通过后交给业务成功分支的表单值。
 * @returns vee-validate handleSubmit 成员形状的替身。
 */
function stubSubmit(values: FormValues) {
  /**
   * 工厂形态的提交入口：调用返回的提交函数才会触发成功分支。
   * @param onSuccess 校验通过时的成功分支回调。
   * @returns 可调用的提交函数。
   */
  function factory(onSuccess: SubmitSuccessCallback) {
    return /** 以固定值触发成功分支。 */ async () =>
      onSuccess(values, {} as never);
  }
  return Object.assign(factory, { withControlled: factory }) as never;
}

/**
 * 挂载一个 FormApi 实例。
 * @param members 表单上下文成员。
 * @param componentRefMap 字段名到组件实例的映射。
 * @returns 已挂载的实例。
 */
async function mountApi(
  members: Partial<FormActions>,
  componentRefMap?: Map<string, unknown>,
) {
  const api = new FormApi();
  await api.mount(stubActions(members), componentRefMap);
  return api;
}

/**
 * 把元素挂到文档上并夺取焦点。
 * @param name 元素名称，用于按 name 属性定位。
 * @returns 已获得焦点的输入元素。
 */
function focusedInput(name: string) {
  const input = document.createElement('input');
  input.setAttribute('name', name);
  document.body.append(input);
  input.focus();
  return input;
}

/**
 * 取出实例状态里的公共配置。
 * @param api 表单实例。
 * @returns 公共配置记录。
 */
function commonConfigOf(api: FormApi) {
  return stateOf(api).commonConfig as Record<string, unknown>;
}

beforeEach(
  /** 每个用例前清空文档，避免上一例挂载的元素影响焦点与定位断言。 */ () => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  },
);

describe('聚焦字段定位', /** 定位结果决定弹窗重新打开时把焦点还给哪个字段。 */ () => {
  it('没有登记字段时返回 undefined', /** 未登记字段仍返回名称会让弹窗聚焦到不存在的控件。 */ async () => {
    const api = await mountApi({});

    expect(api.getFocusedField()).toBeUndefined();
  });

  it('组件实例本身是元素时按焦点比较', /** 未比较焦点会让弹窗无法还原用户上次编辑的位置。 */ async () => {
    const input = focusedInput('username');
    const api = await mountApi({}, new Map([['username', input]]));

    expect(api.getFocusedField()).toBe('username');
  });

  it('焦点落在元素内部子节点时同样命中', /** 只比较元素本身会让输入框内部焦点被漏判。 */ async () => {
    const input = focusedInput('username');
    const api = await mountApi({}, new Map([['username', input]]));

    expect(input.contains(document.activeElement)).toBe(true);
    expect(api.getFocusedField()).toBe('username');
  });

  it('焦点落在容器元素内部子节点时命中容器字段', /** 只比较元素本身会让包裹输入的容器字段定位不到。 */ async () => {
    const container = document.createElement('div');
    const input = document.createElement('input');
    container.append(input);
    document.body.append(container);
    input.focus();
    const api = await mountApi({}, new Map([['deptId', container]]));

    expect(container === document.activeElement).toBe(false);
    expect(api.getFocusedField()).toBe('deptId');
  });

  it('组件实例通过 $el 暴露元素时回退比较', /** 不回退到 $el 会让包装组件的字段永远定位不到。 */ async () => {
    const input = focusedInput('nickname');
    const api = await mountApi({}, new Map([['nickname', { $el: input }]]));

    expect(api.getFocusedField()).toBe('nickname');
  });

  it('组件引用包在 ref 中时先解包', /** 未解包会让响应式引用被当成普通对象跳过。 */ async () => {
    const input = focusedInput('mobile');
    const api = await mountApi({}, new Map([['mobile', ref(input)]]));

    expect(api.getFocusedField()).toBe('mobile');
  });

  it('引用没有对应元素时跳过该字段', /** 未跳过会让未渲染字段中断整轮定位。 */ async () => {
    const input = focusedInput('mobile');
    const api = await mountApi(
      {},
      new Map<string, unknown>([
        ['empty', { name: 'DUMMY-未渲染' }],
        ['mobile', input],
      ]),
    );

    expect(api.getFocusedField()).toBe('mobile');
  });
});

describe('字段校验状态读取', /** 读取结果决定页面能否按字段展示校验态。 */ () => {
  it('把字段名透传给表单上下文', /** 未透传会让所有字段共用同一个校验结果。 */ async () => {
    const isFieldValid = vi.fn(/** 声明该字段通过校验。 */ () => true);
    const api = await mountApi({ isFieldValid });

    await expect(api.isFieldValid('username')).resolves.toBe(true);
    expect(isFieldValid).toHaveBeenCalledWith('username');
  });
});

describe('组合表单提交', /** 组合提交决定多个表单能否一起校验并合并取值。 */ () => {
  it('全部成员有效时按登记顺序合并字段', /** 未合并会让业务拿不到完整数据，顺序写错会让同名字段取错来源。 */ async () => {
    const first = await mountApi({
      /** 声明第一个成员通过。 */
      validate: async () => validationResult(true),
      values: { a: 1, same: 'first' },
    });
    const second = await mountApi({
      /** 声明第二个成员通过。 */
      validate: async () => validationResult(true),
      values: { b: 2, same: 'second' },
    });

    const merged = first.merge(second as never);

    await expect(merged.submitAllForm()).resolves.toEqual({
      a: 1,
      b: 2,
      same: 'second',
    });
  });

  it('不合并时按登记顺序返回各成员值', /** 未按顺序返回会让调用方无法对应表单与数据。 */ async () => {
    const first = await mountApi(memberActions({ a: 1 }));
    const second = await mountApi(memberActions({ b: 2 }));

    const merged = first.merge(second as never);

    await expect(merged.submitAllForm(false)).resolves.toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  it('任一成员校验失败时整体返回 undefined', /** 部分成功会让未通过校验的数据被提交。 */ async () => {
    const first = await mountApi(memberActions({ a: 1 }));
    const second = await mountApi({
      /** 声明第二个成员校验失败。 */
      validate: async () => validationResult(false),
      values: { b: 2 },
    });

    const merged = first.merge(second as never);

    await expect(merged.submitAllForm()).resolves.toBeUndefined();
  });

  it('可以继续把第三个表单加入组合', /** 未支持链式登记会让三表单场景无法合并。 */ async () => {
    const first = await mountApi(memberActions({ a: 1 }));
    const second = await mountApi(memberActions({ b: 2 }));
    const third = await mountApi(memberActions({ c: 3 }));

    const merged = first.merge(second as never).merge(third as never);

    await expect(merged.submitAllForm()).resolves.toEqual({
      a: 1,
      b: 2,
      c: 3,
    });
  });

  it('未组合时提交自身', /** 未把自身登记为成员会让单表单提交拿不到值。 */ async () => {
    const api = await mountApi(memberActions({ a: 1 }));

    await expect(api.submitAllForm()).resolves.toEqual({ a: 1 });
  });

  it('组合视图把其余成员转发给真实实例', /** 转发缺失会让组合视图失去实例原有的读写能力。 */ async () => {
    const first = await mountApi(memberActions({ a: 1 }));
    const second = await mountApi(memberActions({ b: 2 }));

    const merged = first.merge(second as never) as unknown as MergedView;

    expect(merged.isMounted).toBe(true);
    expect(merged.getState()).toBeDefined();
  });
});

describe('最近一次提交值与统一提交入口', /** 提交快照与统一入口决定业务在 await 之后读到的数据。 */ () => {
  it('尚未提交时返回空值视图', /** 返回 undefined 会让业务在提交前读取快照时抛错。 */ async () => {
    const api = await mountApi({});

    expect(api.getLatestSubmissionValues()).toEqual({});
  });

  it('提交后返回最近一次提交捕获的值', /** 未记录快照会让业务在 await 之后读到用户的新输入。 */ async () => {
    const api = await mountApi(memberActions({ a: 1 }));

    api.setLatestSubmissionValues({ a: 1 } as never);

    expect(api.getLatestSubmissionValues()).toEqual({ a: 1 });
  });

  it('统一提交入口与提交表单走同一条链路', /** 入口分叉会让校验结果与提交结果脱节。 */ async () => {
    const api = await mountApi({
      handleSubmit: stubSubmit({ a: 1 }),
      values: { a: 1 } as never,
    });
    const submitForm = vi.spyOn(api, 'submitForm');

    await expect(api.validateAndSubmitForm()).resolves.toEqual({ a: 1 });
    expect(submitForm).toHaveBeenCalledTimes(1);
  });

  it('单表单不合并时返回成员值数组', /** 未覆盖数组分支会让调用方拿不到逐表单结果。 */ async () => {
    const api = await mountApi(memberActions({ a: 1 }));

    await expect(api.submitAllForm(false)).resolves.toEqual([{ a: 1 }]);
  });

  it('未挂载时等待挂载并在超时后判定挂载失效', /** 未判定失效会让调用方拿到空上下文或永久等待。 */ async () => {
    const api = new FormApi();

    const pending = api.getValues();
    api.stateHandler.setConditionTrue();

    await expect(pending).rejects.toThrow('表单挂载已失效');
  });
});

describe('按字段移除表单项', /** 移除结果决定联动隐藏的字段是否还参与提交。 */ () => {
  it('只移除命中字段并保留其余顺序', /** 多删或漏删会让表单出现多余字段或丢失字段。 */ async () => {
    const api = await mountApi({});
    api.setState({
      schema: [
        { fieldName: 'a' },
        { fieldName: 'b' },
        { fieldName: 'c' },
      ] as never,
    });

    await api.removeSchemaByFields(['b', 'DUMMY-不存在']);

    expect(
      (stateOf(api).schema ?? []).map(
        /** 取出剩余字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(['a', 'c']);
  });
});

describe('清空校验错误', /** 清空结果决定 schema 更新后是否还残留旧错误。 */ () => {
  it('逐个字段把错误置空', /** 未清空会让用户在已修复的字段上继续看到旧错误。 */ async () => {
    const setFieldError = vi.fn();
    const api = await mountApi({
      errors: ref({ mobile: 'DUMMY-错误', username: 'DUMMY-错误' }) as Ref<
        Record<string, string>
      > as never,
      setFieldError,
    });

    await api.resetValidate();

    expect(setFieldError).toHaveBeenCalledTimes(2);
    expect(setFieldError).toHaveBeenCalledWith('username', undefined);
    expect(setFieldError).toHaveBeenCalledWith('mobile', undefined);
  });

  it('没有错误时不写入任何字段', /** 无错误仍写入会触发多余的校验状态更新。 */ async () => {
    const setFieldError = vi.fn();
    const api = await mountApi({
      errors: ref({}) as never,
      setFieldError,
    });

    await api.resetValidate();

    expect(setFieldError).not.toHaveBeenCalled();
  });
});

describe('滚动到第一个错误字段', /** 滚动定位决定校验失败时用户能否看到出错位置。 */ () => {
  it('按错误对象的首个字段名滚动', /** 取错字段名会让页面滚动到无关位置。 */ async () => {
    const input = document.createElement('input');
    input.setAttribute('name', 'username');
    document.body.append(input);
    const scrollIntoView = vi.fn();
    input.scrollIntoView = scrollIntoView;
    const api = await mountApi({});

    api.scrollToFirstError({ username: 'DUMMY-错误' });

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });

  it('错误字段名以字符串给出时直接定位', /** 未支持字符串入参会让调用方必须自行包一层对象。 */ async () => {
    const input = document.createElement('input');
    input.setAttribute('name', 'mobile');
    document.body.append(input);
    const scrollIntoView = vi.fn();
    input.scrollIntoView = scrollIntoView;
    const api = await mountApi({});

    api.scrollToFirstError('mobile');

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('没有错误字段时不滚动', /** 空字段名仍滚动会让页面无故跳动。 */ async () => {
    const input = document.createElement('input');
    input.setAttribute('name', 'username');
    document.body.append(input);
    const scrollIntoView = vi.fn();
    input.scrollIntoView = scrollIntoView;
    const api = await mountApi({});

    api.scrollToFirstError({});

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('页面找不到同名元素时回退到组件引用元素', /** 未回退会让包装组件的字段校验失败时不滚动。 */ async () => {
    const input = document.createElement('input');
    const scrollIntoView = vi.fn();
    input.scrollIntoView = scrollIntoView;
    const api = await mountApi({}, new Map([['nickname', { $el: input }]]));

    api.scrollToFirstError('nickname');

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('既无同名元素也无可用引用时安全返回', /** 抛错会让一次校验失败演变成页面崩溃。 */ async () => {
    const api = await mountApi({}, new Map([['nickname', { name: 'DUMMY' }]]));

    expect(
      /** 无可用元素时应安全返回而不是抛错。 */ () =>
        api.scrollToFirstError('nickname'),
    ).not.toThrow();
  });
});

describe('禁用与加载状态', /** 状态写入决定弹窗之外的表单能否被调用方控制。 */ () => {
  it('禁用状态写进公共配置且不影响其它配置', /** 覆盖整份公共配置会让已有的布局或标签宽度丢失。 */ async () => {
    const api = await mountApi({});
    api.setState({ commonConfig: { labelWidth: 120 } as never });

    api.setDisabled(true);

    expect(commonConfigOf(api)).toEqual({ disabled: true, labelWidth: 120 });
  });

  it('加载状态写进提交按钮配置且不影响其它配置', /** 覆盖整份按钮配置会让按钮文案与样式丢失。 */ async () => {
    const api = await mountApi({});
    api.setState({ submitButtonOptions: { text: 'DUMMY-提交' } as never });

    api.setLoading(true);

    expect(stateOf(api).submitButtonOptions).toEqual({
      loading: true,
      text: 'DUMMY-提交',
    });
  });
});

describe('写入表单值', /** 写入决定动态值能否按 schema 边界落进表单。 */ () => {
  it('关闭过滤时按原样写入', /** 过滤未关闭会让调用方无法写入 schema 之外的联动字段。 */ async () => {
    const setValues = vi.fn();
    const api = await mountApi({ setValues, values: { a: 1 } as never });

    await api.setValues({ a: 2, extra: 3 } as never, false, true);

    expect(setValues).toHaveBeenCalledWith({ a: 2, extra: 3 }, true);
  });

  it('默认过滤掉未声明的字段', /** 未过滤会把脏键写进表单并随后提交给后端。 */ async () => {
    const setValues = vi.fn();
    const api = await mountApi({
      setValues,
      values: { a: 1, nested: { x: 1 } } as never,
    });

    await api.setValues({ a: 2, extra: 3 } as never);

    expect(setValues).toHaveBeenCalledWith({ a: 2, nested: { x: 1 } }, false);
  });

  it('嵌套对象按已知键递归合并', /** 整体替换会让未提交的嵌套字段丢失。 */ async () => {
    const setValues = vi.fn();
    const api = await mountApi({
      setValues,
      values: { nested: { keep: 1, x: 1 } } as never,
    });

    await api.setValues({ nested: { x: 2, y: 3 } } as never);

    expect(setValues).toHaveBeenCalledWith(
      { nested: { keep: 1, x: 2 } },
      false,
    );
  });

  it('日期对象作为整体替换而不是递归合并', /** 递归合并日期对象会破坏日期控件需要的实例形状。 */ async () => {
    const setValues = vi.fn();
    const current = new Date(2024, 2, 4);
    const next = new Date(2025, 4, 6);
    const api = await mountApi({
      setValues,
      values: { startTime: current } as never,
    });

    await api.setValues({ startTime: next } as never);

    expect(setValues).toHaveBeenCalledWith({ startTime: next }, false);
  });
});

describe('单字段校验', /** 单字段校验决定失败时是否给出提示与定位。 */ () => {
  it('通过时直接返回结果且不输出错误', /** 通过仍输出错误会让控制台出现误导性日志。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 丢弃错误输出，断言通过调用记录完成。 */ () => {});
    const api = await mountApi({
      /** 声明该字段通过校验。 */
      validateField: async () =>
        ({ errors: {}, valid: true }) as FieldValidateResult as never,
    });

    await expect(api.validateField('username')).resolves.toEqual({
      errors: {},
      valid: true,
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('失败时输出错误并按开关滚动定位', /** 未输出会让排查困难，未滚动会让用户看不到出错字段。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 丢弃错误输出，断言通过调用记录完成。 */ () => {});
    const api = await mountApi({
      /** 声明该字段校验失败。 */
      validateField: async () =>
        ({ errors: { username: 'DUMMY-错误' }, valid: false }) as never,
    });
    api.setState({ scrollToFirstError: true });
    const scrollToFirstError = vi.spyOn(api, 'scrollToFirstError');

    await api.validateField('username');

    expect(consoleError).toHaveBeenCalledWith('validate error', {
      username: 'DUMMY-错误',
    });
    expect(scrollToFirstError).toHaveBeenCalledWith('username');
  });

  it('关闭滚动开关时只输出错误', /** 关闭开关仍滚动会让页面在用户阅读时跳动。 */ async () => {
    vi.spyOn(console, 'error').mockImplementation(
      /** 丢弃错误输出，断言通过调用记录完成。 */ () => {},
    );
    const api = await mountApi({
      /** 声明该字段校验失败。 */
      validateField: async () =>
        ({ errors: { username: 'DUMMY-错误' }, valid: false }) as never,
    });
    api.setState({ scrollToFirstError: false });
    const scrollToFirstError = vi.spyOn(api, 'scrollToFirstError');

    await api.validateField('username');

    expect(scrollToFirstError).not.toHaveBeenCalled();
  });
});

describe('整表校验', /** 整表校验决定失败时是否输出错误并滚动定位。 */ () => {
  it('校验失败时输出错误并滚动到第一个错误字段', /** 未输出会让排查困难，未滚动会让用户看不到出错位置。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 丢弃错误输出，断言通过调用记录完成。 */ () => {});
    const api = await mountApi({
      /** 声明整表校验失败。 */
      validate: async () =>
        ({ errors: { username: 'DUMMY-错误' }, valid: false }) as never,
    });
    api.setState({ scrollToFirstError: true });
    const scrollToFirstError = vi.spyOn(api, 'scrollToFirstError');

    await api.validate();

    expect(consoleError).toHaveBeenCalledWith('validate error', {
      username: 'DUMMY-错误',
    });
    expect(scrollToFirstError).toHaveBeenCalledWith({ username: 'DUMMY-错误' });
  });
});

describe('时间区间与数组字段转换', /** 转换决定后端收到的是控件原始形态还是业务约定形态。 */ () => {
  it('把区间字段展开为起止两个字段并删除原字段', /** 未展开会让后端收到数组，未删除会让多余字段一起提交。 */ async () => {
    const api = await mountApi({
      values: {
        range: [new Date(2024, 2, 4), new Date(2024, 2, 5)],
      } as never,
    });
    api.setState({
      fieldMappingTime: [['range', ['startTime', 'endTime'], 'YYYY-MM-DD']],
    } as never);

    await expect(api.getValues()).resolves.toEqual({
      endTime: '2024-03-05',
      startTime: '2024-03-04',
    });
  });

  it('区间值为空时清掉残留的起止字段', /** 未清理会让用户清空后旧值仍被提交。 */ async () => {
    const api = await mountApi({
      values: {
        endTime: 'DUMMY-旧值',
        range: null,
        startTime: 'DUMMY-旧值',
      } as never,
    });
    api.setState({
      fieldMappingTime: [['range', ['startTime', 'endTime']]],
    } as never);

    await expect(api.getValues()).resolves.toEqual({});
  });

  it('区间字段缺失时只删除该字段', /** 未删除会让 undefined 字段出现在提交数据里。 */ async () => {
    const api = await mountApi({ values: {} as never });
    api.setState({
      fieldMappingTime: [['range', ['startTime', 'endTime']]],
    } as never);

    await expect(api.getValues()).resolves.toEqual({});
  });

  it('区间值不是两个元素时抛出类型错误', /** 静默跳过会让用户填写的区间被悄悄丢弃。 */ async () => {
    const api = await mountApi({ values: { range: [1] } as never });
    api.setState({
      fieldMappingTime: [['range', ['startTime', 'endTime']]],
    } as never);

    await expect(api.getValues()).rejects.toThrow(
      '时间区间字段 range 必须包含两个值',
    );
  });

  it('区间端点为空时输出 undefined 而不是非法日期', /** 把空端点当日期格式化会让后端收到 Invalid Date。 */ async () => {
    const api = await mountApi({ values: { range: [null, null] } as never });
    api.setState({
      fieldMappingTime: [['range', ['startTime', 'endTime'], 'YYYY-MM-DD']],
    } as never);

    await expect(api.getValues()).resolves.toEqual({
      endTime: undefined,
      startTime: undefined,
    });
  });

  it('数组字段值为空时跳过转换', /** 未跳过会把未填写字段转换成空数组。 */ async () => {
    const api = await mountApi({ values: { tags: null } as never });
    api.setState({ arrayToStringFields: ['tags', ';'] } as never);

    await expect(api.getValues()).resolves.toEqual({ tags: null });
  });

  it('格式为 null 时原样输出区间端点', /** 强行格式化会破坏后端约定直接接收时间戳的字段。 */ async () => {
    const api = await mountApi({ values: { range: [1, 2] } as never });
    api.setState({
      fieldMappingTime: [['range', ['startTime', 'endTime'], null]],
    } as never);

    await expect(api.getValues()).resolves.toEqual({
      endTime: 2,
      startTime: 1,
    });
  });

  it('格式为函数时逐个端点调用', /** 未调用自定义格式化会让调用方无法定制输出。 */ async () => {
    const format = vi.fn(
      /**
       * 按端点键拼出可预期文本。
       * @param value 区间端点原始值。
       * @param key 端点对应的字段名。
       * @returns 拼接后的展示文本。
       */
      (value: unknown, key: string) => `${key}:${String(value)}`,
    );
    const api = await mountApi({ values: { range: [1, 2] } as never });
    api.setState({
      fieldMappingTime: [['range', ['startTime', 'endTime'], format]],
    } as never);

    await expect(api.getValues()).resolves.toEqual({
      endTime: 'endTime:2',
      startTime: 'startTime:1',
    });
  });

  it('格式为数组时分别格式化起止端点', /** 只支持单一格式会让起止时间无法使用不同粒度。 */ async () => {
    const api = await mountApi({
      values: { range: [new Date(2024, 2, 4), new Date(2024, 2, 5)] } as never,
    });
    api.setState({
      fieldMappingTime: [
        ['range', ['startTime', 'endTime'], ['YYYY-MM-DD', 'YYYY/MM/DD']],
      ],
    } as never);

    await expect(api.getValues()).resolves.toEqual({
      endTime: '2024/03/05',
      startTime: '2024-03-04',
    });
  });

  it('区间端点类型不受支持时抛出类型错误', /** 把对象当日期格式化会让后端收到 Invalid Date。 */ async () => {
    const api = await mountApi({ values: { range: [{}, {}] } as never });
    api.setState({
      fieldMappingTime: [['range', ['startTime', 'endTime']]],
    } as never);

    await expect(api.getValues()).rejects.toThrow(
      '时间区间值必须为日期、时间戳或文本',
    );
  });

  it('简单数组字段按末尾分隔符拆回数组', /** 未拆分会让后端收到分隔符拼接的字符串。 */ async () => {
    const api = await mountApi({ values: { tags: 'a;b;c' } as never });
    api.setState({ arrayToStringFields: ['tags', ';'] } as never);

    await expect(api.getValues()).resolves.toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('简单数组字段未声明分隔符时使用逗号', /** 默认分隔符写错会让后端收到整段字符串。 */ async () => {
    const api = await mountApi({ values: { tags: 'a,b' } as never });
    api.setState({ arrayToStringFields: ['tags'] } as never);

    await expect(api.getValues()).resolves.toEqual({ tags: ['a', 'b'] });
  });

  it('空字符串字段拆成空数组', /** 空串原样提交会让后端收到无意义的空字符串。 */ async () => {
    const api = await mountApi({ values: { tags: '' } as never });
    api.setState({ arrayToStringFields: ['tags'] } as never);

    await expect(api.getValues()).resolves.toEqual({ tags: [] });
  });

  it('数组字段在提交前拼成字符串', /** 未拼接会让后端收到数组而不是约定文本。 */ async () => {
    const api = await mountApi({ values: { tags: ['a', 'b'] } as never });
    api.setState({ arrayToStringFields: ['tags', ';'] } as never);

    await expect(api.getValues()).resolves.toEqual({ tags: 'a;b' });
  });

  it('复杂分隔符按字面量拆分而不是正则元字符', /** 未转义会让 `|` 一类分隔符被当成正则分支。 */ async () => {
    const api = await mountApi({ values: { tags: 'a|b' } as never });
    api.setState({ arrayToStringFields: ['tags', '|'] } as never);

    await expect(api.getValues()).resolves.toEqual({ tags: ['a', 'b'] });
  });

  it('非字符串值保持原样', /** 把数字当数组处理会让数值字段被清空。 */ async () => {
    const api = await mountApi({ values: { count: 5 } as never });
    api.setState({ arrayToStringFields: ['count', ';'] } as never);

    await expect(api.getValues()).resolves.toEqual({ count: 5 });
  });

  it('嵌套配置按分组用组内分隔符处理全部字段', /** 未支持嵌套会让多组字段只能共用同一个分隔符。 */ async () => {
    const api = await mountApi({
      values: { first: 'a|b', second: 'c,d' } as never,
    });
    // 嵌套格式为 [[字段名列表, 分隔符]]，与实现声明的分组处理一致。
    api.setState({
      arrayToStringFields: [[['first', 'second'], '|']],
    } as never);

    await expect(api.getValues()).resolves.toEqual({
      first: ['a', 'b'],
      // 组内分隔符对全部字段生效，未命中分隔符的字段拆成单元素数组。
      second: ['c,d'],
    });
  });

  it('嵌套配置的字段项不是字符串时跳过该组', /** 未跳过会让配置写错时整份表单取值抛错。 */ async () => {
    const api = await mountApi({ values: { tags: 'a,b' } as never });
    api.setState({
      arrayToStringFields: [[123 as never], ','],
    } as never);

    await expect(api.getValues()).resolves.toEqual({ tags: 'a,b' });
  });

  it('未声明数组字段配置时不改动取值', /** 默认改动会让所有表单的值被意外转换。 */ async () => {
    const api = await mountApi({ values: { tags: 'a,b' } as never });

    await expect(api.getValues()).resolves.toEqual({ tags: 'a,b' });
  });
});
