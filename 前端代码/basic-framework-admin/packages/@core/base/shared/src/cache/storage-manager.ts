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
  /**
   * 空前缀时记录本实例写入的原始键和序列化值，供批量操作识别可清理的条目。
   *
   * 实例销毁后记录随之消失，旧条目仍可按原始键读取和移除。若同名键的值
   * 随后改变，清理时会保留新值。完全相同的序列化值无法判别写入方。
   */
  private readonly ownedRawEntries = new Map<string, string>();

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
   * 清除当前命名空间的存储项。空前缀只清理本实例成功写入且值仍一致的键。
   */
  clear(): void {
    if (this.isUnprefixed()) {
      this.getOwnedRawKeys().forEach((key) => this.removeRawItem(key));
      return;
    }
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
   * 主动移除与 `clear` 范围相同的过期条目。空前缀的旧值仍可在按键读取时淘汰。
   */
  clearExpiredItems(): void {
    if (this.isUnprefixed()) {
      this.getOwnedRawKeys().forEach((key) => this.getItem(key));
      return;
    }
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
        this.removeRawItem(fullKey);
        return defaultValue;
      }
      return item.value;
    } catch (error) {
      console.error(`Error parsing item with key "${fullKey}":`, error);
      this.removeRawItem(fullKey); // 如果解析失败，删除该项
      return defaultValue;
    }
  }

  /**
   * 按键移除存储项并清除本实例对该键的写入记录。
   *
   * @param key 键
   */
  removeItem(key: string): void {
    const fullKey = this.getFullKey(key);
    this.removeRawItem(fullKey);
  }

  /**
   * 设置存储项并可选附带过期时间。空前缀时仅在写入成功后登记本实例的批量清理范围。
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
      const serialized = JSON.stringify(item);
      this.storage.setItem(fullKey, serialized);
      if (this.isUnprefixed()) {
        this.ownedRawEntries.set(fullKey, serialized);
      }
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

  /**
   * 筛出本实例写入后仍保持原值的键，并丢弃已移除或被覆盖的记录。
   *
   * @returns 空前缀模式下可批量清理的原始键
   */
  private getOwnedRawKeys(): string[] {
    const ownedKeys: string[] = [];
    this.ownedRawEntries.forEach((serialized, key) => {
      if (this.storage.getItem(key) === serialized) {
        ownedKeys.push(key);
      } else {
        this.ownedRawEntries.delete(key);
      }
    });
    return ownedKeys;
  }

  /**
   * 判断存储项是否使用兼容旧数据的原始键。
   *
   * @returns 空前缀时返回 true
   */
  private isUnprefixed(): boolean {
    return this.getKeyPrefix() === '';
  }

  /**
   * 移除底层条目并清除写入记录。底层移除失败时保留记录。
   *
   * @param fullKey 含命名空间前缀的完整键
   */
  private removeRawItem(fullKey: string): void {
    this.storage.removeItem(fullKey);
    this.ownedRawEntries.delete(fullKey);
  }
}

export { StorageManager };
