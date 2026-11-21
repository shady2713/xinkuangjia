/**
 * 验证本地存储管理器的命名空间前缀隔离、主动过期清理与损坏 JSON 淘汰行为。
 *
 * @author shady2713
 */
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it('should clear expired items directly from underlying storage', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' }, 1000); // 1秒过期
    expect(localStorage.getItem('test_-user')).not.toBeNull();
    vi.advanceTimersByTime(1001); // 快进时间
    storageManager.clearExpiredItems();
    expect(localStorage.getItem('test_-user')).toBeNull();
  });

  it('should clear multiple expired items without index shift skips', () => {
    storageManager.setItem('user1', { age: 30, name: 'John Doe' }, 1000);
    storageManager.setItem('user2', { age: 25, name: 'Jane Doe' }, 1000);
    vi.advanceTimersByTime(1001);
    storageManager.clearExpiredItems();
    expect(localStorage.getItem('test_-user1')).toBeNull();
    expect(localStorage.getItem('test_-user2')).toBeNull();
  });

  it('should isolate prefix boundary during clear and clearExpiredItems', () => {
    const appStorage = new StorageManager({ prefix: 'app' });
    localStorage.setItem('apple-keep', JSON.stringify({ value: 1 }));
    localStorage.setItem('app2-keep', JSON.stringify({ value: 2 }));
    localStorage.setItem(
      'app2-expired',
      JSON.stringify({ expiry: Date.now() - 100, value: 3 }),
    );
    appStorage.setItem('token', 'x', 500);

    vi.advanceTimersByTime(501);
    appStorage.clearExpiredItems();
    expect(localStorage.getItem('app-token')).toBeNull();
    expect(localStorage.getItem('app2-expired')).not.toBeNull();

    appStorage.setItem('token', 'y');
    appStorage.clear();
    expect(localStorage.getItem('app-token')).toBeNull();
    expect(localStorage.getItem('apple-keep')).not.toBeNull();
    expect(localStorage.getItem('app2-keep')).not.toBeNull();
  });

  it('should not clear non-expired items', () => {
    storageManager.setItem('user', { age: 30, name: 'John Doe' }, 10_000); // 10秒过期
    vi.advanceTimersByTime(5000); // 快进时间
    storageManager.clearExpiredItems();
    expect(localStorage.getItem('test_-user')).not.toBeNull();
    const user = storageManager.getItem('user');
    expect(user).toEqual({ age: 30, name: 'John Doe' });
  });

  it('should handle JSON parse errors gracefully and remove corrupt key', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    localStorage.setItem('test_-user', '{ invalid JSON }');
    const user = storageManager.getItem('user', {
      age: 0,
      name: 'Default User',
    });
    expect(user).toEqual({ age: 0, name: 'Default User' });
    expect(localStorage.getItem('test_-user')).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
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
    expect(localStorage.getItem('test_-user1')).toBeNull();
    expect(localStorage.getItem('test_-user2')).not.toBeNull();
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
