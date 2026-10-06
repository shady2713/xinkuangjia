/**
 * 页面水印控制：动态加载 watermark-js-plus，创建、更新与销毁水印。
 *
 * 配置在模块级缓存，更新时与缓存合并，未创建时更新退化为创建；
 * 首次调用注册一次卸载钩子，避免路由切换误销毁水印。
 */
import type { Watermark, WatermarkOptions } from 'watermark-js-plus';

import { nextTick, onUnmounted, readonly, ref } from 'vue';

const watermark = ref<Watermark>();
const unmountedHooked = ref<boolean>(false);
const cachedOptions = ref<Partial<WatermarkOptions>>({
  advancedStyle: {
    colorStops: [
      {
        color: 'gray',
        offset: 0,
      },
      {
        color: 'gray',
        offset: 1,
      },
    ],
    type: 'linear',
  },
  // fontSize: '20px',
  content: '',
  contentType: 'multi-line-text',
  globalAlpha: 0.25,
  gridLayoutOptions: {
    cols: 2,
    gap: [20, 20],
    matrix: [
      [1, 0],
      [0, 1],
    ],
    rows: 2,
  },
  height: 200,
  layout: 'grid',
  rotate: 30,
  width: 160,
});

/**
 * 水印控制入口：动态加载 watermark-js-plus，并暴露创建、更新与销毁方法。
 * 配置在模块级累积，重复调用共享同一实例；首次调用只注册一次卸载钩子。
 * @returns 含 destroyWatermark、updateWatermark 与只读 watermark 实例引用的对象。
 */
export function useWatermark() {
  /** 合并传入配置后新建水印实例并立即创建；已存在实例会被覆盖，旧实例不会自动销毁。 */
  async function initWatermark(options: Partial<WatermarkOptions>) {
    const { Watermark } = await import('watermark-js-plus');

    cachedOptions.value = {
      ...cachedOptions.value,
      ...options,
    };
    watermark.value = new Watermark(cachedOptions.value);
    await watermark.value?.create();
  }

  /** 合并配置后更新水印；实例尚未创建时退化为新建，等待下一帧再提交改动。 */
  async function updateWatermark(options: Partial<WatermarkOptions>) {
    if (watermark.value) {
      await nextTick();
      await watermark.value?.changeOptions({
        ...cachedOptions.value,
        ...options,
      });
    } else {
      await initWatermark(options);
    }
  }

  /** 销毁水印并清空实例引用；尚未创建时不做任何处理。 */
  function destroyWatermark() {
    if (watermark.value) {
      watermark.value.destroy();
      watermark.value = undefined;
    }
  }

  // 只在第一次调用时注册卸载钩子，防止重复注册以致于在路由切换时销毁了水印
  if (!unmountedHooked.value) {
    unmountedHooked.value = true;
    onUnmounted(() => {
      destroyWatermark();
    });
  }

  return {
    destroyWatermark,
    updateWatermark,
    watermark: readonly(watermark),
  };
}
