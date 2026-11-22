/**
 * 系统字典前端缓存 Store，按需从 `/system/dict-data/simple-list` 拉取一次并按 dictType 分组。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { type DictDataSimple, getSimpleDictDataListApi } from '@/api/system/dict';

export const useDictStore = defineStore('dict', () => {
  const dictMap = ref<Record<string, DictDataSimple[]>>({});
  const loaded = ref(false);
  let loadingPromise: Promise<void> | null = null;

  async function ensureLoaded(force = false): Promise<void> {
    if (loaded.value && !force) return;
    if (loadingPromise && !force) return loadingPromise;
    loadingPromise = (async () => {
      const list = await getSimpleDictDataListApi();
      const grouped: Record<string, DictDataSimple[]> = {};
      for (const item of list) {
        const type = item.dictType;
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(item);
      }
      dictMap.value = grouped;
      loaded.value = true;
    })().finally(() => {
      loadingPromise = null;
    });
    return loadingPromise;
  }

  function getDictOptions(dictType: string): DictDataSimple[] {
    return dictMap.value[dictType] ?? [];
  }

  function getDictItem(
    dictType: string,
    value: string | number | boolean | null | undefined,
  ): DictDataSimple | undefined {
    if (value === null || value === undefined) return undefined;
    const strVal = String(value);
    return getDictOptions(dictType).find((item) => String(item.value) === strVal);
  }

  function reset() {
    dictMap.value = {};
    loaded.value = false;
  }

  return {
    dictMap,
    loaded,
    ensureLoaded,
    getDictOptions,
    getDictItem,
    reset,
  };
});
