/** 存储管理器的测试：覆盖前缀隔离、过期清理、存储类型选择与失败兜底。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageManager } from '../storage-manager';

describe('storageManager', () => {
  let storageManager: StorageManager;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    storageManager = new StorageManager({
      prefix: 'test_',
    });
  });

  it('should set and get an item', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' });
    const user = storageManager.getItem('user');
    expect(user).toEqual({ age: 30, name: 'John Doe' });
  });

  it('should return default value if item does not exist', () => {
    const user = storageManager.getItem('nonexistent', {
      age: 0,
      name: 'Default User',
    });
    expect(user).toEqual({ age: 0, name: 'Default User' });
  });

  it('should remove an item', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' });
    storageManager.removeItem('user');
    const user = storageManager.getItem('user');
    expect(user).toBeNull();
  });

  it('should clear all items with the prefix', () => {
    storageManager.setItem('user1', { age: 30, name: 'John Doe' });
    storageManager.setItem('user2', { age: 25, name: 'Jane Doe' });
    storageManager.clear();
    expect(storageManager.getItem('user1')).toBeNull();
    expect(storageManager.getItem('user2')).toBeNull();
  });

  it('should clear expired items', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' }, 1000); // 1秒过期
    vi.advanceTimersByTime(1001); // 快进时间
    storageManager.clearExpiredItems();
    const user = storageManager.getItem('user');
    expect(user).toBeNull();
  });

  it('should not clear non-expired items', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' }, 10_000); // 10秒过期
    vi.advanceTimersByTime(5000); // 快进时间
    storageManager.clearExpiredItems();
    const user = storageManager.getItem('user');
    expect(user).toEqual({ age: 30, name: 'John Doe' });
  });

  it('should handle JSON parse errors gracefully', () => {
    localStorage.setItem('test_user', '{ invalid JSON }');
    const user = storageManager.getItem('user', {
      age: 0,
      name: 'Default User',
    });
    expect(user).toEqual({ age: 0, name: 'Default User' });
  });
  it('should return null for non-existent items without default value', () => {
    const user = storageManager.getItem('nonexistent');
    expect(user).toBeNull();
  });

  it('should overwrite existing items', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' });
    storageManager.setItem('user', { age: 25, name: 'Jane Doe' });
    const user = storageManager.getItem('user');
    expect(user).toEqual({ age: 25, name: 'Jane Doe' });
  });

  it('should handle items without expiry correctly', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' });
    vi.advanceTimersByTime(5000);
    const user = storageManager.getItem('user');
    expect(user).toEqual({ age: 30, name: 'John Doe' });
  });

  it('should remove expired items when accessed', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' }, 1000); // 1秒过期
    vi.advanceTimersByTime(1001); // 快进时间
    const user = storageManager.getItem('user');
    expect(user).toBeNull();
  });

  it('should not remove non-expired items when accessed', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' }, 10_000); // 10秒过期
    vi.advanceTimersByTime(5000); // 快进时间
    const user = storageManager.getItem('user');
    expect(user).toEqual({ age: 30, name: 'John Doe' });
  });

  it('should handle multiple items with different expiry times', () => {
    storageManager.setItem('user1', { age: 30, name: 'John Doe' }, 1000); // 1秒过期
    storageManager.setItem('user2', { age: 25, name: 'Jane Doe' }, 2000); // 2秒过期
    vi.advanceTimersByTime(1500); // 快进时间
    storageManager.clearExpiredItems();
    const user1 = storageManager.getItem('user1');
    const user2 = storageManager.getItem('user2');
    expect(user1).toBeNull();
    expect(user2).toEqual({ age: 25, name: 'Jane Doe' });
  });

  it('should handle items with no expiry', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' });
    vi.advanceTimersByTime(10_000); // 快进时间
    storageManager.clearExpiredItems();
    const user = storageManager.getItem('user');
    expect(user).toEqual({ age: 30, name: 'John Doe' });
  });

  it('should clear all items correctly', () => {
    storageManager.setItem('user1', { age: 30, name: 'John Doe' });
    storageManager.setItem('user2', { age: 25, name: 'Jane Doe' });
    storageManager.clear();
    const user1 = storageManager.getItem('user1');
    const user2 = storageManager.getItem('user2');
    expect(user1).toBeNull();
    expect(user2).toBeNull();
  });
});

describe('storageManager storage selection', /** 按配置选择 localStorage 或 sessionStorage，两者的数据必须互相隔离。 */ () => {
  afterEach(
    /** 清理两种存储并恢复真实实现。 */ () => {
      localStorage.clear();
      sessionStorage.clear();
      vi.restoreAllMocks();
      vi.useRealTimers();
    },
  );

  it('should write and read through sessionStorage when configured', /** 会话级数据不能落到本地存储，否则关掉浏览器仍在。 */ () => {
    const sessionManager = new StorageManager({
      prefix: 'sess_',
      storageType: 'sessionStorage',
    });

    sessionManager.setItem('token', { value: 'abc' });

    expect(sessionStorage.getItem('sess_-token')).not.toBeNull();
    expect(localStorage.getItem('sess_-token')).toBeNull();
    expect(sessionManager.getItem('token')).toEqual({ value: 'abc' });
  });

  it('should default to localStorage', /** 不指定存储类型时使用本地存储。 */ () => {
    const defaultManager = new StorageManager({ prefix: 'def_' });

    defaultManager.setItem('key', 'value');

    expect(localStorage.getItem('def_-key')).not.toBeNull();
    expect(sessionStorage.getItem('def_-key')).toBeNull();
  });
});

describe('storageManager failure handling', /** 解析失败与写入失败都要兜底，不能让整页渲染崩掉。 */ () => {
  afterEach(
    /** 恢复真实存储实现与控制台。 */ () => {
      localStorage.clear();
      vi.restoreAllMocks();
      vi.useRealTimers();
    },
  );

  it('should return the default value and drop the item when parsing fails', /** 损坏的缓存必须被清掉，否则每次读取都会失败。 */ () => {
    vi.spyOn(console, 'error').mockImplementation(
      /** 不真正打印错误日志，只让 Spy 记录调用。 */ () => {},
    );
    const manager = new StorageManager({ prefix: 'p_' });
    localStorage.setItem('p_-broken', '{ not json }');

    const value = manager.getItem('broken', 'fallback');

    expect(value).toBe('fallback');
    expect(localStorage.getItem('p_-broken')).toBeNull();
  });

  it('should swallow a write failure and log it', /** 超出配额时不能让调用方崩掉，本次写入按失败处理。 */ () => {
    vi.spyOn(console, 'error').mockImplementation(
      /** 不真正打印错误日志，只让 Spy 记录调用。 */ () => {},
    );
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(
      /** 模拟浏览器在超出配额时抛错。 */ () => {
        throw new Error('QuotaExceededError');
      },
    );
    const manager = new StorageManager({ prefix: 'q_' });

    expect(
      /** 写入失败必须被吞掉，不能让调用方崩掉。 */
      () => manager.setItem('key', 'value'),
    ).not.toThrow();
    expect(localStorage.getItem('q_-key')).toBeNull();
  });
});
