/**
 * 表单组件的真实挂载与提交链路回归测试。
 *
 * 覆盖四类行为：提交链路的“校验通过才回调”、条件字段的渲染语义、
 * 异步联动的竞态与组件卸载后的资源清理。
 */
import type { Component } from 'vue';

import type { BaseFormComponentType } from '../src/types';

import { flushPromises, mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { useVbenForm } from '../src/use-form';

/** 测试用的最小业务值类型：覆盖必填、联动与异步联动三种场景。 */
type DemoValues = {
  detail?: string;
  mode: number;
  name: string;
};

/** 已挂载组件中可等待 DOM 更新的最小接口。 */
type MountedLike = {
  vm: {
    /** 等待一次渲染与异步队列结算。 */
    $nextTick: () => Promise<void>;
  };
};

/** 放行挂起的异步联动：调用后该联动才会返回参数。 */
type ReleaseHook = () => void;

/**
 * 冲刷挂载后建立的值变化监听与异步联动回调。
 * 联动回调会在 await 之后写回响应式状态，只等待一次 tick 不足以让 DOM 收敛。
 * @param wrapper 已挂载的组件包装器。
 * @returns 冲刷完成后兑现的 Promise。
 */
async function flush(wrapper: MountedLike) {
  await flushPromises();
  await wrapper.vm.$nextTick();
  await flushPromises();
}

/**
 * 挂载真实表单组件并等待挂载后的监听建立。
 * @param options 表单属性，与 useVbenForm 的入参一致。
 * @returns 表单操作实例与组件包装器。
 */
async function mountForm(options: Parameters<typeof useVbenForm>[0]) {
  const [Form, formApi] = useVbenForm<BaseFormComponentType, DemoValues>(
    options,
  );
  const wrapper = mount(Form as Component);
  await flush(wrapper);
  return { formApi, wrapper };
}

describe('useVbenForm 提交链路', /** 提交时取值与回调的时机契约。 */ () => {
  it('合法提交时调用业务处理器并回传校验后的值', /** 全部规则通过时，提交链路必须把校验后的值交给业务处理器，并原样返回。 */ async () => {
    const handleSubmit = vi.fn();
    const { formApi } = await mountForm({
      handleSubmit,
      schema: [
        {
          component: 'VbenInput',
          fieldName: 'name',
          label: '名称',
          rules: z.string().min(1, '名称必填'),
        },
      ],
    });

    await formApi.setFieldValue('name', '已填写');
    const submitted = await formApi.submitForm();

    expect(handleSubmit).toHaveBeenCalledTimes(1);
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: '已填写' }),
    );
    expect(submitted).toEqual(expect.objectContaining({ name: '已填写' }));
  });

  /**
   * 缺陷回归：校验不通过时业务处理器绝不能被调用，提交结果为 undefined。
   * 该用例锁定 `submitForm` 必须走 vee-validate 的成功分支，而不是直接调用回调。
   */
  const rejectsBusinessHandlerWhenInvalid = async () => {
    const handleSubmit = vi.fn();
    const { formApi } = await mountForm({
      handleSubmit,
      schema: [
        {
          component: 'VbenInput',
          fieldName: 'name',
          label: '名称',
          rules: z.string().min(1, '名称必填'),
        },
      ],
    });

    // 保持空值：必填规则必然不通过。
    await formApi.setFieldValue('name', '');
    const submitted = await formApi.submitForm();

    expect(handleSubmit).not.toHaveBeenCalled();
    expect(submitted).toBeUndefined();
  };

  it(
    '必填未填时校验失败，业务处理器绝不被调用（缺陷回归）',
    rejectsBusinessHandlerWhenInvalid,
  );

  it('值类型泛型让 getValues 直接返回声明的形状', /** 值类型泛型的编译期收益：getValues 按泛型实参收窄，调用侧无需任何断言。 */ async () => {
    const { formApi } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'name', label: '名称' },
        { component: 'VbenInput', fieldName: 'detail', label: '备注' },
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
      ],
    });

    await formApi.setFieldValue('name', 'vben');
    // 该调用没有断言也没有双重转换：字段类型直接来自泛型实参。
    const values = await formApi.getValues();
    const name: string = values.name;

    expect(name).toBe('vben');
  });
});

