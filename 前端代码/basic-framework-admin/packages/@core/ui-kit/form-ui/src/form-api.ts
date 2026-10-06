/**
 * 表单实例核心：统一状态读写、校验、提交与挂载生命周期。
 * useVbenForm 为每个表单建一份实例，渲染组件挂载时
 * 回填 vee-validate 上下文。
 * 所有异步读写先取挂载句柄，卸载重挂后按代次判定旧结果失效。
 * 不负责渲染界面，也不定义 schema 结构。
 */
import type {
  FormState,
  Path,
  PathValue,
  ResetFormOpts,
  ValidationOptions,
} from 'vee-validate';

import type {
  BaseFormComponentType,
  FormActions,
  FormSchema,
  FormValues,
  FormValuesConstraint,
  VbenFormProps,
} from './types';

import { isRef, toRaw } from 'vue';

import { Store } from '@vben-core/shared/store';
import {
  bindMethods,
  formatDate,
  isDate,
  isDayjsObject,
  isFunction,
  mergeWithArrayOverride,
  StateHandler,
} from '@vben-core/shared/utils';

import { isValueRecord } from './form-render/helper';

/** 表单属性与组件/值类型的组合别名：泛型值类型决定读写时的实际数据形状。 */
type TypedFormProps<
  TValues extends FormValuesConstraint,
  TComp extends BaseFormComponentType,
> = VbenFormProps<TComp, TValues>;

/** vee-validate 的 setValues 接受部分深层值，此处取其真实入参类型而不重复声明。 */
type SetValuesArg<TValues extends FormValuesConstraint> = Parameters<
  FormActions<TValues>['setValues']
>[0];

/**
 * 组合表单的一个成员读取能力。
 * 组合只关心“校验通过后的值”，与各成员声明的值类型无关，因此用闭包而不是实例列表登记。
 */
type FormCollector = () => Promise<FormValues | undefined>;

/**
 * 单个字段值的转换器，用于数组与字符串之间的互转。
 * @param value 字段当前的值，可能已被调用方收窄为数组或字符串。
 * @param separator 字符串与数组之间的分隔符。
 * @returns 转换后的字段值。
 */
type FieldValueTransform = (value: unknown, separator: string) => unknown;

/**
 * 基于当前状态计算状态增量。
 * 用函数式更新而不是外部快照，避免读到的状态落后于并发写入。
 * @param prev 当前的表单状态快照。
 * @returns 本次要覆盖的增量。
 */
type StateUpdater<
  TValues extends FormValuesConstraint,
  TComp extends BaseFormComponentType,
> = (
  prev: TypedFormProps<TValues, TComp>,
) => Partial<TypedFormProps<TValues, TComp>>;

/**
 * 一次挂载产生的表单上下文句柄。
 *
 * `form` 容器的引用跨卸载重挂刻意保持不变，异步失效检查只比较容器引用无法区分
 * “同一个容器里的新挂载”，旧校验与旧提交会因此作用到新表单上。
 * 句柄因此同时携带该次挂载的代次标识，供每个异步边界后判定旧结果是否已经失效。
 */
type MountedFormHandle<TValues extends FormValuesConstraint> = {
  /** 本次挂载写入容器的 vee-validate 表单上下文。 */
  form: FormActions<TValues>;
  /** 本次挂载的代次标识；每次成功挂载自增，卸载重挂后旧代次的句柄一律失效。 */
  generation: number;
};

/** 创建互不共享的表单配置默认值。 */
function getDefaultState<
  TValues extends FormValuesConstraint,
  TComp extends BaseFormComponentType,
>(): TypedFormProps<TValues, TComp> {
  return {
    actionWrapperClass: '',
    collapsed: false,
    collapsedRows: 1,
    collapseTriggerResize: false,
    commonConfig: {},
    handleReset: undefined,
    handleSubmit: undefined,
    handleValuesChange: undefined,
    handleCollapsedChange: undefined,
    layout: 'horizontal',
    resetButtonOptions: {},
    schema: [],
    scrollToFirstError: false,
    showCollapseButton: false,
    showDefaultActions: true,
    submitButtonOptions: {},
    submitOnChange: false,
    submitOnEnter: false,
    wrapperClass: 'grid-cols-1',
  };
}

/**
 * 协调动态表单状态、验证及挂载生命周期。
 *
 * `TValues` 是调用方声明的表单值类型，决定 `getValues`、`setValues`、提交回调的入参与返回类型；
 * `TComp` 是当前适配层注册的组件名集合，决定 schema 中 `component` 的可取值。
 */
export class FormApi<
  TValues extends FormValuesConstraint = FormValues,
  TComp extends BaseFormComponentType = BaseFormComponentType,
