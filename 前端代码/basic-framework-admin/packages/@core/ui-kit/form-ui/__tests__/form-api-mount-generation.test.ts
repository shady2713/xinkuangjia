/**
 * FormApi 跨卸载重挂的异步失效判别回归。
 *
 * 容器 `form` 的引用跨卸载重挂刻意保持不变，异步失效检查若只比较容器引用与 `isMounted`，
 * 在途的旧校验与旧提交就会穿过重新挂载作用到新表单上：旧提交会执行旧业务回调并写回旧提交值，
 * 旧校验会把过期错误滚动定位到新表单。本文件用可控延迟把旧操作停在异步边界上，
 * 在等待期间完成 `unmount → mount`，验证旧结果一律失效，同时确认新挂载上的正常提交不受影响。
 */
import type { FormActions, FormValues } from '../src/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormApi } from '../src/form-api';

/** 旧挂载的提交值：与重新挂载后的值不同，用于识别旧提交是否写回。 */
const OLD_VALUES: FormValues = { password: 'DUMMY-旧提交值' };

/** 重新挂载后的提交值：旧结果失效后，提交快照必须停在这个值上。 */
const NEW_VALUES: FormValues = { password: 'DUMMY-新提交值' };

/** 可控延迟句柄：旧操作停在异步边界上，只有用例显式放行才会继续。 */
interface Deferred {
  /** 等待方持有的 Promise，用于让旧操作暂停在等待上。 */
  pending: Promise<void>;
  /** 放行等待中的调用方；调用后旧操作继续执行。 */
  release: () => void;
}

/** 提交成功分支签名：校验通过时接收表单值与 vee-validate 提交上下文。 */
type SubmitSuccessCallback = (validated: FormValues, context: never) => unknown;

/** 提交进入记录回调：旧提交进入等待前调用一次，用于确认它确实停在旧挂载上。 */
type SubmitEnterRecorder = () => void;

/**
 * 取出延迟句柄的放行函数。
 * 登记缺失说明 Promise 尚未完成构造，此时直接抛错而不是静默跳过，
 * 否则用例会停在等待上而不是暴露装配问题。
 * @param release 已登记的放行函数。
 * @returns 可用于放行的真实函数。
 * @throws {Error} 放行函数尚未登记。
 */
function requireRelease(
  release: SubmitEnterRecorder | undefined,
): SubmitEnterRecorder {
  if (!release) throw new Error('延迟句柄缺少放行函数');
  return release;
}

/**
 * 构造只暴露被测成员的表单上下文替身。
 * @param members 本个用例需要用到的上下文成员。
 * @returns 可直接交给 `FormApi.mount` 的替身。
 */
function stubFormActions(members: Partial<FormActions>): FormActions {
  return members as FormActions;
}

/**
 * 创建手动放行的延迟句柄。
 * @returns 等待用的 Promise 与放行函数。
 */
function createDeferred(): Deferred {
  /** 真实放行函数；由下面的 Promise 构造回调在同步执行阶段写入。 */
  let release: SubmitEnterRecorder | undefined;
  const pending = new Promise<void>(
    /** 记录放行函数，等待用例显式调用。 */ (resolve) => {
      release = resolve;
    },
  );
  /** 放行等待中的调用方，调用后旧操作才会继续执行。 */
  function releaseNow(): void {
    requireRelease(release)();
  }
  return { pending, release: releaseNow };
}

/**
 * 构造 vee-validate 校验结果替身。
 * @param valid 是否通过校验。
 * @param errors 字段级错误表，默认空对象表示没有错误。
 * @returns 满足整表校验结果契约的替身。
 */
function validationResult(valid: boolean, errors: Record<string, string> = {}) {
  return { errors, results: {}, source: 'fields' as const, valid };
}

/**
 * 构造提交工厂替身：校验通过时把固定值交给成功分支，覆盖“新挂载上正常提交”的正向对照。
 * @param values 校验通过后交给业务成功分支的表单值。
 * @returns vee-validate `handleSubmit` 成员形状的替身。
 */
