/**
 * 存储契约声明：约定同步缓存应具备的读写、按键取键与长度查询方法，
 * 过期时间以分钟为单位，取值允许为空。
 * 当前 StorageManager 使用自己的本地类型，本文件是替换实现的预留契约，
 * 未被 shared 包的构建入口引用。
 */
type StorageType = 'localStorage' | 'sessionStorage';

interface StorageValue<T> {
  data: T;
  expiry: null | number;
}

interface IStorageCache {
  clear(): void;
  getItem<T>(key: string): null | T;
  key(index: number): null | string;
  length(): number;
  removeItem(key: string): void;
  setItem<T>(key: string, value: T, expiryInMinutes?: number): void;
}

export type { IStorageCache, StorageType, StorageValue };
