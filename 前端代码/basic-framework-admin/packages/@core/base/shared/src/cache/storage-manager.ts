/**
 * 本地存储封装：给 localStorage 与 sessionStorage 统一加前缀并做 JSON 序列化，
 * 支持毫秒级过期时间，读到过期项或解析失败时删除该项并返回默认值。
 * 供偏好设置等模块保存小体积非敏感数据，不做加密与跨标签页同步；
 * 需要与服务端一致或数据量大的场景应改用状态层或后端接口。
 */
type StorageType = 'localStorage' | 'sessionStorage';

/** 构造参数：`prefix` 决定键名命名空间，`storageType` 决定落到哪种 Web Storage。 */
interface StorageManagerOptions {
  prefix?: string;
  storageType?: StorageType;
}

/** 实际落盘结构：`value` 为业务数据，`expiry` 为绝对过期毫秒时间戳，省略表示永不过期。 */
interface StorageItem<T> {
  expiry?: number;
  value: T;
}

/**
 * 带前缀与过期能力的本地存储读写类，实例固定绑定 localStorage 或 sessionStorage 之一。
 * 只做 JSON 序列化与过期清理，不加密、不跨标签页同步，也不校验写入内容。
 */
class StorageManager {
  private prefix: string;
  private storage: Storage;

  /**
   * 绑定存储介质并记录键名前缀。
   * @param options - 构造参数；解构出的 `prefix` 省略时为空串（键名不加命名空间），
   *   `storageType` 省略时用 localStorage，传 sessionStorage 则随标签页关闭失效。
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
   * 清除所有带前缀的存储项
   */
  clear(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(this.prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => this.storage.removeItem(key));
  }

  /**
   * 清除所有过期的存储项
   */
  clearExpiredItems(): void {
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(this.prefix)) {
        const shortKey = key.replace(this.prefix, '');
        this.getItem(shortKey); // 调用 getItem 方法检查并移除过期项
      }
    }
  }

  /**
   * 获取存储项
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
   * 移除存储项
   * @param key 键
   */
  removeItem(key: string): void {
    const fullKey = this.getFullKey(key);
    this.storage.removeItem(fullKey);
  }

  /**
   * 设置存储项
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
   * 获取完整的存储键
   * @param key 原始键
   * @returns 带前缀的完整键
   */
  private getFullKey(key: string): string {
    return `${this.prefix}-${key}`;
  }
}

export { StorageManager };
