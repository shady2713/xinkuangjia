/**
 * 标签页类型：把 vue-router 的路由定位结果直接当作标签页数据。
 * TabDefinition 补一个可选 key，作为标签页去重与定位的标识。
 * 增删、缓存与排序由标签栏状态模块负责，本文件不含逻辑。
 */
import type { RouteLocationNormalized } from 'vue-router';

/**
 * 标签页数据：直接复用 vue-router 的定位结果，再补一个用于去重与定位的可选 key。
 * 不含增删、缓存与排序逻辑，这些由标签栏状态模块负责。
 */
export interface TabDefinition extends RouteLocationNormalized {
  /**
   * 标签页的key
   */
  key?: string;
}
