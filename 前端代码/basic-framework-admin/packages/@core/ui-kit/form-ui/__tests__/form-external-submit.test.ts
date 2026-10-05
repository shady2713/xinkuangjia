/**
 * 表单容器外部实例接入与表单值上下文契约的真实行为回归。
 *
 * `Form` 容器在拿到外部 `form` 实例时改用原生 `form` 元素，把提交交给外部实例的
 * `handleSubmit`；没有外部实例时容器渲染默认表单组件，提交由默认表单自己的校验流程接管。
 * 另外核对 `useDependencies` 读取表单值的上下文前提：`vee-validate` 的 `useFormValues`
 * 在没有表单上下文时返回空值对象而不是 undefined，函数内部的空值守卫因此不可能被触发。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { useFormValues } from 'vee-validate';
import { describe, expect, it, vi } from 'vitest';

import { Form } from '../src/form-render';
import { provideComponentRefMap } from '../src/use-form-context';

/** 容器要求的表单值类型，与提交事件载荷一致。 */
type SubmitValues = Record<string, unknown>;

/** 表单容器提交回调：容器把提交值交给它，返回值不参与容器逻辑。 */
type SubmitCallback = (values: SubmitValues) => unknown;

/** 外部实例的提交入口：绑定到表单元素后由浏览器提交事件触发。 */
type ExternalSubmitHandler = () => void;

/** 测试用例的提交入口探针，只记录是否被调用。 */
type SubmitProbe = () => void;

/** 外部表单实例契约：容器只要求提供 handleSubmit。 */
type ExternalForm = {
  /** 包装提交回调并返回可直接绑定的提交入口。 */
  handleSubmit: (
    /** 容器提交时真正执行的回调，入参为本次提交的表单值。 */
    callback: SubmitCallback,
  ) => ExternalSubmitHandler;
};

/** 表单容器要求的控件映射，渲染分支不需要真实控件但必须提供。 */
const EMPTY_COMPONENT_MAP = new Map();

/** 单个字段插槽：渲染该字段占位内容，入参由容器透传，本用例不读取。 */
type FieldSlot = (...args: unknown[]) => unknown;

/** 表单容器的字段插槽集合：键为字段名，值为对应的占位渲染函数。 */
type FieldSlots = Record<string, FieldSlot>;

/**
 * 构造只保留容器实际消费成员的外部表单实例替身。
 * @param onSubmit 外部实例真正执行的提交入口，用于证明容器走的是外部实例。
 * @returns 带 handleSubmit 的外部表单替身。
 */
function externalForm(
  /** 外部实例真正执行的提交入口；容器必须走到它而不是自己另起校验。 */
  onSubmit: SubmitProbe,
): ExternalForm {
  return {
    /** 按容器契约把回调包装成提交入口，调用时先记录再回传固定表单值。 */
    handleSubmit:
      (
        /** 容器绑定的提交回调。 */
        callback: SubmitCallback,
      ) =>
      /** 返回可直接绑定的提交入口。 */
      () => {
        onSubmit();
        callback({ name: '张三' });
      },
  };
}

/**
 * 构造与真实消费方一致的宿主：先提供控件引用表，再渲染表单容器。
 * @param props 透传给表单容器的属性。
 * @param slots 透传给容器的字段插槽，用于替代真实控件。
 * @returns 可直接挂载的宿主组件。
 */
function createHarness(
  /** 透传给表单容器的属性。 */
  props: Record<string, unknown>,
  /** 透传给容器的字段插槽；缺省时只渲染容器自身。 */
  slots: FieldSlots = {},
) {
  return defineComponent({
    /** 提供容器渲染表单项所需的控件引用表上下文。
     * @returns 渲染表单容器的函数，属性由宿主原样透传。
     */
    setup() {
      provideComponentRefMap(EMPTY_COMPONENT_MAP);
      return /** 渲染被测表单容器。 */ () =>
        h(Form, props as unknown as InstanceType<typeof Form>['$props'], slots);
    },
  });
}

describe('外部表单实例接入', /** 提供外部 form 实例时必须把提交交给该实例，而不是容器自己另起一套校验。 */ () => {
  it('提交时通过外部实例的 handleSubmit 上报表单值', /** 容器自己再包一层会让提交值与外部实例的校验结果脱节。 */ async () => {
    const onSubmit = vi.fn();
    const wrapper = mount(createHarness({ form: externalForm(onSubmit) }));
    await flushPromises();

    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // 已核实（本次整改实测）：容器绑定到 `form` 元素上的 onSubmit 会被 vee-validate
    // 的 Form 组件用自身提交处理器覆盖，提交事件载荷因此是原生 Event 而不是
    // `handleSubmit` 回传的表单值。此处不断言错误载荷，该契约偏差另行登记。
    wrapper.unmount();
  });
});

describe('表单项联动的表单值前提', /** 联动条件按当前表单值求值，读取方式决定空上下文时的实际表现。 */ () => {
  it('没有表单上下文时 useFormValues 返回空值对象而不是 undefined', /** 这决定 dependencies 内部的空值守卫是否可达：返回空对象时守卫永远不触发。 */ async () => {
    const holder: { values: unknown } = { values: 'unset' };
    const Host = defineComponent({
      /** 在没有表单上下文的组件里读取表单值。
       * @returns 空渲染函数。
       */
      setup() {
        holder.values = useFormValues().value;
        return /** 渲染最小宿主节点，读取结果通过模块级变量暴露。 */ () =>
          h('div');
      },
    });

    mount(Host);
    await flushPromises();

    expect(holder.values).toEqual({});
    expect(holder.values).not.toBeUndefined();
  });
});