describe('useVbenForm 条件字段', /** 条件字段的渲染语义。 */ () => {
  it('if 为 false 时不渲染表单项，show 为 false 时保留但隐藏', /** if 与 show 语义不同：if 为 false 时节点不进入 DOM，show 为 false 时节点保留但被隐藏。 */ async () => {
    const { formApi, wrapper } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
        {
          component: 'VbenInput',
          dependencies: {
            // 依赖 mode：只有 mode 为 1 时才渲染该字段。
            if: (values) => values.mode === 1,
            triggerFields: ['mode'],
          },
          fieldName: 'name',
          label: '名称',
        },
        {
          component: 'VbenInput',
          dependencies: {
            // 依赖 mode：不满足时字段保留在 DOM 中，仅被样式隐藏。
            show: (values) => values.mode === 1,
            triggerFields: ['mode'],
          },
          fieldName: 'detail',
          label: '备注',
        },
      ],
    });

    // mode 非 1：name 被 if 摘除，detail 仍渲染但被 CSS 隐藏。
    await formApi.setFieldValue('mode', 2);
    await flush(wrapper);
    expect(wrapper.find('input[name="name"]').exists()).toBe(false);
    expect(wrapper.find('input[name="detail"]').exists()).toBe(true);

    // mode 为 1：两个字段都恢复显示。
    await formApi.setFieldValue('mode', 1);
    await flush(wrapper);
    expect(wrapper.find('input[name="name"]').exists()).toBe(true);
    expect(wrapper.find('input[name="detail"]').exists()).toBe(true);
  });
});

describe('useVbenForm 异步联动竞态', /** 异步联动在快速连续触发下的写回顺序。 */ () => {
  it('快速连续触发时，较早的异步结果不会覆盖较新的结果', /** 缺陷回归：较早那次异步联动的迟到结果不得覆盖最新一次结论。 */ async () => {
    const { formApi, wrapper } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
        {
          component: 'VbenInput',
          // 用 if（v-if）而不是 show（v-show）：只有 v-if 会把节点真正移除，便于断言。
          dependencies: {
            // 按触发时的 mode 值延迟返回：mode=1 的那次刻意最慢且返回 true。
            if: async (values) => {
              const expected = values.mode;
              // 若没有丢弃过期结果，这次迟到的 true 会盖掉最新一次（mode=2）的 false。
              await new Promise(
                /** 按触发值决定延迟：mode=1 延迟 80ms，制造迟到的旧结果。 */
                (resolve) => {
                  setTimeout(resolve, expected === 1 ? 80 : 0);
                },
              );
              return expected === 1;
            },
            triggerFields: ['mode'],
          },
          fieldName: 'name',
          label: '名称',
        },
      ],
    });

    // 先触发会返回 true 的慢联动。
    await formApi.setFieldValue('mode', 1);
    // 必须等监听真正跑起来，否则两次赋值会被同一个 watcher 合并，竞态就复现不出来。
    await flush(wrapper);
    // 再触发会返回 false 的快联动。
    await formApi.setFieldValue('mode', 2);
    await flush(wrapper);

    // 等待慢联动的迟到结果落地。
    await new Promise(
      /** 定时 160ms，让刻意延迟的旧联动有机会完成并尝试写回。 */
      (resolve) => {
        setTimeout(resolve, 160);
      },
    );
    await flush(wrapper);

    // 最新一次联动的结论是 false：若旧结果被写入，name 会被错误地渲染出来。
    expect(wrapper.find('input[name="name"]').exists()).toBe(false);
  });
});

