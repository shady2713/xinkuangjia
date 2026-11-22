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

/**
 * 按底层 Storage 记录每个原始键的最后写入实例，以识别多个实例写入相同值的情况。
 * 原生 Storage API 或其他页面上下文的写入不会登记，批量清理会比较现值。
 * 外部写入完全相同的字节时，无法区分写入来源。成功移除条目或同名带前缀写入会结束原始键的归属。
 */
const rawKeyWriters = new WeakMap<Storage, Map<string, symbol>>();

/**
 * 在无 window 或浏览器禁用 Web Storage 时提供进程内降级实现，避免模块初始化即崩溃。
 *
 * @returns 符合标准 Storage 接口的内存存储对象
 */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    /** 清空内存存储中的全部键值。 */
    clear() {
      store.clear();
    },
    /**
     * 按键读取内存存储值。
     *
     * @param key 存储键名
     * @returns 对应的字符串值，不存在时返回 null
     */
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    /**
     * 按序号读取当前存储的键名。
     *
     * @param index 键序号
     * @returns 对应位置的键名，越界时返回 null
     */
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    /**
     * 获取当前内存存储中的条目数量。
     *
     * @returns 条目总数
     */
    get length() {
      return store.size;
    },
    /**
     * 按键移除内存存储条目。
     *
     * @param key 待移除的存储键名
     */
    removeItem(key: string) {
      store.delete(key);
    },
    /**
     * 写入或覆盖内存存储条目。
     *
     * @param key 存储键名
     * @param value 字符串化的存储内容
     */
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

/**
 * 安全解析底层 Web Storage；SSR 或受限上下文抛出 SecurityError 时降级为内存存储。
 *
 * @param storageType 目标存储类型
 * @returns 可用的 Storage 实例
 */
function resolveStorage(storageType: StorageType): Storage {
  if (typeof window === 'undefined') {
    return createMemoryStorage();
  }
  try {
    return storageType === 'localStorage'
      ? window.localStorage
      : window.sessionStorage;
  } catch {
    return createMemoryStorage();
  }
}

/** 封装命名空间前缀与 TTL 淘汰策略的 Web Storage 管理类。 */
class StorageManager {
  /**
   * 空前缀时记录本实例写入的原始键和序列化值，供批量操作识别可清理的条目。
   *
   * 实例销毁后记录随之消失，旧条目仍可按原始键读取和移除。若同名键的值
   * 随后改变，清理时会保留新值。完全相同的外部序列化值无法判别写入方。
   */
  private readonly ownedRawEntries = new Map<string, string>();

  private prefix: string;
  private storage: Storage;

  /**
   * 每个实例用独立标识登记自己写入的原始键。
   */
  private readonly writerId = Symbol('StorageManager raw key writer');

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
    this.storage = resolveStorage(storageType);
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
    // 成功移除后也结束该键的原始键归属。
    keysToRemove.forEach((key) => this.removeRawItem(key));
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
      const parsed: unknown = JSON.parse(itemStr);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        !Object.prototype.hasOwnProperty.call(parsed, 'value')
      ) {
        this.removeRawItem(fullKey);
        return defaultValue;
      }
      const item = parsed as StorageItem<T>;
      if (typeof item.expiry === 'number' && Date.now() > item.expiry) {
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
    const expiry = typeof ttl === 'number' ? Date.now() + ttl : undefined;
    const item: StorageItem<T> = { expiry, value };
    try {
      const serialized = JSON.stringify(item);
      this.storage.setItem(fullKey, serialized);
      if (this.isUnprefixed()) {
        this.ownedRawEntries.set(fullKey, serialized);
        this.getRawKeyWriters().set(fullKey, this.writerId);
      } else {
        // 带前缀写入成功后，同名原始键不再归空前缀实例所有。
        rawKeyWriters.get(this.storage)?.delete(fullKey);
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
   * 批量清理要求当前实例仍是最后写入实例，且存储字节与写入记录相符。
   *
   * @returns 空前缀模式下可批量清理的原始键
   */
  private getOwnedRawKeys(): string[] {
    const ownedKeys: string[] = [];
    const writers = rawKeyWriters.get(this.storage);
    this.ownedRawEntries.forEach((serialized, key) => {
      if (
        writers?.get(key) === this.writerId &&
        this.storage.getItem(key) === serialized
      ) {
        ownedKeys.push(key);
      } else {
        this.ownedRawEntries.delete(key);
      }
    });
    return ownedKeys;
  }

  /**
   * 读取底层 Storage 的最后写入记录，首次写入时创建。
   *
   * @returns 从原始键到最后写入实例标识的映射
   */
  private getRawKeyWriters(): Map<string, symbol> {
    let writers = rawKeyWriters.get(this.storage);
    if (!writers) {
      writers = new Map<string, symbol>();
      rawKeyWriters.set(this.storage, writers);
    }
    return writers;
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
    // 成功移除后清除底层 Storage 中该键的写入记录。
    rawKeyWriters.get(this.storage)?.delete(fullKey);
  }
}

export { StorageManager };
