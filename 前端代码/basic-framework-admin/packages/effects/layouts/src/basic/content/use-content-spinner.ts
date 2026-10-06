/**
 * 内容区加载态：注册路由前后置守卫，在过渡加载偏好开启时驱动 spinning，
 * 并用 500ms 最短停留时间避免快速切换时动画一闪而过。
 * 已加载过的路由与 iframe 路由不参与；只暴露 spinning，渲染交给内容外壳组件。
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { preferences } from '@vben/preferences';

/** 注册内容区过渡加载的路由前后置守卫，并在过渡加载偏好开启时对外暴露 spinning 状态。 */
function useContentSpinner() {
  const spinning = ref(false);
  const startTime = ref(0);
  const router = useRouter();
  const minShowTime = 500; // 最小显示时间
  const enableLoading = computed(() => preferences.transition.loading);

  // 结束加载动画
  const onEnd = () => {
    if (!enableLoading.value) {
      return;
    }
    const processTime = performance.now() - startTime.value;
    if (processTime < minShowTime) {
      setTimeout(() => {
        spinning.value = false;
      }, minShowTime - processTime);
    } else {
      spinning.value = false;
    }
  };

  // 路由前置守卫
  router.beforeEach((to) => {
    if (to.meta.loaded || !enableLoading.value || to.meta.iframeSrc) {
      return true;
    }
    startTime.value = performance.now();
    spinning.value = true;
    return true;
  });

  // 路由后置守卫
  router.afterEach((to) => {
    if (to.meta.loaded || !enableLoading.value || to.meta.iframeSrc) {
      return true;
    }
    onEnd();
    return true;
  });

  return { spinning };
}

export { useContentSpinner };
