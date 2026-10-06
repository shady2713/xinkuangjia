/**
 * 表格 API 层：持有 vxe-grid 实例与表单 API，维护表格状态，对外提供
 * query、reload、加载态、搜索栏开合与状态订阅。
 * 不渲染界面也不取数，挂载与卸载由 VbenVxeGrid 组件驱动。
 */
import type { VxeGridInstance } from 'vxe-table';

import type { ExtendedFormApi } from '@vben-core/form-ui';

import type { VxeGridProps } from './types';

import { toRaw } from 'vue';

import { Store } from '@vben-core/shared/store';
import {
  bindMethods,
  isBoolean,
  isFunction,
  mergeWithArrayOverride,
  StateHandler,
} from '@vben-core/shared/utils';

/**
 * 生成表格状态的默认字段。
 * 必须按行类型参数化，否则默认状态会退化成兜底行类型，与实例自身的行类型不兼容。
 * @returns 只含默认值、不含行数据的初始状态。
 */
function getDefaultState<T extends object>(): VxeGridProps<T> {
  return {
    class: '',
    gridClass: '',
    gridOptions: {},
    gridEvents: {},
    formOptions: undefined,
    showSearchForm: true,
  };
}

/**
 * 表格 API 实例：封装 vxe-grid 的实例引用与内部状态，
 * 对外暴露查询、重载、加载态与状态订阅能力，组件卸载时由 mount/unmount 控制挂载标记。
 * @typeParam T 表格行类型，决定 gridOptions 与 gridEvents 的行数据形状。
 */
export class VxeGridApi<T extends object = Record<string, unknown>> {
  public formApi = {} as ExtendedFormApi;

  // private prevState: null | VxeGridProps = null;
  public grid = {} as VxeGridInstance<T>;
  public state: null | VxeGridProps<T> = null;

  public store: Store<VxeGridProps<T>>;

  private isMounted = false;

  private stateHandler: StateHandler;

  /**
   * 创建表格 API 实例。
   * @param options 表格配置，缺省时只使用默认状态。
   */
  constructor(options: VxeGridProps<T> = {}) {
    const storeState = { ...options };

    const defaultState = getDefaultState<T>();
    this.store = new Store<VxeGridProps<T>>(
      mergeWithArrayOverride(storeState, defaultState),
      {
        /** 状态更新回调：把 store 的最新快照同步到实例的 state，供订阅者读取。 */
        onUpdate: () => {
          // this.prevState = this.state;
          this.state = this.store.state;
        },
      },
    );

    this.state = this.store.state;
    this.stateHandler = new StateHandler();
    bindMethods(this);
  }

  /**
   * 组件挂载后绑定表格实例与表单 API，并解除状态就绪等待。
   * @param instance vxe-grid 实例；为空时保持未挂载状态，不会写入任何引用。
   * @param formApi 搜索表单 API，与表格实例一并保存，供查询条件读取。
   */
  mount(instance: null | VxeGridInstance, formApi: ExtendedFormApi) {
    if (!this.isMounted && instance) {
      this.grid = instance;
      this.formApi = formApi;
      this.stateHandler.setConditionTrue();
      this.isMounted = true;
    }
  }

  /**
   * 触发 vxe-table 自身的 reload 流程，由表格把参数并入当前查询条件。
   * @param params 附加查询条件，键名与 vxe-table 的查询参数约定一致。
   */
  async query(params: Record<string, unknown> = {}) {
    try {
      await this.grid.commitProxy('query', toRaw(params));
    } catch (error) {
      console.error('Error occurred while querying:', error);
    }
  }

  /**
   * 触发 vxe-table 自身的 reload 流程，参数会替换而非并入当前查询条件。
   * @param params 替换后的查询条件，键名与 vxe-table 的查询参数约定一致。
   */
  async reload(params: Record<string, unknown> = {}) {
    try {
      await this.grid.commitProxy('reload', toRaw(params));
    } catch (error) {
      console.error('Error occurred while reloading:', error);
    }
  }

  /**
   * 覆盖式更新 vxe-grid 配置。
   * @param options 要替换的 gridOptions，键名与 vxe-table 的配置项一致。
   */
  setGridOptions(options: Partial<VxeGridProps<T>['gridOptions']>) {
    this.setState({
      gridOptions: options,
    });
  }

  /**
   * 切换 vxe-grid 的加载态。
   * @param isLoading 是否显示加载中。
   */
  setLoading(isLoading: boolean) {
    this.setState({
      gridOptions: {
        loading: isLoading,
      },
    });
  }

  /**
   * 合并式更新内部状态：新值覆盖同名旧字段，未涉及的字段保持原值。
   * @param stateOrFn 新的状态片段，或「接收旧状态并返回片段」的函数。
   */
  // 保持单行：prettier 会把括号内的 JSDoc 上提到括号外，使函数类型的中文说明脱离节点。
  // prettier-ignore
  setState(
    stateOrFn:
      | ((/** 函数形式：接收旧状态，返回要合并进去的状态片段。 */ (prev: VxeGridProps<T>) => Partial<VxeGridProps<T>>))
      | Partial<VxeGridProps<T>>,
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
   * 切换搜索表单的展开状态。
   * @param show 显式指定展开（true）或收起（false）；不传时按当前状态取反。
   * @returns 切换后的展开状态；状态尚未初始化时为 undefined。
   */
  toggleSearchForm(show?: boolean) {
    this.setState({
      showSearchForm: isBoolean(show) ? show : !this.state?.showSearchForm,
    });
    // nextTick(() => {
    //   this.grid.recalculate();
    // });
    return this.state?.showSearchForm;
  }

  /** 组件卸载后标记为未挂载并复位就绪状态，使下一次 mount 能重新绑定实例。 */
  unmount() {
    this.isMounted = false;
    this.stateHandler.reset();
  }
}
