/**
 * 时区状态模块：core-timezone store 持有当前时区并同步给 dayjs，
 * 通过 setTimezoneHandler 允许应用覆盖读时区、列选项、写时区的实现，
 * 未覆盖时回退到 @vben-core/preferences 的默认时区选项，当前时区会持久化。
 * 这里只管时区值的读写与下发，时间格式化与界面展示由使用方负责。
 */
import { ref, unref } from 'vue';

import { DEFAULT_TIME_ZONE_OPTIONS } from '@vben-core/preferences';
import {
  getCurrentTimezone,
  setCurrentTimezone,
} from '@vben-core/shared/utils';

import { acceptHMRUpdate, defineStore } from 'pinia';

/** 可被应用整体或部分覆盖的时区读写契约：三项均可选，未覆盖的项回退到默认实现。 */
interface TimezoneHandler {
  /** 初始化时读取时区，返回空值表示沿用当前时区。 */
  getTimezone?: () => Promise<null | string | undefined>;
  /** 读取时区下拉选项，返回空数组表示没有可选项。 */
  getTimezoneOptions?: () => Promise<
    {
      label: string;
      value: string;
    }[]
  >;
  /** 把时区同步到外部（如服务端用户偏好）；抛错会中断 store 内的状态更新。 */
  setTimezone?: (timezone: string) => Promise<void>;
}

/**
 * 默认时区处理模块
 * 时区存储基于pinia存储插件
 */
const getDefaultTimezoneHandler = (): TimezoneHandler => {
  return {
    /** 回退实现：把偏好设置里的时区表映射成 label/value 形式的下拉选项。 */
    getTimezoneOptions: () => {
      return Promise.resolve(
        DEFAULT_TIME_ZONE_OPTIONS.map((item) => {
          return {
            label: item.label,
            value: item.timezone,
          };
        }),
      );
    },
  };
};

/**
 * 自定义时区处理模块
 */
let customTimezoneHandler: null | Partial<TimezoneHandler> = null;
/**
 * 覆盖时区处理模块的实现，未提供的项继续沿用默认实现。
 * @param handler - 部分实现，只需给出要覆盖的方法；传空对象即恢复全默认行为。
 */
const setTimezoneHandler = (handler: Partial<TimezoneHandler>) => {
  customTimezoneHandler = handler;
};

/**
 * 获取时区处理模块
 */
const getTimezoneHandler = () => {
  return {
    ...getDefaultTimezoneHandler(),
    ...customTimezoneHandler,
  };
};

/**
 * timezone支持模块
 */
const useTimezoneStore = defineStore(
  'core-timezone',
  () => {
    const timezoneRef = ref(getCurrentTimezone());

    /**
     * 初始化时区
     * Initialize the timezone
     */
    async function initTimezone() {
      const timezoneHandler = getTimezoneHandler();
      const timezone = await timezoneHandler.getTimezone?.();
      if (timezone) {
        timezoneRef.value = timezone;
      }
      // 设置dayjs默认时区
      setCurrentTimezone(unref(timezoneRef));
    }

    /**
     * 设置时区
     * Set the timezone
     * @param timezone 时区字符串
     */
    async function setTimezone(timezone: string) {
      const timezoneHandler = getTimezoneHandler();
      await timezoneHandler.setTimezone?.(timezone);
      timezoneRef.value = timezone;
      // 设置dayjs默认时区
      setCurrentTimezone(timezone);
    }

    /**
     * 获取时区选项
     * Get the timezone options
     */
    async function getTimezoneOptions() {
      const timezoneHandler = getTimezoneHandler();
      return (await timezoneHandler.getTimezoneOptions?.()) || [];
    }

    initTimezone().catch((error) => {
      console.error('Failed to initialize timezone during store setup:', error);
    });

    /** 把 store 内的时区恢复为 dayjs 当前默认时区，不反向修改 dayjs。 */
    function $reset() {
      timezoneRef.value = getCurrentTimezone();
    }

    return {
      timezone: timezoneRef,
      setTimezone,
      getTimezoneOptions,
      $reset,
    };
  },
  {
    persist: {
      // 持久化
      pick: ['timezone'],
    },
  },
);

export { setTimezoneHandler, useTimezoneStore };

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useTimezoneStore, hot));
}