function passingSubmit(values: FormValues) {
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
 * 构造延迟提交替身：提交函数进入后先记录一次进入，再等待放行，放行后才触发成功分支。
 * 用于把旧提交停在“校验等待”这一步，模拟真实 vee-validate 的异步规则。
 * @param values 放行后交给业务成功分支的旧表单值。
 * @param wait 提交函数进入后先等待的延迟。
 * @param onEnter 提交函数进入等待前的记录回调，用于确认旧提交确实停在旧挂载上。
 * @returns vee-validate `handleSubmit` 成员形状的替身。
 */
function delayedSubmit(
  values: FormValues,
  wait: Promise<void>,
  onEnter: SubmitEnterRecorder,
) {
  /**
   * 工厂形态的提交入口：调用返回的提交函数才会触发成功分支。
   * @param onSuccess 校验通过时的成功分支回调。
   * @returns 可调用的提交函数。
   */
  function factory(onSuccess: SubmitSuccessCallback) {
    return /** 先记录旧提交已进入，再等待放行并以旧值触发成功分支。 */ async () => {
      onEnter();
      await wait;
      return onSuccess(values, {} as never);
    };
  }
  return Object.assign(factory, { withControlled: factory }) as never;
}

/**
 * 构造延迟校验替身：进入后先等待放行，放行后返回固定的失败结果。
 * 用于把旧校验停在“等待校验结果”这一步。
 * @param wait 校验进入后等待的延迟。
 * @param errors 放行后返回的字段级错误表。
 * @returns 校验成员形状的替身。
 */
function delayedValidate(wait: Promise<void>, errors: Record<string, string>) {
  return /** 等待放行后返回固定的校验失败结果。 */ async () => {
    await wait;
    return { errors, results: {}, source: 'fields' as const, valid: false };
  };
}

/**
 * 构造延迟单字段校验替身：进入后先等待放行，放行后返回固定的失败结果。
 * 单字段校验的 errors 形状是字段名到错误文本数组，与整表校验不同，因此单独构造。
 * @param wait 校验进入后等待的延迟。
 * @param errors 放行后返回的字段级错误表。
 * @returns 单字段校验成员形状的替身。
 */
function delayedValidateField(
  wait: Promise<void>,
  errors: Record<string, string[]>,
) {
  /** 等待放行后返回固定的单字段校验失败结果。 */
  const delayed = async () => {
    await wait;
    return { errors, results: {}, source: 'fields' as const, valid: false };
  };
  // 单字段校验结果的 errors 是数组表，与这里刻意构造的固定替身形状不同，按调用契约转换。
  return delayed as never;
}

beforeEach(
  /** 每个用例前还原被替换的实现，避免用例之间串味。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('延迟提交跨卸载重挂', /** 提交在等待期间发生卸载重挂时，旧提交不得继续作用到新挂载上。 */ () => {
  it('提交停在旧挂载的校验等待时卸载重挂，旧提交不得执行旧的业务回调', /** 校验等待期间重挂后，旧提交既不得进入业务回调，也不得把旧值写回提交快照。 */ async () => {
    const api = new FormApi();
    const handleSubmit = vi.fn();
    api.setState({ handleSubmit });
    const staleSubmit = createDeferred();
    const staleEntered = vi.fn();

    await api.mount(
      stubFormActions({
        handleSubmit: delayedSubmit(
          OLD_VALUES,
          staleSubmit.pending,
          staleEntered,
        ),
        resetForm: vi.fn(),
        values: OLD_VALUES,
      }),
    );

    const pendingSubmit = api.submitForm();
    // 先确认旧提交已进入旧挂载的提交函数：此时卸载重挂才能复现“旧结果穿过重挂”。
    await vi.waitFor(
      /** 轮询直到旧提交函数确实被调用。 */ () => {
        expect(staleEntered).toHaveBeenCalledTimes(1);
      },
    );

    // 等待期间卸载并重新挂载：容器引用保持不变，只有挂载代次发生变化。
    api.unmount();
    await api.mount(
      stubFormActions({
        handleSubmit: passingSubmit(NEW_VALUES),
        resetForm: vi.fn(),
        values: NEW_VALUES,
      }),
    );

    // 放行旧提交：它必须因挂载代次已变化而失败，而不是继续走旧的业务链路。
    staleSubmit.release();
    await expect(pendingSubmit).rejects.toThrow('表单挂载已失效');
    expect(handleSubmit).not.toHaveBeenCalled();
    expect(api.getLatestSubmissionValues()).toEqual(NEW_VALUES);
  });

  it('业务回调等待期间卸载重挂，旧提交返回后不得写回旧提交值', /** 业务回调已经进入时重挂，回调返回后不得用旧值覆盖新挂载的提交快照。 */ async () => {
    const api = new FormApi();
    const business = createDeferred();
    const handleSubmit = vi.fn();
    handleSubmit.mockImplementation(
      /** 挂起业务提交，让旧提交停在新挂载之前。 */ () => business.pending,
    );
    api.setState({ handleSubmit });

    await api.mount(
      stubFormActions({
        handleSubmit: passingSubmit(OLD_VALUES),
        resetForm: vi.fn(),
        values: OLD_VALUES,
      }),
    );

    const pendingSubmit = api.submitForm();
    await vi.waitFor(
      /** 轮询直到业务提交回调确实被调用，确认旧提交已进入等待。 */ () => {
        expect(handleSubmit).toHaveBeenCalledTimes(1);
      },
    );

    // 业务回调仍挂起时卸载重挂，随后放行旧回调。
    api.unmount();
    await api.mount(
      stubFormActions({
        handleSubmit: passingSubmit(NEW_VALUES),
        resetForm: vi.fn(),
        values: NEW_VALUES,
      }),
    );

    business.release();
    await expect(pendingSubmit).rejects.toThrow('表单挂载已失效');
    expect(api.getLatestSubmissionValues()).toEqual(NEW_VALUES);
  });

  it('重新挂载后的新提交仍能正常回调并写回本次提交值', /** 正向对照：代次校验只拦旧挂载的结果，不得把重挂后的正常提交一并拦掉。 */ async () => {
    const api = new FormApi();
    const handleSubmit = vi.fn();
    api.setState({ handleSubmit });

    await api.mount(
      stubFormActions({
        handleSubmit: passingSubmit(OLD_VALUES),
        resetForm: vi.fn(),
        values: OLD_VALUES,
      }),
    );
    api.unmount();
    await api.mount(
      stubFormActions({
        handleSubmit: passingSubmit(NEW_VALUES),
        resetForm: vi.fn(),
        values: NEW_VALUES,
      }),
    );

    await expect(api.submitForm()).resolves.toEqual(NEW_VALUES);
    expect(handleSubmit).toHaveBeenCalledWith(NEW_VALUES);
    expect(api.getLatestSubmissionValues()).toEqual(NEW_VALUES);
  });
});

describe('延迟验证跨卸载重挂', /** 校验在等待期间发生卸载重挂时，旧校验结果不得作用于新挂载的表单。 */ () => {
  it('整表校验等待期间卸载重挂，旧校验结果不得滚动新表单', /** 过期错误若继续定位，会把新表单滚动到旧挂载的错误字段上。 */ async () => {
    const api = new FormApi();
    const scrollToFirstError = vi.spyOn(api, 'scrollToFirstError');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 丢弃错误输出，断言通过调用记录完成。 */ () => {});
    api.setState({ scrollToFirstError: true });
    const staleValidate = createDeferred();

    await api.mount(
      stubFormActions({
        resetForm: vi.fn(),
        validate: delayedValidate(staleValidate.pending, {
          password: 'DUMMY-旧错误',
        }),
      }),
    );

    const pendingValidate = api.validate();

    // 校验等待期间卸载重挂，随后放行旧校验结果。
    api.unmount();
    await api.mount(
      stubFormActions({
        resetForm: vi.fn(),
        /** 声明新挂载的表单校验失败，用于识别过期调用是否作用到新表单。 */
        validate: async () =>
          validationResult(false, { password: 'DUMMY-新错误' }),
      }),
    );

    staleValidate.release();
    // 先让旧调用结算再核对副作用：过期结果一旦被放行，新表单会被滚动并打印旧错误。
    await Promise.allSettled([pendingValidate]);
    expect(scrollToFirstError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    await expect(pendingValidate).rejects.toThrow('表单挂载已失效');
  });

  it('单字段校验等待期间卸载重挂，旧校验结果不得滚动新表单', /** 单字段校验与整表校验必须共用同一套失效判定。 */ async () => {
    const api = new FormApi();
    const scrollToFirstError = vi.spyOn(api, 'scrollToFirstError');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 丢弃错误输出，断言通过调用记录完成。 */ () => {});
    api.setState({ scrollToFirstError: true });
    const staleValidate = createDeferred();

    await api.mount(
      stubFormActions({
        resetForm: vi.fn(),
        validateField: delayedValidateField(staleValidate.pending, {
          password: ['DUMMY-旧错误'],
        }),
      }),
    );

    const pendingValidate = api.validateField('password');

    api.unmount();
    await api.mount(
      stubFormActions({
        resetForm: vi.fn(),
        /** 声明新挂载的字段校验失败，用于识别过期调用是否作用到新表单。 */
        validateField: async () =>
          /** 单字段校验结果按字段名到错误文本数组的真实契约构造。 */ ({
            errors: { password: ['DUMMY-新错误'] },
            valid: false,
          }) as never,
      }),
    );

    staleValidate.release();
    // 先让旧调用结算再核对副作用，最后确认它必须以挂载失效失败。
    await Promise.allSettled([pendingValidate]);
    expect(scrollToFirstError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    await expect(pendingValidate).rejects.toThrow('表单挂载已失效');
  });
});
