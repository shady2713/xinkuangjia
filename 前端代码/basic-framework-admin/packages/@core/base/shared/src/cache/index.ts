/**
 * 缓存子路径出口：对外只暴露 StorageManager，即 @vben-core/shared/cache。
 * 该文件同时是 shared 包登记的构建入口，
 * 偏好设置等模块由此拿到本地存储封装。
 */
export * from './storage-manager';