describe('useVbenForm 卸载清理', /** 组件销毁后不得残留定时器与在途异步结果。 */ () => {
  it('卸载后待执行的防抖自动提交被取消', /** 缺陷回归：已经排入防抖窗口的自动提交必须随组件销毁一起取消。 */ async () => {
    vi.useFakeTimers();
    try {
      const handleSubmit = vi.fn();
      const { formApi, wrapper } = await mountForm({
        handleSubmit,
        schema: [{ component: 'VbenInput', fieldName: 'name', label: '名称' }],
        submitOnChange: true,
      });

      await formApi.setFieldValue('name', '触发自动提交');
      await vi.advanceTimersByTimeAsync(0);

      // 值变化已排入 300ms 防抖，组件在计时器触发前销毁。
      // 直接监视提交入口而不是业务回调：卸载后 getForm() 会先抛“表单已卸载”，
      // 业务 handleSubmit 无论如何都不会被调用，断言它区分不出守卫是否生效。
      const submitSpy = vi
        .spyOn(formApi, 'validateAndSubmitForm')
        .mockResolvedValue(undefined);
      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(1000);

      // 卸载钩子清掉计时器后，防抖窗口内的自动提交不会发出任何提交请求。
      expect(submitSpy).not.toHaveBeenCalled();
      expect(handleSubmit).not.toHaveBeenCalled();
      expect(formApi.isMounted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('卸载后在途的异步联动结果不会写回已销毁的表单项', /** 缺陷回归：组件销毁后才返回的异步联动结果，不得写回已销毁的表单项。 */ async () => {
    // 手动控制异步联动的返回时机，用于精确制造“在途”状态。
    let releaseDependency: ReleaseHook | undefined;
    const { formApi, wrapper } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
        {
          // 静态参数刻意不带 placeholder：只有异步联动成功返回后才会出现。
          component: 'VbenInput',
          dependencies: {
            // 挂起等待测试放行后才返回参数，返回后即代表“在途异步结果”。
            componentProps: async () => {
              await new Promise<void>(
                /** 永不自行兑现，只有测试显式调用放行函数。 */
                (resolve) => {
                  releaseDependency = resolve;
                },
              );
              return { placeholder: '联动写入的占位符' };
            },
            triggerFields: ['mode'],
          },
          fieldName: 'name',
          label: '名称',
        },
      ],
    });

    expect(
      wrapper.find('input[name="name"]').attributes('placeholder'),
    ).toBeUndefined();

    await formApi.setFieldValue('mode', 1);
    // 等依赖回调真正挂起，确认存在“在途异步结果”。
    await vi.waitFor(
      /** 轮询直到放行句柄被挂起回调写入。 */
      () => {
        expect(releaseDependency).toBeTypeOf('function');
      },
    );

    const detached = wrapper.element;
    wrapper.unmount();

    // 组件销毁后才让异步联动返回。
    releaseDependency?.();
    await new Promise(
      /** 给迟到结果留出落地时间，再断言它没有写回。 */
      (resolve) => {
        setTimeout(resolve, 30);
      },
    );

    // 迟到结果没有落到已销毁的 DOM 上。
    expect(
      detached.querySelector('input[name="name"]')?.getAttribute('placeholder'),
    ).toBe(null);
  });
});

describe('formApi 挂载生命周期', /** 实例在挂载前后的读写行为。 */ () => {
  it('挂载前的读取请求会挂起等待，挂载后拿到真实值', /** 挂载前的读取请求必须保持等待，不能提前返回空对象。 */ async () => {
    const [Form, formApi] = useVbenForm<BaseFormComponentType, DemoValues>({
      schema: [
        {
          component: 'VbenInput',
          defaultValue: 'vben',
          fieldName: 'name',
          label: '名称',
        },
      ],
    });

    let settled = false;
    const pending = formApi.getValues().then(
      /** 记录读取是否已兑现，并交回读取结果供后续断言。 */
      (values) => {
        settled = true;
        return values;
      },
    );

    await new Promise(
      /** 等待 20ms，确认挂载前的读取请求确实没有提前兑现。 */
      (resolve) => {
        setTimeout(resolve, 20);
      },
    );
    // 尚未挂载：读取请求必须保持等待，而不是返回空对象。
    expect(settled).toBe(false);

    const wrapper = mount(Form as Component);
    await flush(wrapper);

    // 挂载后拿到的是挂载那一刻的真实表单值。
    await expect(pending).resolves.toEqual(
      expect.objectContaining({ name: 'vben' }),
    );
    wrapper.unmount();
  });

  it('组件卸载后读取表单值会明确失败，而不是返回空对象', /** 已卸载的实例必须明确失败，避免业务把空值误当成真实数据。 */ async () => {
    const { formApi, wrapper } = await mountForm({
      schema: [{ component: 'VbenInput', fieldName: 'name', label: '名称' }],
    });

    await formApi.setFieldValue('name', 'vben');
    await expect(formApi.getValues()).resolves.toEqual(
      expect.objectContaining({ name: 'vben' }),
    );

    wrapper.unmount();

    await expect(formApi.getValues()).rejects.toThrow('表单已卸载');
    expect(formApi.isMounted).toBe(false);
  });
});
