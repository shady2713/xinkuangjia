/**
 * 偏好设置打开入口：以模块级 ref 记录抽屉开关，供布局之外的调用方主动唤起。
 * 多次调用共享同一个 ref；只负责开关注记，抽屉渲染与偏好读写另有其责。
 */
import { ref } from 'vue';

const openPreferences = ref(false);

/** 提供偏好抽屉的开关引用与打开方法；多次调用共享同一个模块级 ref。 */
function useOpenPreferences() {
  /** 把抽屉开关置为打开；已处于打开状态时重复调用无副作用。 */
  function handleOpenPreference() {
    openPreferences.value = true;
  }

  return {
    handleOpenPreference,
    openPreferences,
  };
}

export { useOpenPreferences };
