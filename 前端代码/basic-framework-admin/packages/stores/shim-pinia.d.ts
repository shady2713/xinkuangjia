// Pinia 热更新包内类型垫片。
declare module 'pinia' {
  /** 兼容 Pinia 热更新类型声明。 */
  export function acceptHMRUpdate(
    initialUseStore: any | StoreDefinition,
    hot: any,
  ): (newModule: any) => any;
}

export { acceptHMRUpdate };
