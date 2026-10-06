/**
 * 远程图标集数据源：按图标集前缀向 Iconify 接口取回图标名，
 * 拼成 prefix:name 形式供图标选择器分页渲染。
 * 结果写入模块级缓存，进行中的请求也会复用，
 * 因此同一图标集的并发调用只发一次网络请求；
 * 失败时返回空数组并打印错误，不做重试与降级。
 */
import type { Recordable } from '@vben/types';

/**
 * 一个缓存对象，在不刷新页面时，无需重复请求远程接口
 */
export const ICONS_MAP: Recordable<string[]> = {};

/** Iconify 集合接口的响应：图标集前缀、图标总数、标题，以及未分类与分类图标名。 */
interface IconifyResponse {
  prefix: string;
  total: number;
  title: string;
  uncategorized?: string[];
  categories?: Recordable<string[]>;
  aliases?: Recordable<string>;
}

const PENDING_REQUESTS: Recordable<Promise<string[]>> = {};

/**
 * 通过Iconify接口获取图标集数据。
 * 同一时间多个图标选择器同时请求同一个图标集时，实际上只会发起一次请求（所有请求共享同一份结果）。
 * 请求结果会被缓存，刷新页面前同一个图标集不会再次请求
 * @param prefix 图标集名称
 * @returns 图标集中包含的所有图标名称
 */
export async function fetchIconsData(prefix: string): Promise<string[]> {
  if (Reflect.has(ICONS_MAP, prefix) && ICONS_MAP[prefix]) {
    return ICONS_MAP[prefix];
  }
  if (Reflect.has(PENDING_REQUESTS, prefix) && PENDING_REQUESTS[prefix]) {
    return PENDING_REQUESTS[prefix];
  }
  PENDING_REQUESTS[prefix] = (async () => {
    try {
      const controller = new AbortController();
      /** 10 秒超时后中止请求，避免远程接口无响应时一直挂起。 */
      const timeoutId = setTimeout(() => controller.abort(), 1000 * 10);
      /** 拉取图标集并解析为 JSON；响应结构与 IconifyResponse 一致。 */
      const response: IconifyResponse = await fetch(
        `https://api.iconify.design/collection?prefix=${prefix}`,
        { signal: controller.signal },
      ).then((res) => res.json());
      clearTimeout(timeoutId);
      const list = response.uncategorized || [];
      if (response.categories) {
        for (const category in response.categories) {
          list.push(...(response.categories[category] || []));
        }
      }
      ICONS_MAP[prefix] = list.map((v) => `${prefix}:${v}`);
    } catch (error) {
      console.error(`Failed to fetch icons for prefix ${prefix}:`, error);
      return [] as string[];
    }
    return ICONS_MAP[prefix];
  })();
  return PENDING_REQUESTS[prefix];
}
