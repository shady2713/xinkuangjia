/**
 * 状态层统一出口：聚合 ./modules 下的业务 store 与 ./setup 的安装、重置能力，
 * 并转发 pinia 的 defineStore、storeToRefs，让上层只依赖本包。
 * 这里只做再导出，不承载任何 store 实现。
 */
export * from './modules';
export * from './setup';
export { defineStore, storeToRefs } from 'pinia';
