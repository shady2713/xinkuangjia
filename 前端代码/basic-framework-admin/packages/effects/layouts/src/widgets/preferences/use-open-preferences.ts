/**
 * 偏好设置打开入口：以模块级 ref 记录抽屉开关，供布局之外的调用方主动唤起。
 * 多次调用共享同一个 ref；只负责开关注记，抽屉渲染与偏好读写另有其责。
 */
import { ref } from 'vue';

const openPreferences = ref(false);

function useOpenPreferences() {
  function handleOpenPreference() {
    openPreferences.value = true;
  }

  return {
    handleOpenPreference,
    openPreferences,
  };
}

export { useOpenPreferences };
