/** 通知列表项的数据契约，字段与后端消息体及跳转配置保持一致。 */
import type { HistoryState, LocationQueryRaw } from 'vue-router';

interface NotificationItem {
  /** 通知唯一标识；缺省时由列表 key 回退到 title */
  id?: number | string;
  avatar: string;
  date: string;
  isRead?: boolean;
  message: string;
  title: string;
  /**
   * 跳转链接，可以是路由路径或完整 URL
   * @example '/dashboard' 或 'https://example.com'
   */
  link?: string;
  /** 内部路由跳转时附带的查询参数，取 vue-router 的原始入参形状 */
  query?: LocationQueryRaw;
  /** 内部路由跳转时附带的 history state，保留原始形状不做转换 */
  state?: HistoryState;
}

export type { NotificationItem };
