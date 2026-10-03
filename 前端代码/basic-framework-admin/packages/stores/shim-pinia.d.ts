/**
 * pinia 热更新兼容声明。
 *
 * pinia 3 自带 acceptHMRUpdate，这里按其官方泛型形状补一次模块声明，
 * 让顶层 store 的 HMR 回调在类型检查下也能通过：store 定义仍要求 StoreDefinition，
 * 热更新上下文按 vite 的 ImportMeta['hot'] 声明，回调参数按未知模块处理。
 * 不使用 any 绕过检查；若将来 pinia 调整签名，这里应随之更新或直接删除。
 */
import type {
  _ActionsTree,
  _GettersTree,
  StateTree,
  StoreDefinition,
} from 'pinia';

declare module 'pinia' {
  export function acceptHMRUpdate<
    Id extends string = string,
    S extends StateTree = StateTree,
    G extends _GettersTree<S> = _GettersTree<S>,
    A = _ActionsTree,
  >(
    initialUseStore: StoreDefinition<Id, S, G, A>,
    hot: ImportMeta['hot'],
  ): (newModule: unknown) => unknown;
}

export { acceptHMRUpdate };
