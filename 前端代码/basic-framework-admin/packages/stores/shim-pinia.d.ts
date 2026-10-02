// Compatibility shim for Pinia typing.
declare module 'pinia' {
  export function acceptHMRUpdate(
    initialUseStore: any | StoreDefinition,
    hot: any,
  ): (newModule: any) => any;
}

export { acceptHMRUpdate };
