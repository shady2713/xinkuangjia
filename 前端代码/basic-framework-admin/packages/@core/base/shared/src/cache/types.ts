/**
 * 存储契约声明：约定同步缓存应具备的读写、按键取键与长度查询方法，
 * 过期时间以分钟为单位，取值允许为空。
 * 当前 StorageManager 使用自己的本地类型，本文件是替换实现的预留契约，
 * 未被 shared 包的构建入口引用。
 */
type StorageType = 'localStorage' | 'sessionStorage';

/** 缓存条目：`data` 为业务数据，`expiry` 为绝对过期时间点（本契约不限定单位），null 表示不设过期。 */
interface StorageValue<T> {
  data: T;
  expiry: null | number;
}

/** 同步缓存契约：命中、过期与序列化策略由实现决定，方法名与 Storage 对齐以便替换。 */
interface IStorageCache {
  /** 清空该实现管辖的全部缓存项，不区分前缀与归属。 */
  clear(): void;
  /**
   * 读取缓存项。
   * @param key - 缓存键。
   * @returns 命中且未过期时返回原值，缺失或已过期时返回 null。
   */
  getItem<T>(key: string): null | T;
  /**
   * 按存储序号取键名，用于遍历。
   * @param index - 从 0 开始的序号。
   * @returns 该位置的键名，越界时为 null。
   */
  key(index: number): null | string;
  /**
   * 统计缓存项数量。
   * @returns 当前实现中的键总数。
   */
  length(): number;
  /**
   * 删除单个缓存项。
   * @param key - 缓存键；不存在时按静默忽略处理。
   */
  removeItem(key: string): void;
  /**
   * 写入缓存项，同键覆盖。
   * @param key - 缓存键。
   * @param value - 待写入的值，需可被实现序列化。
   * @param expiryInMinutes - 过期时间，单位分钟；省略表示永不过期。
   */
  setItem<T>(key: string, value: T, expiryInMinutes?: number): void;
}

export type { IStorageCache, StorageType, StorageValue };
