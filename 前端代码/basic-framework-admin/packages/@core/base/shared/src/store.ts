/**
 * 响应式状态出口：原样转发 @tanstack/vue-store 的 createStore 等能力。
 * 供各包在框架内统一依赖来源；不额外包装，也不注入持久化或调试逻辑。
 */
export * from '@tanstack/vue-store';
