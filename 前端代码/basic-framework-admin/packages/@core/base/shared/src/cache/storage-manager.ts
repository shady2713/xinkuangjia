/** 浏览器本地存储管理器，统一命名空间前缀隔离、TTL 过期淘汰与异常兜底。 */
type StorageType = 'localStorage' | 'sessionStorage';

interface StorageManagerOptions {
  /** 命名空间前缀，用于隔离不同应用或租户的缓存键。 */
  prefix?: string;
  /** 底层 Web Storage 类型，默认使用 `localStorage`。 */
  storageType?: StorageType;
}

interface StorageItem<T> {
  /** 过期时间戳（毫秒），未设置表示永不过期。 */
  expiry?: number;
  /** 序列化保存的业务值。 */
  value: T;
}

/** 封装命名空间前缀与 TTL 淘汰策略的 Web Storage 管理类。 */
class StorageManager {
  private prefix: string;
  private storage: Storage;

  /**
   * 创建本地存储管理器实例。
   *
   * @param options 命名空间与存储介质选项
   * @param options.prefix 命名空间前缀
   * @param options.storageType 底层 Web Storage 类型
   */
  constructor({
    prefix = '',
    storageType = 'localStorage',
  }: StorageManagerOptions = {}) {
    this.prefix = prefix;
    this.storage =
      storageType === 'localStorage'
        ? window.localStorage
        : window.sessionStorage;
  }

  /**
   * 清除当前命名空间前缀下的所有存储项。
   */
  clear(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && this.extractShortKey(key) !== null) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => this.storage.removeItem(key));
  }

  /**
   * 主动扫描并移除当前命名空间下所有已过期的存储项。
   */
  clearExpiredItems(): void {
    // 先收集短键快照再读取删除，避免遍历过程中 removeItem 导致底层索引位移漏扫
    const keysToInspect: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key) {
        continue;
      }
      const shortKey = this.extractShortKey(key);
      if (shortKey !== null) {
        keysToInspect.push(shortKey);
      }
    }
    keysToInspect.forEach((shortKey) => this.getItem(shortKey));
  }

  /**
   * 获取存储项；若不存在、已过期或 JSON 解析损坏则返回默认值并清理损坏项。
   *
   * @param key 键
   * @param defaultValue 当项不存在或已过期时返回的默认值
   * @returns 值，如果项已过期或解析错误则返回默认值
   */
  getItem<T>(key: string, defaultValue: null | T = null): null | T {
    const fullKey = this.getFullKey(key);
    const itemStr = this.storage.getItem(fullKey);
    if (!itemStr) {
      return defaultValue;
    }

    try {
      const item: StorageItem<T> = JSON.parse(itemStr);
      if (item.expiry && Date.now() > item.expiry) {
        this.storage.removeItem(fullKey);
        return defaultValue;
      }
      return item.value;
    } catch (error) {
      console.error(`Error parsing item with key "${fullKey}":`, error);
      this.storage.removeItem(fullKey); // 如果解析失败，删除该项
      return defaultValue;
    }
  }

  /**
   * 移除存储项。
   *
   * @param key 键
   */
  removeItem(key: string): void {
    const fullKey = this.getFullKey(key);
    this.storage.removeItem(fullKey);
  }

  /**
   * 设置存储项并可选附带过期时间。
   *
   * @param key 键
   * @param value 值
   * @param ttl 存活时间（毫秒）
   */
  setItem<T>(key: string, value: T, ttl?: number): void {
    const fullKey = this.getFullKey(key);
    const expiry = ttl ? Date.now() + ttl : undefined;
    const item: StorageItem<T> = { expiry, value };
    try {
      this.storage.setItem(fullKey, JSON.stringify(item));
    } catch (error) {
      console.error(`Error setting item with key "${fullKey}":`, error);
    }
  }

  /**
   * 提取属于当前命名空间边界的短键；不匹配当前前缀边界时返回 null。
   *
   * @param fullKey 底层存储中的完整键名
   * @returns 去除规范前缀后的短键，或 null
   */
  private extractShortKey(fullKey: string): null | string {
    const keyPrefix = this.getKeyPrefix();
    if (keyPrefix && !fullKey.startsWith(keyPrefix)) {
      return null;
    }
    return fullKey.slice(keyPrefix.length);
  }

  /**
   * 获取完整的存储键。
   *
   * @param key 原始键
   * @returns 带前缀分隔边界的完整键
   */
  private getFullKey(key: string): string {
    return `${this.getKeyPrefix()}${key}`;
  }

  /**
   * 计算写入与遍历共用的规范前缀边界（非空前缀统一以 `-` 结尾），防止 `app` 误伤 `apple-*`。
   *
   * @returns 规范前缀字符串
   */
  private getKeyPrefix(): string {
    if (!this.prefix) {
      return '';
    }
    return this.prefix.endsWith('-') ? this.prefix : `${this.prefix}-`;
  }
}

export { StorageManager };