> {
  /**
   * 挂载后供业务直接读取的 vee-validate 表单上下文。
   *
   * 这里刻意保持对象引用恒定，而不是在挂载时替换引用：`const [Form, { form }] = useVbenForm(...)`
   * 这类解构写法在 setup 期就把属性值取走，之后不会再读取本属性，替换引用会让解构方永远停留在挂载前的空值。
   * 因此 `mount` 把上下文成员复制进这个容器，`unmount` 逐个清空成员：容器本身始终存在，
   * 挂载前与卸载后读取到的成员均为 undefined，业务侧仍可按“有值即已挂载”判断。
   */
  public form: FormActions<TValues> = {} as FormActions<TValues>;
  isMounted = false;
  public state: null | TypedFormProps<TValues, TComp> = null;
  stateHandler: StateHandler;

  public store: Store<TypedFormProps<TValues, TComp>>;
  /**
   * 组件实例映射
   */
  private componentRefMap: Map<string, unknown> = new Map();

  // 最后一次点击提交时的表单值
  private latestSubmissionValues: null | TValues = null;

  private lifecycle = 0;

  /**
   * 当前挂载的代次标识。
   * 每次成功挂载自增：容器引用在卸载重挂后不变，只有代次能证明一个在途异步结果
   * 是否仍属于发起它的那次挂载。代次不参与重置，因此旧挂载的句柄永远不会再次命中。
   */
  private mountGeneration = 0;

  private prevState: null | TypedFormProps<TValues, TComp> = null;

  private wasUnmounted = false;

  /**
   * 建立表单实例的状态容器，并把实例方法绑定到自身，供代理与 `useVbenForm` 直接取出调用。
   * 挂载前的所有读写都只作用于 `state`；真实的 vee-validate 上下文由 `mount` 补入。
   * @param options 调用方声明的表单配置；缺省时使用 `getDefaultState` 的默认值。
   */
  constructor(
    options: TypedFormProps<TValues, TComp> = {} as TypedFormProps<
      TValues,
      TComp
    >,
  ) {
    const { ...storeState } = options;

    const defaultState = getDefaultState<TValues, TComp>();

    this.store = new Store<TypedFormProps<TValues, TComp>>(
      {
        ...defaultState,
        ...storeState,
      },
      {
        onUpdate: () => {
          this.prevState = this.state;
          this.state = this.store.state;
          this.updateState();
        },
      },
    );

    this.state = this.store.state;
    this.stateHandler = new StateHandler();
    bindMethods(this);
  }

  /**
   * 获取字段组件实例
   *
   * 实例形状由注册进 `COMPONENT_MAP` 的控件决定，类型系统无法推断，
   * 因此由调用方按实际控件声明需要的结构。
   * @param fieldName 字段名
   * @returns 组件实例；字段尚未渲染时返回 undefined
   */
  getFieldComponentRef<R = unknown>(fieldName: string): R {
    const target = this.componentRefMap.get(fieldName);
    return (isRef(target) ? target.value : target) as R;
  }

  /**
   * 获取当前聚焦的字段，如果没有聚焦的字段则返回undefined
   * 字段是否聚焦以真实 DOM 焦点为准：组件实例自身是元素时直接比较，
   * 否则回退到其 `$el`，因此未渲染或已销毁的字段不会被误判。
   * @returns 持有焦点的字段名；没有任何字段聚焦时返回 undefined。
   */
  getFocusedField() {
    for (const fieldName of this.componentRefMap.keys()) {
      const ref = this.getFieldComponentRef(fieldName);
      if (ref) {
        let el: HTMLElement | null = null;
        if (ref instanceof HTMLElement) {
          el = ref;
        } else if (isValueRecord(ref) && ref.$el instanceof HTMLElement) {
          el = ref.$el;
        }
        if (!el) {
          continue;
        }
        if (
          el === document.activeElement ||
          el.contains(document.activeElement)
        ) {
          return fieldName;
        }
      }
    }
    return undefined;
  }

  /**
   * 读取最近一次点击提交时捕获的表单值。
   * 业务提交常在 await 之后才请求详情页的取消/重置标记，需要读提交瞬间的值而不是当前输入值。
   * @returns 最近一次提交的表单值；尚未提交过且未挂载时返回空值视图而非 undefined。
   */
  getLatestSubmissionValues(): TValues {
    return this.latestSubmissionValues ?? this.toValueType({});
  }

  getState() {
    return this.state;
  }

  /** 读取当前表单值，必要时展开时间区间与数组字段。
   * @returns 调用方声明的值类型；表单未挂载或已销毁时抛出。
   */
  async getValues(): Promise<TValues> {
    const handle = await this.getFormHandle();
    this.assertMountedForm(handle);
    return this.toValueType(this.handleRangeTimeValue(handle.form.values));
  }

  /**
   * 判断单个字段当前是否通过校验。
   * 字段名来自调用方声明的 schema，但类型系统无法在运行时证明它属于 `TValues` 的哪条路径。
   * @param fieldName 待检查的字段名。
   * @returns 该字段无校验错误时为 true。
   * @throws {Error} 表单未挂载或挂载已失效。
   */
  async isFieldValid(fieldName: string) {
    const handle = await this.getFormHandle();
    this.assertMountedForm(handle);
    return handle.form.isFieldValid(fieldName as Path<TValues>);
  }

  /** 创建表单组合视图，只有全部校验通过才返回聚合值。
   *
   * 组合成员只按“校验后取值”的能力登记，不要求各成员声明相同的值类型，
   * 因此这里保存读取闭包而不是实例列表。
   * @param formApi 需要共同提交的表单。
   * @returns 以目标表单方法为底、只覆盖 `merge` 与 `submitAllForm` 的视图。
   */
  merge<T extends FormValuesConstraint>(formApi: FormApi<T>): FormApi<T> {
    const readers: FormCollector[] = [
      /** 组合的第一个成员始终是调用方当前持有的实例。 */ () =>
        this.collectOne(this),
      /** 第二个成员是本次 merge 传入的实例，其值类型可以与当前实例不同。 */ () =>
        this.collectOne(formApi),
    ];

    // 代理处理函数里的 this 指向 handler 自身而不是本实例，
    // 因此组合动作统一走这里预绑定好的读取闭包，避免把 this 别名成局部变量。
    /** 把下一个成员登记进组合，登记时只记录读取能力，不缓存实例。 */
    const addReader = (nextFormApi: FormApi): void => {
      readers.push(
        /** 读取闭包而非实例，合并时才读取该成员的当前值。 */ () =>
          this.collectOne(nextFormApi),
      );
    };
    /** 提交组合中每个真实表单，needMerge 决定是否顺带合并当前值。 */
    const submitReaders = (needMerge = true) =>
      this.collectAll(readers, needMerge);

    const proxy = new Proxy(formApi, {
      /**
       * 只拦截组合动作，其余成员原样转发给真实目标实例，
       * 这样调用方在组合视图上调用的仍是同一套 FormApi 契约。
       * @param target 被代理的真实表单实例。
       * @param prop 访问的属性名。
       * @param receiver 触发访问的接收者。
       * @returns 组合动作返回新的处理函数，其余成员返回目标实例上的原值。
       */
      get(target, prop, receiver): unknown {
        if (prop === 'merge') {
          return /** 将下一个表单加入当前组合。 */ (nextFormApi: FormApi) => {
            addReader(nextFormApi);
            return proxy;
          };
        }
        if (prop === 'submitAllForm') {
          return /** 校验组合中每个真实表单。 */ (needMerge = true) =>
            submitReaders(needMerge);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    return proxy;
  }

  /**
   * 交入真实表单上下文并放行挂载等待。
   * 重复挂载直接忽略：第二次调用来自组件重渲染，不能覆盖已在使用的上下文与组件引用。
   * 上下文成员被复制进固定的 `form` 容器而不是替换容器引用，
   * 这样 setup 期解构出 `form` 并长期持有的消费方（如锁屏）在挂载后仍能读到真实上下文。
   * 每次真正写入上下文前先自增挂载代次：容器引用恒定，异步操作只能靠代次识别自己是否已被重挂顶替。
   * @param formActions 由 `use-form-renderer` 提供的 vee-validate 表单上下文。
   * @param componentRefMap 字段名到组件实例的映射，用于聚焦定位与滚动定位。
   */
  mount(
    formActions: FormActions<TValues>,
    componentRefMap = new Map<string, unknown>(),
  ) {
    if (!this.isMounted) {
      // 必须先于写入自增：写入后任何异步回调读到的都应是本次挂载的代次。
      this.mountGeneration++;
      Object.assign(this.form, formActions);
      this.wasUnmounted = false;
      this.setLatestSubmissionValues(
        this.toValueType(this.handleRangeTimeValue(this.form.values)),
      );
      this.componentRefMap = componentRefMap;
      this.isMounted = true;
      this.stateHandler.setConditionTrue();
    }
  }

  /**
   * 根据字段名移除表单项
   * @param fields
   */
  async removeSchemaByFields(fields: string[]) {
    const fieldSet = new Set(fields);
    const schema = this.state?.schema ?? [];

    const filterSchema = schema.filter((item) => !fieldSet.has(item.fieldName));

    this.setState({
      schema: filterSchema,
    });
  }

  /**
   * 重置表单
   * @param state 重置后要写回的字段值；缺省时回到初始值。
   * @param opts vee-validate 的重置选项，例如是否保留默认值或强制触碰字段。
   * @returns 重置完成后 resolve。
   * @throws {Error} 表单未挂载或挂载已失效。
   */
  async resetForm(
    state?: Partial<FormState<TValues>> | undefined,
    opts?: Partial<ResetFormOpts>,
  ) {
    const handle = await this.getFormHandle();
    this.assertMountedForm(handle);
    return handle.form.resetForm(state, opts);
  }

  /**
   * 清空当前全部字段的校验错误。
   * 只清错误不动值：schema 更新后需要重新校验，但用户已填内容必须保留。
   * @throws {Error} 表单未挂载或挂载已失效。
   */
  async resetValidate() {
    const handle = await this.getFormHandle();
    this.assertMountedForm(handle);
    const fields = Object.keys(handle.form.errors.value);
    fields.forEach(
      /** 逐个把错误置为 undefined，等价于清除该字段的校验状态。 */ (field) => {
        handle.form.setFieldError(field as Path<TValues>, undefined);
      },
    );
  }

  /**
   * 滚动到第一个错误字段
   * @param errors 验证错误对象
   */
  scrollToFirstError(errors: FormValues | string) {
    // Handle validation reset after schema updates.
    const firstErrorFieldName =
      typeof errors === 'string' ? errors : Object.keys(errors)[0];

    if (!firstErrorFieldName) {
      return;
    }

    let el = [...document.querySelectorAll<HTMLElement>('[name]')].find(
      /** 字段名只作为属性值比较，避免拼入 CSS 选择器。 */ (element) =>
        element.getAttribute('name') === firstErrorFieldName,
    );

    // 如果通过 name 属性找不到，尝试通过组件引用查找, 正常情况下不会走到这，怕哪天 vee-validate 改了 name 属性有个兜底的
    if (!el) {
      const componentRef = this.getFieldComponentRef(firstErrorFieldName);
      if (
        isValueRecord(componentRef) &&
        componentRef.$el instanceof HTMLElement
      ) {
        el = componentRef.$el;
      }
    }

    if (el) {
      // 滚动到错误字段，添加一些偏移量以确保字段完全可见
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }
  }

  /**
   * 设置表单禁用状态：用于非 Modal 中使用 Form 时，需要 Form 自己控制禁用状态
   * @param disabled 是否禁用
   */
  setDisabled(disabled: boolean) {
    this.setState((prev) => ({
      ...prev,
      commonConfig: { ...prev.commonConfig, disabled },
    }));
  }

  /**
   * 写入单个字段的值。
   * 与 `setValues` 不同，这里不限制字段名是否已存在于 schema，用于联动场景直接改写依赖字段。
   * @param field 目标字段名。
   * @param value 字段的新值，由控件自身的值类型解释。
   * @param shouldValidate 写入后是否立即对该字段重新校验。
   * @throws {Error} 表单未挂载或挂载已失效。
   */
  async setFieldValue(field: string, value: unknown, shouldValidate?: boolean) {
    const handle = await this.getFormHandle();
    this.assertMountedForm(handle);
    // 字段名与取值都来自调用方的动态 schema，类型系统无法在此证明其属于 TValues 的某条路径。
    handle.form.setFieldValue(
      field as Path<TValues>,
      value as PathValue<TValues, Path<TValues>>,
      shouldValidate,
    );
  }

  /**
   * 记录最近一次提交所使用的表单值。
   * 读取时先 `toRaw`，避免把响应式代理存入实例状态而在后续读取时触发依赖收集。
   * @param values 本次提交捕获的表单值；传 null 表示清空记录。
   */
  setLatestSubmissionValues(values: null | TValues) {
    this.latestSubmissionValues = this.toValueType({ ...toRaw(values) });
  }

  /**
   * 设置表单提交按钮的加载状态：用于非 Modal 中使用 Form 时，需要 Form 自己控制 loading 状态
   * @param loading 是否加载中
   */
  setLoading(loading: boolean) {
    this.setState((prev) => ({
      ...prev,
      submitButtonOptions: { ...prev.submitButtonOptions, loading },
    }));
  }

  /**
   * 更新表单状态。
   * 数组类配置（schema、按钮 options）按整体替换处理，其余键深合并，
   * 因此调用方只写需要覆盖的字段即可，不必回传完整配置。
   * @param stateOrFn 状态增量，或基于当前状态计算增量的函数。
   */
  setState(
    stateOrFn:
      | Partial<TypedFormProps<TValues, TComp>>
      | StateUpdater<TValues, TComp>,
  ) {
    if (isFunction(stateOrFn)) {
      this.store.setState((prev) => {
        return mergeWithArrayOverride(stateOrFn(prev), prev);
      });
    } else {
      this.store.setState((prev) => mergeWithArrayOverride(stateOrFn, prev));
    }
  }

  /**
   * 设置表单值
   * @param fields 要写入的字段值，形状由调用方声明的值类型决定。
   * @param filterFields 过滤不在schema中定义的字段 默认为true
   * @param shouldValidate 写入后是否立即重新校验，默认不校验。
   * @throws {Error} 表单未挂载或挂载已失效。
   */
  async setValues(
    fields: TValues,
    filterFields: boolean = true,
    shouldValidate: boolean = false,
  ) {
    const handle = await this.getFormHandle();
    this.assertMountedForm(handle);
    const form = handle.form;
    if (!filterFields) {
      form.setValues(this.toSetValuesArg(fields), shouldValidate);
      return;
    }

    /**
     * 合并算法有待改进，目前的算法不支持object类型的值。
     * antd的日期时间相关组件的值类型为dayjs对象
     * element-plus的日期时间相关组件的值类型可能为Date对象
     * 以上两种类型需要排除深度合并
     */
    const filteredFields = this.mergeKnownFields(
      form.values,
      this.toValueType(fields),
    );
    form.setValues(this.toSetValuesArg(filteredFields), shouldValidate);
  }

  /** 校验并读取当前表单或组合表单。
   * @param needMerge 是否将多个表单字段合并为单个对象。
   * @returns 全部有效时的值；任一校验失败则返回 undefined。
   */
  async submitAllForm(
    needMerge = true,
  ): Promise<TValues | TValues[] | undefined> {
    const merged = await this.collectAll(
      [
        /** 未调用 merge 时组合只有自身，读取能力也只登记自己。 */ () =>
          this.collectOne(this),
      ],
      needMerge,
    );
    if (merged === undefined) return undefined;
    if (Array.isArray(merged))
      return merged.map(
        /** 逐个恢复为调用方声明的值类型，保持与合并顺序一致。 */ (value) =>
          this.toValueType(value),
      );
    return this.toValueType(merged);
  }

  /** 验证表单并提交通过规则后的值，不把无效或旧实例数据交给业务。
   * @param e 可选原生提交事件。
   * @returns 提交成功的值；校验不通过时返回 undefined 且不调用 `state.handleSubmit`。
   * @throws {Error} 挂载已失效或业务提交失败。
   */
  async submitForm(e?: Event): Promise<TValues | undefined> {
    e?.preventDefault();
    e?.stopPropagation();
    const handle = await this.getFormHandle();
    this.assertMountedForm(handle);
    // 提交回调必须在提交瞬间读取：提交期间页面可能已经更新了回调定义。
    const submit = this.state?.handleSubmit;
    return handle.form.handleSubmit(
      /** 只有全部规则通过才会执行本回调，非法值不会进入业务。 */
      async (validated) => {
        // 校验等待期间可能已经卸载重挂：旧提交不得进入新挂载的业务回调。
        this.assertMountedForm(handle);
        const values = this.handleRangeTimeValue(validated);
        await submit?.(this.toValueType(values));
        // 业务回调等待期间同样可能卸载重挂：旧提交不得把旧值写回新挂载的提交快照。
        this.assertMountedForm(handle);
        this.setLatestSubmissionValues(this.toValueType(values));
        return this.toValueType(values);
      },
      /** 校验失败只做定位提示，绝不调用业务提交回调。 */
      (invalid) => {
        this.assertMountedForm(handle);
        if (this.state?.scrollToFirstError)
          this.scrollToFirstError(invalid.errors);
      },
    )();
  }

  /**
   * 结束实例并拒绝挂载等待，清理后的旧异步动作不能进入下次挂载。
   * 容器引用保持不变、只清空成员，解构持有 `form` 的消费方在卸载后读到的是“无上下文”，
   * 而不是上一次挂载遗留的失效实例；之后重新挂载会再次写入成员。
   * 卸载不取消已经开始的外部请求，在途的校验与提交由挂载代次在各自的异步边界后判定失效。
   */
  unmount() {
    // 未挂载时容器内没有成员，取用成员会在调用时抛 TypeError，
    // 因此本次是否真的持有上下文以 isMounted 判定，而不是以容器是否存在判定。
    const form = this.isMounted ? this.form : undefined;
    this.lifecycle++;
    this.wasUnmounted = true;
    this.latestSubmissionValues = null;
    this.isMounted = false;
    this.componentRefMap.clear();
    this.stateHandler.reset();
    // 必须先重置再清空容器：清空后容器里不再有 resetForm 可调用。
    form?.resetForm();
    this.clearFormActions();
  }

  /**
   * 按字段名合并更新既有 schema，不新增字段。
   * 数组中任何一项缺少 `fieldName` 都直接放弃本次更新并打印错误：
   * 缺字段名无法定位合并目标，静默部分更新会让 schema 处于半新半旧的状态。
   * @param schema 待合并的表单项局部定义，每项都必须带 `fieldName`。
   */
  updateSchema(schema: Partial<FormSchema<TComp>>[]) {
    const updated: Partial<FormSchema<TComp>>[] = [...schema];
    const hasField = updated.every(
      (item) => Reflect.has(item, 'fieldName') && item.fieldName,
    );

    if (!hasField) {
      console.error(
        'All items in the schema array must have a valid `fieldName` property to be updated',
      );
      return;
    }
    const currentSchema: FormSchema<TComp>[] = [...(this.state?.schema ?? [])];

    const updatedMap = new Map<string, Partial<FormSchema<TComp>>>();

    updated.forEach(
      /** 同名字段后出现者覆盖先出现者，与调用方书写顺序一致。 */ (item) => {
        if (item.fieldName) {
          updatedMap.set(item.fieldName, item);
        }
      },
    );

    currentSchema.forEach(
      /** 只替换 schema 中已存在的字段，未命中的更新项被忽略。 */ (
        schema,
        index,
      ) => {
        const updatedData = updatedMap.get(schema.fieldName);
        if (updatedData) {
          currentSchema[index] = this.mergeSchemaItem(schema, updatedData);
        }
      },
    );
    this.setState({ schema: currentSchema });
  }

  /**
   * 校验全部字段。
   * 校验失败时按配置滚动定位到第一个错误字段，便于用户直接修正。
   * @param opts vee-validate 的校验选项，例如只校验指定字段或跳过未触碰字段。
   * @returns vee-validate 的校验结果，含 `valid` 与各字段错误信息。
   * @throws {Error} 表单未挂载或挂载已失效。
   */
  async validate(opts?: Partial<ValidationOptions>) {
    const handle = await this.getFormHandle();
    this.assertMountedForm(handle);

    const validateResult = await handle.form.validate(opts);
    // 校验等待期间可能已经卸载重挂：过期错误不得滚动定位到新挂载的表单上。
    this.assertMountedForm(handle);

    if (Object.keys(validateResult?.errors ?? {}).length > 0) {
      console.error('validate error', validateResult?.errors);

      if (this.state?.scrollToFirstError) {
        this.scrollToFirstError(validateResult.errors);
      }
    }
    return validateResult;
  }

  /**
   * 通过统一提交入口校验一次，避免校验结果与另一次提交脱节。
   * @returns 提交成功的表单值；校验不通过时返回 undefined。
   */
  async validateAndSubmitForm() {
    return this.submitForm();
  }

  /**
   * 校验单个字段。
   * 失败时按配置滚动定位到该字段，与 `validate` 定位第一个错误字段的行为一致。
   * @param fieldName 待校验的字段名。
   * @param opts vee-validate 的校验选项，例如是否强制重新校验。
   * @returns 该字段的校验结果，含是否通过与错误信息。
   * @throws {Error} 表单未挂载或挂载已失效。
   */
  async validateField(fieldName: string, opts?: Partial<ValidationOptions>) {
    const handle = await this.getFormHandle();
    this.assertMountedForm(handle);
    const validateResult = await handle.form.validateField(
      fieldName as Path<TValues>,
      opts,
    );
    // 校验等待期间可能已经卸载重挂：过期错误不得滚动定位到新挂载的表单上。
    this.assertMountedForm(handle);

    if (Object.keys(validateResult?.errors ?? {}).length > 0) {
      console.error('validate error', validateResult?.errors);

      if (this.state?.scrollToFirstError) {
        this.scrollToFirstError(fieldName);
      }
    }
    return validateResult;
  }

  /** 在异步边界后确认仍是操作开始时的那一次挂载。
   * 容器引用跨卸载重挂保持不变，只比较引用与 `isMounted` 会让旧结果在新挂载上生效，
   * 因此这里同时比较挂载代次：卸载重挂后旧句柄的代次不再等于当前代次。
   * @param handle 操作开始时捕获的挂载句柄。
   * @throws {Error} 表单已卸载，或期间发生过卸载重挂导致挂载代次变化。
   */
  private assertMountedForm(handle: MountedFormHandle<TValues>) {
    if (!this.isMounted || this.mountGeneration !== handle.generation) {
      throw new Error('表单挂载已失效');
    }
  }

  /**
   * 逐个清空 `form` 容器里由本次挂载复制进来的上下文成员。
   * 容器引用必须保留（解构方长期持有该引用），因此不能整体替换或删除属性本身；
   * 清空后挂载前、卸载后的读取语义一致，也避免把已销毁实例的 vee-validate 上下文留在容器里。
   */
  private clearFormActions() {
    for (const key of Object.keys(this.form)) {
      Reflect.deleteProperty(this.form, key);
    }
  }

  /**
   * 依次执行全部成员的读取闭包，任一成员失败即整体无效。
   * 组合提交必须整体成功，因此这里不做部分成功：任一成员校验不通过都返回 undefined。
   * @param readers 组合成员登记的读取闭包，调用顺序即合并顺序。
   * @param needMerge 是否合并为单个对象；为 false 时返回各成员值的数组。
   * @returns 全部成员有效时的值；任一成员无效时返回 undefined。
   */
  private async collectAll(
    readers: FormCollector[],
    needMerge: boolean,
  ): Promise<FormValues | FormValues[] | undefined> {
    const results = await Promise.all(
      readers.map(
        /** 闭包已固定所属实例，这里只负责并发触发各自的校验与读取。 */ (
          read,
        ) => read(),
      ),
    );
    if (results.includes(/** 任一成员失败使聚合结果无效。 */ undefined)) return;
    const valid: FormValues[] = [];
    for (const result of results) if (result) valid.push(result);
    if (!needMerge) return valid;
    // 按登记顺序覆盖同名字段，后登记的成员覆盖先登记的成员。
    const merged: FormValues = {};
    for (const values of valid) Object.assign(merged, values);
    return merged;
  }

  /** 校验并读取单个成员，校验不通过时返回 undefined，绝不返回部分结果。 */
  private async collectOne<
    R extends FormValuesConstraint,
    C extends BaseFormComponentType,
  >(api: FormApi<R, C>): Promise<FormValues | undefined> {
    const result = await api.validate();
    return result.valid ? this.toValueType(await api.getValues()) : undefined;
  }

  /** 只允许日期格式化器声明的类型进入实际格式化。
   * @param value 区间的一端。
   * @param format 日期输出格式。
   * @returns 格式化后的日期。
   * @throws {TypeError} 日期值类型不受支持。
   */
  private formatRangeDate(value: unknown, format: string) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      isDate(value) ||
      isDayjsObject(value)
    )
      return formatDate(value, format);
    throw new TypeError('时间区间值必须为日期、时间戳或文本');
  }

  /** 等待首次挂载并返回本次挂载的上下文句柄；销毁前的等待不能借用后续挂载实例。
   * 容器始终存在，因此“没有上下文”只由挂载标记与卸载代次判定，而不是由容器是否为空判定；
   * 返回前记录当前挂载代次，调用方据此在每个异步边界后识别卸载重挂。
   * @returns 当前挂载的 vee-validate 表单上下文与本次挂载的代次标识。
   * @throws {Error} 表单已销毁、等待被取消或挂载代次已经变化。
   */
  private async getFormHandle(): Promise<MountedFormHandle<TValues>> {
    const lifecycle = this.lifecycle;
    if (!this.isMounted) {
      if (this.wasUnmounted) throw new Error('表单已卸载');
      await this.stateHandler.waitForCondition();
    }
    if (!this.isMounted || lifecycle !== this.lifecycle) {
      throw new Error('表单挂载已失效');
    }
    // 检查与取值之间没有 await，读到的容器与代次一定属于同一次挂载。
    return { form: this.form, generation: this.mountGeneration };
  }

  /**
   * 按 `arrayToStringFields` 配置把数组字段转成字符串，或把字符串字段拆回数组。
   * 转换在传入的值对象上就地完成，调用方读到的是同一份数据的转换结果。
   * @param originValues 待转换的表单值，会被就地改写。
   */
  private handleMultiFields = (originValues: FormValues) => {
    const arrayToStringFields = this.state?.arrayToStringFields;
    if (!arrayToStringFields || !Array.isArray(arrayToStringFields)) {
      return;
    }

    const processFields = (fields: string[], separator: string = ',') => {
      this.processFields(fields, separator, originValues, (value, sep) => {
        if (Array.isArray(value)) {
          return value.join(sep);
        } else if (typeof value === 'string') {
          // 处理空字符串的情况
          if (value === '') {
            return [];
          }
          // 处理复杂分隔符的情况
          const escapedSeparator = sep.replaceAll(
            /[.*+?^${}()|[\]\\]/g,
            String.raw`\$&`,
          );
          return value.split(new RegExp(escapedSeparator));
        } else {
          return value;
        }
      });
    };

    // 处理简单数组格式 ['field1', 'field2', ';'] 或 ['field1', 'field2']
    if (arrayToStringFields.every((item) => typeof item === 'string')) {
      const lastItem =
        arrayToStringFields[arrayToStringFields.length - 1] || '';
      const fields =
        lastItem.length === 1
          ? arrayToStringFields.slice(0, -1)
          : arrayToStringFields;
      const separator = lastItem.length === 1 ? lastItem : ',';
      processFields(fields, separator);
      return;
    }

    // 处理嵌套数组格式 [['field1'], ';']
    arrayToStringFields.forEach((fieldConfig) => {
      if (Array.isArray(fieldConfig)) {
        const [fields, separator = ','] = fieldConfig;
        // 根据类型定义，fields 应该始终是字符串数组
        if (!Array.isArray(fields)) {
          console.warn(
            `Invalid field configuration: fields should be an array of strings, got ${typeof fields}`,
          );
          return;
        }
        processFields(fields, separator);
      }
    });
  };

  /**
   * 展开时间区间字段，并把数组字段按配置转换后再交给业务。
   * 区间字段处理后会被删除：它只是输入形态，输出形态是开始键与结束键两个字段。
   * @param originValues 原始表单值，不会被修改。
   * @returns 展开区间并完成数组转换后的新值对象。
   */
  private handleRangeTimeValue = (originValues: FormValues) => {
    const values = { ...originValues };
    const fieldMappingTime = this.state?.fieldMappingTime;

    this.handleMultiFields(values);
    if (!fieldMappingTime || !Array.isArray(fieldMappingTime)) {
      return values;
    }

    fieldMappingTime.forEach(
      /**
       * 把一个区间字段展开为开始与结束两个字段。
       * 值为 null 时只清掉残留的展开键，区间字段本身已被用户清空。
       * @param entry 区间字段声明：字段名、展开后的起止键与格式化配置。
       * @throws {TypeError} 区间字段的值不是长度为 2 的数组，说明控件未按区间模式渲染。
       */
      (entry) => {
        const [field, [startTimeKey, endTimeKey], format = 'YYYY-MM-DD'] =
          entry;
        if (startTimeKey && endTimeKey && values[field] === null) {
          Reflect.deleteProperty(values, startTimeKey);
          Reflect.deleteProperty(values, endTimeKey);
          // delete values[startTimeKey];
          // delete values[endTimeKey];
        }

        if (!values[field]) {
          Reflect.deleteProperty(values, field);
          // delete values[field];
          return;
        }

        const range = values[field];
        if (!Array.isArray(range) || range.length !== 2)
          throw new TypeError(`时间区间字段 ${field} 必须包含两个值`);
        const [startTime, endTime]: unknown[] = range;
        if (format === null) {
          values[startTimeKey] = startTime;
          values[endTimeKey] = endTime;
        } else if (isFunction(format)) {
          values[startTimeKey] = format(startTime, startTimeKey);
          values[endTimeKey] = format(endTime, endTimeKey);
        } else {
          const [startTimeFormat, endTimeFormat] = Array.isArray(format)
            ? format
            : [format, format];

          values[startTimeKey] = startTime
            ? this.formatRangeDate(startTime, startTimeFormat)
            : undefined;
          values[endTimeKey] = endTime
            ? this.formatRangeDate(endTime, endTimeFormat)
            : undefined;
        }
        // delete values[field];
        Reflect.deleteProperty(values, field);
      },
    );
    return values;
  };

  /** 只合并当前表单已声明的键，日期和数组作为完整字段值替换。
   * @param current 当前字段树。
   * @param incoming 待设置的动态值。
   * @returns 不包含未声明键且不修改调用者数据的新对象。
   */
  private mergeKnownFields(
    current: FormValues,
    incoming: FormValues,
  ): FormValues {
    const merged = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      if (!Object.hasOwn(current, key)) continue;
      const original = current[key];
      merged[key] =
        isValueRecord(original) &&
        isValueRecord(value) &&
        !isDate(original) &&
        !isDayjsObject(original)
          ? this.mergeKnownFields(original, value)
          : value;
    }
    return merged;
  }

  /**
   * 把局部表单项更新合并到既有定义。
   * 合并语义与历史一致：数组类配置整体替换，其余键深合并。
   * @param base 既有表单项定义。
   * @param patch 本次更新，只包含需要覆盖的键。
   * @returns 合并后的新对象，不修改入参。
   */
  private mergeSchemaItem(
    base: FormSchema<TComp>,
    patch: Partial<FormSchema<TComp>>,
  ): FormSchema<TComp> {
    // 先以既有定义建立合法表单项，再把合并结果覆盖上去：
    // defu 对 optional 字段会推导出 null 口径，直接写回 store 会得到非法的表单项。
    return Object.assign({ ...base }, mergeWithArrayOverride(patch, base));
  }

  /**
   * 对指定字段逐一应用值转换。
   * 值为空时跳过而不是写入空值：未填写的字段不应被转换成空数组或空字符串。
   * @param fields 需要处理的字段名列表。
   * @param separator 字符串与数组之间的分隔符。
   * @param originValues 被就地改写的表单值对象。
   * @param transformFn 单个字段值的转换函数，接收当前值与分隔符。
   */
  private processFields = (
    fields: string[],
    separator: string,
    originValues: FormValues,
    transformFn: FieldValueTransform,
  ) => {
    fields.forEach((field) => {
      const value = originValues[field];
      if (value === undefined || value === null) {
        return;
      }
      originValues[field] = transformFn(value, separator);
    });
  };

  /**
   * 交给 vee-validate 的 setValues 入参。
   * 它的形参类型是 `TValues` 的部分深层视图，而调用方传入的是同一份完整值，这里只做入参口径转换。
   */
  private toSetValuesArg(raw: FormValues): SetValuesArg<TValues> {
    return raw as SetValuesArg<TValues>;
  }

  /**
   * 把按动态键处理的字段树还原为调用方声明的值类型。
   * 数据始终来自同一个 `FormContext<TValues>`，此处只恢复被收窄的泛型，不做结构改写。
   * @param raw 已完成时间区间与数组字段处理的动态键对象。
   * @returns 与 `TValues` 同一对象的视图。
   */
  private toValueType(raw: FormValues): TValues {
    return raw as TValues;
  }

  /** 删除 Schema 时清理对应字段值，保持表单与声明一致。 */
  private updateState() {
    const currentSchema = this.state?.schema ?? [];
    const prevSchema = this.prevState?.schema ?? [];
    // 进行了删除schema操作
    if (currentSchema.length < prevSchema.length) {
      const currentFields = new Set(
        currentSchema.map((item) => item.fieldName),
      );
      const deletedSchema = prevSchema.filter(
        (item) => !currentFields.has(item.fieldName),
      );
      for (const schema of deletedSchema) {
        // 容器在未挂载或已卸载时是空的，这里用可选调用跳过而不是崩溃；
        // 挂载中则与既有行为一致，直接清理被删除字段的值。
        this.form.setFieldValue?.(
          schema.fieldName as Path<TValues>,
          undefined as PathValue<TValues, Path<TValues>>,
        );
      }
    }
  }
}
