/**
 * 悬浮状态管理：判断鼠标是否停留在给定元素内，并支持进入/离开延迟。
 *
 * 支持单个元素、元素数组与响应式引用，命中任一元素即视为内部；
 * 返回值附带 enable/disable 控制器，卸载时清理定时器与监听。
 */
import type { Arrayable, MaybeElementRef } from '@vueuse/core';

import type { Ref } from 'vue';

import { computed, effectScope, onUnmounted, ref, unref, watch } from 'vue';

import { isFunction } from '@vben/utils';

import { useElementHover } from '@vueuse/core';

/** 进入与离开的延迟配置，单位毫秒；取值可为固定数字，也可为每次触发时求值的函数。 */
interface HoverDelayOptions {
  /** 鼠标进入延迟时间 */
  // 保持单行：prettier 会把括号内的 JSDoc 上提到括号外，使函数类型的中文说明脱离节点。
  // prettier-ignore
  enterDelay?: (/** 函数形式：每次进入时求值得到延迟毫秒数。 */ () => number) | number;
  /** 鼠标离开延迟时间 */
  // 保持单行：prettier 会把括号内的 JSDoc 上提到括号外，使函数类型的中文说明脱离节点。
  // prettier-ignore
  leaveDelay?: (/** 函数形式：每次离开时求值得到延迟毫秒数。 */ () => number) | number;
}

const DEFAULT_LEAVE_DELAY = 500; // 鼠标离开延迟时间，默认为 500ms
const DEFAULT_ENTER_DELAY = 0; // 鼠标进入延迟时间，默认为 0（立即响应）

/**
 * 监测鼠标是否在元素内部，如果在元素内部则返回 true，否则返回 false
 * @param refElement 所有需要检测的元素。支持单个元素、元素数组或响应式引用的元素数组。如果鼠标在任何一个元素内部都会返回 true
 * @param delay 延迟更新状态的时间，可以是数字或包含进入/离开延迟的配置对象
 * @returns 返回一个数组，第一个元素是一个 ref，表示鼠标是否在元素内部，第二个元素是一个控制器，可以通过 enable 和 disable 方法来控制监听器的启用和禁用
 */
export function useHoverToggle(
  refElement: Arrayable<MaybeElementRef> | Ref<HTMLElement[] | null>,
  // 保持单行：prettier 会把括号内的 JSDoc 上提到括号外，使函数类型的中文说明脱离节点。
  // prettier-ignore
  delay: (/** 函数形式：每次判定时求值得到延迟毫秒数。 */ () => number) | HoverDelayOptions | number = DEFAULT_LEAVE_DELAY,
) {
  // 兼容旧版本API
  const normalizedOptions: HoverDelayOptions =
    typeof delay === 'number' || isFunction(delay)
      ? { enterDelay: DEFAULT_ENTER_DELAY, leaveDelay: delay }
      : {
          enterDelay: DEFAULT_ENTER_DELAY,
          leaveDelay: DEFAULT_LEAVE_DELAY,
          ...delay,
        };

  const value = ref(false);
  const enterTimer = ref<ReturnType<typeof setTimeout> | undefined>();
  const leaveTimer = ref<ReturnType<typeof setTimeout> | undefined>();
  const hoverScopes = ref<ReturnType<typeof effectScope>[]>([]);

  // 使用计算属性包装 refElement，使其响应式变化
  const refs = computed(() => {
    const raw = unref(refElement);
    if (raw === null) return [];
    return Array.isArray(raw) ? raw : [raw];
  });
  // 存储所有 hover 状态
  const isHovers = ref<Array<Ref<boolean>>>([]);

  // 更新 hover 监听的函数
  function updateHovers() {
    // 停止并清理之前的作用域
    hoverScopes.value.forEach((scope) => scope.stop());
    hoverScopes.value = [];

    isHovers.value = refs.value.map((refEle) => {
      if (!refEle) {
        return ref(false);
      }
      /** 把 ref 或组件实例统一解析为真实 DOM 元素，供 useElementHover 侦听。 */
      const eleRef = computed(() => {
        const ele = unref(refEle);
        return ele instanceof Element ? ele : (ele?.$el as Element);
      });

      // 为每个元素创建独立的作用域
      const scope = effectScope();
      /** 在独立作用域内侦听该元素；取不到悬停引用时退化为恒 false，避免影响整体判定。 */
      const hoverRef = scope.run(() => useElementHover(eleRef)) || ref(false);
      hoverScopes.value.push(scope);

      return hoverRef;
    });
  }

  // 监听元素数量变化，避免过度执行
  const elementsCount = computed(() => {
    const raw = unref(refElement);
    if (raw === null) return 0;
    return Array.isArray(raw) ? raw.length : 1;
  });

  // 初始设置
  updateHovers();

  // 只在元素数量变化时重新设置监听器
  const stopWatcher = watch(elementsCount, updateHovers, { deep: false });

  /** 鼠标是否已在全部受监元素之外；受监元素列表为空时恒为 true。 */
  const isOutsideAll = computed(() => isHovers.value.every((v) => !v.value));

  /** 清除进入与离开的待执行定时器；重复调用无副作用，用于切换状态前取消上一次延迟。 */
  function clearTimers() {
    if (enterTimer.value) {
      clearTimeout(enterTimer.value);
      enterTimer.value = undefined;
    }
    if (leaveTimer.value) {
      clearTimeout(leaveTimer.value);
      leaveTimer.value = undefined;
    }
  }

  /**
   * 按配置延迟写入对外悬浮状态，写入前先取消未到期的相反定时器。
   * @param val 目标状态，true 表示鼠标在元素内、false 表示已离开。
   */
  function setValueDelay(val: boolean) {
    clearTimers();

    if (val) {
      // 鼠标进入
      const enterDelay = normalizedOptions.enterDelay ?? DEFAULT_ENTER_DELAY;
      const delayTime = isFunction(enterDelay) ? enterDelay() : enterDelay;

      if (delayTime <= 0) {
        value.value = true;
      } else {
        enterTimer.value = setTimeout(() => {
          value.value = true;
          enterTimer.value = undefined;
        }, delayTime);
      }
    } else {
      // 鼠标离开
      const leaveDelay = normalizedOptions.leaveDelay ?? DEFAULT_LEAVE_DELAY;
      const delayTime = isFunction(leaveDelay) ? leaveDelay() : leaveDelay;

      if (delayTime <= 0) {
        value.value = false;
      } else {
        leaveTimer.value = setTimeout(() => {
          value.value = false;
          leaveTimer.value = undefined;
        }, delayTime);
      }
    }
  }

  /** 悬浮状态变化时按配置延迟同步对外状态；立即执行一次以对齐初始值。 */
  const hoverWatcher = watch(
    isOutsideAll,
    (val) => {
      setValueDelay(!val);
    },
    { immediate: true },
  );

  const controller = {
    /** 恢复悬浮监听；暂停期间未记录的变化不会补发。 */
    enable() {
      hoverWatcher.resume();
    },
    /** 暂停悬浮监听，当前状态值保持不变，可再次 enable 恢复。 */
    disable() {
      hoverWatcher.pause();
    },
  };

  onUnmounted(() => {
    clearTimers();
    // 停止监听器
    stopWatcher();
    // 停止所有剩余的作用域
    hoverScopes.value.forEach((scope) => scope.stop());
  });

  return [value, controller] as [typeof value, typeof controller];
}
