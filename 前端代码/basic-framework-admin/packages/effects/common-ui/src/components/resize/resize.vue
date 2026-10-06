<script lang="ts" setup>
/**
 * 绝对定位内容容器：在父元素范围内整体拖动，并通过八向控制点缩放。
 * 位置与尺寸既能由 props（x/y/w/h/z）驱动，也能由鼠标或触摸直接拖动，
 * 两条链路共用同一套边界限制、网格吸附与宽高比收敛逻辑。
 * 只做几何计算并上报 dragging、resizing 等事件，不负责数据持久化与业务含义。
 */
/**
 * Resize behavior adapted from an earlier implementation.
 */

import {
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRefs,
  watch,
} from 'vue';

const props = defineProps({
  stickSize: {
    type: Number,
    default: 8,
  },
  parentScaleX: {
    type: Number,
    default: 1,
  },
  parentScaleY: {
    type: Number,
    default: 1,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  preventActiveBehavior: {
    type: Boolean,
    default: false,
  },
  isDraggable: {
    type: Boolean,
    default: true,
  },
  isResizable: {
    type: Boolean,
    default: true,
  },
  aspectRatio: {
    type: Boolean,
    default: false,
  },
  parentLimitation: {
    type: Boolean,
    default: false,
  },
  snapToGrid: {
    type: Boolean,
    default: false,
  },
  gridX: {
    type: Number,
    default: 50,
    /**
     * 校验横向网格吸附步长。
     * @param val 传入的步长值。
     * @returns 是否合法（大于等于 0）。
     */
    validator(val: number) {
      return val >= 0;
    },
  },
  gridY: {
    type: Number,
    default: 50,
    /**
     * 校验纵向网格吸附步长。
     * @param val 传入的步长值。
     * @returns 是否合法（大于等于 0）。
     */
    validator(val: number) {
      return val >= 0;
    },
  },
  parentW: {
    type: Number,
    default: 0,
    /**
     * 校验父容器宽度。
     * @param val 传入的宽度值。
     * @returns 是否合法（大于等于 0）。
     */
    validator(val: number) {
      return val >= 0;
    },
  },
  parentH: {
    type: Number,
    default: 0,
    /**
     * 校验父容器高度。
     * @param val 传入的高度值。
     * @returns 是否合法（大于等于 0）。
     */
    validator(val: number) {
      return val >= 0;
    },
  },
  w: {
    type: [String, Number],
    default: 200,
    /**
     * 校验宽度取值：字符串只接受 'auto'，数字要求非负。
     * @param val 传入的宽度，可能是数字或字符串。
     * @returns 是否合法。
     */
    validator(val: number) {
      return typeof val === 'string' ? val === 'auto' : val >= 0;
    },
  },
  h: {
    type: [String, Number],
    default: 200,
    /**
     * 校验高度取值：字符串只接受 'auto'，数字要求非负。
     * @param val 传入的高度，可能是数字或字符串。
     * @returns 是否合法。
     */
    validator(val: number) {
      return typeof val === 'string' ? val === 'auto' : val >= 0;
    },
  },
  minw: {
    type: Number,
    default: 50,
    /**
     * 校验最小宽度。
     * @param val 传入的宽度值。
     * @returns 是否合法（大于等于 0）。
     */
    validator(val: number) {
      return val >= 0;
    },
  },
  minh: {
    type: Number,
    default: 50,
    /**
     * 校验最小高度。
     * @param val 传入的高度值。
     * @returns 是否合法（大于等于 0）。
     */
    validator(val: number) {
      return val >= 0;
    },
  },
  x: {
    type: Number,
    default: 0,
    /**
     * 校验横坐标：只接受数字类型。
     * @param val 传入的坐标值。
     * @returns 是否为数字。
     */
    validator(val: number) {
      return typeof val === 'number';
    },
  },
  y: {
    type: Number,
    default: 0,
    /**
     * 校验纵坐标：只接受数字类型。
     * @param val 传入的坐标值。
     * @returns 是否为数字。
     */
    validator(val: number) {
      return typeof val === 'number';
    },
  },
  z: {
    type: [String, Number],
    default: 'auto',
    /**
     * 校验层级取值：字符串只接受 'auto'，数字要求非负。
     * @param val 传入的层级，可能是数字或字符串。
     * @returns 是否合法。
     */
    validator(val: number) {
      return typeof val === 'string' ? val === 'auto' : val >= 0;
    },
  },
  dragHandle: {
    type: String,
    default: null,
  },
  dragCancel: {
    type: String,
    default: null,
  },
  sticks: {
    type: Array<'bl' | 'bm' | 'br' | 'ml' | 'mr' | 'tl' | 'tm' | 'tr'>,
    /**
     * 控制点默认值。
     * @returns 八向控制点名称数组，八个方向全部开启。
     */
    default() {
      return ['tl', 'tm', 'tr', 'mr', 'br', 'bm', 'bl', 'ml'];
    },
  },
  axis: {
    type: String,
    default: 'both',
    /**
     * 校验可拖动方向：只接受 both、none、x、y 四个取值。
     * @param val 传入的方向值。
     * @returns 是否在允许的取值集合内。
     */
    validator(val: string) {
      return ['both', 'none', 'x', 'y'].includes(val);
    },
  },
  contentClass: {
    type: String,
    required: false,
    default: '',
  },
});

const emit = defineEmits([
  'clicked',
  'dragging',
  'dragstop',
  'resizing',
  'resizestop',
  'activated',
  'deactivated',
]);

const styleMapping = {
  y: {
    t: 'top',
    m: 'marginTop',
    b: 'bottom',
  },
  x: {
    l: 'left',
    m: 'marginLeft',
    r: 'right',
  },
};

/** 同时能冒泡取消、又能读到指针坐标的最小事件结构，鼠标与触摸事件都满足。 */
type ResizePointerEvent = Event & {
  pageX?: number;
  pageY?: number;
  touches?: TouchList;
};

/** 拖动监听器：接收鼠标或触摸事件，内部再按需读取指针坐标。 */
type ResizeDomEventHandler = (ev: ResizePointerEvent) => void;

/**
 * 拖动过程中注册到 documentElement 上的监听器集合。
 * 键为原生事件名；mousemove 与 touchmove 共用同一处理器，因此值按 ResizePointerEvent 声明。
 */
type ResizeDomEvents = Map<string, ResizeDomEventHandler>;

/**
 * 从鼠标或触摸事件中解析当前指针坐标。
 * @param ev 鼠标事件、触摸事件，或由 watch/程序化缩放构造的坐标片段
 * @param ev.pageX 鼠标事件的页面横坐标，触摸事件没有该字段
 * @param ev.pageY 鼠标事件的页面纵坐标，触摸事件没有该字段
 * @param ev.touches 触摸事件的触点列表，鼠标事件没有该字段
 * @returns 页面坐标；既无 pageX 也无触点时按 0 处理，拖动按 0 位移继续而不是抛错
 */
function readPointerPosition(ev: {
  pageX?: number;
  pageY?: number;
  touches?: TouchList;
}) {
  const touch = ev.touches?.[0];
  return {
    pageX: ev.pageX ?? touch?.pageX ?? 0,
    pageY: ev.pageY ?? touch?.pageY ?? 0,
  };
}

/**
 * 在 documentElement 上批量注册拖动事件监听。
 * @param events 事件名到处理函数的映射
 */
function addEvents(events: ResizeDomEvents) {
  events.forEach((cb, eventName) => {
    document.documentElement.addEventListener(eventName, cb);
  });
}

/**
 * 从 documentElement 上移除由 addEvents 注册的监听。
 * 组件卸载时必须调用，否则监听会残留在已移除的 DOM 上。
 * @param events 与注册时相同的映射
 */
function removeEvents(events: ResizeDomEvents) {
  events.forEach((cb, eventName) => {
    document.documentElement.removeEventListener(eventName, cb);
  });
}

const {
  stickSize,
  parentScaleX,
  parentScaleY,
  isActive,
  preventActiveBehavior,
  isDraggable,
  isResizable,
  aspectRatio,
  parentLimitation,
  snapToGrid,
  gridX,
  gridY,
  parentW,
  parentH,
  w,
  h,
  minw,
  minh,
  x,
  y,
  z,
  dragHandle,
  dragCancel,
  sticks,
  axis,
  contentClass,
} = toRefs(props);

// states
const active = ref(false);
const zIndex = ref<null | number>(null);
const parentWidth = ref<null | number>(null);
const parentHeight = ref<null | number>(null);
const left = ref<null | number>(null);
const top = ref<null | number>(null);
const right = ref<null | number>(null);
const bottom = ref<null | number>(null);

const aspectFactor = ref<null | number>(null);

// state end

const stickDrag = ref(false);
const bodyDrag = ref(false);
const dimensionsBeforeMove = ref({
  pointerX: 0,
  pointerY: 0,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: 0,
  height: 0,
});
const limits = ref({
  left: { min: null as null | number, max: null as null | number },
  right: { min: null as null | number, max: null as null | number },
  top: { min: null as null | number, max: null as null | number },
  bottom: { min: null as null | number, max: null as null | number },
});
const currentStick = ref<null | string>(null);

const parentElement = ref<HTMLElement | null>(null);

/**
 * 本组件实例，用于给拖拽手柄与取消区元素写入实例标识。
 * 必须在 setup 阶段取一次：`bodyDown` 由真实 DOM 事件触发，Vue 在事件回调里不设置当前实例，
 * 回调内调用 `getCurrentInstance()` 只会得到 null，标记比较的右侧随之恒为 undefined，
 * dragHandle 与 dragCancel 的过滤结果会被整体反转。
 */
const instance = getCurrentInstance();

// 挂载前这四个尺寸都还是 null，按 0 参与运算与原来的隐式转换结果一致，
// 因此首帧渲染不会出现 NaN，onMounted 写入真实值后自动重算。
const width = computed(
  /**
   * 当前内容宽度 = 父容器宽度 - 左边距 - 右边距。
   * @returns 挂载前按 0 计算的宽度，onMounted 后为真实像素值。
   */
  () => (parentWidth.value ?? 0) - (left.value ?? 0) - (right.value ?? 0),
);

const height = computed(
  /**
   * 当前内容高度 = 父容器高度 - 上边距 - 下边距。
   * @returns 挂载前按 0 计算的高度，onMounted 后为真实像素值。
   */
  () => (parentHeight.value ?? 0) - (top.value ?? 0) - (bottom.value ?? 0),
);

const rect = computed(
  /**
   * 对外暴露的矩形信息，供 dragging/resizing 事件带出。
   * @returns 取整后的位置与尺寸，挂载前为全 0。
   */
  () => ({
    left: Math.round(left.value ?? 0),
    top: Math.round(top.value ?? 0),
    width: Math.round(width.value),
    height: Math.round(height.value),
  }),
);

/** 记录拖动开始时的指针位置与四边、宽高，作为本次位移计算的基准，并记下当前宽高比。 */
const saveDimensionsBeforeMove = ({
  pointerX,
  pointerY,
}: {
  pointerX: number;
  pointerY: number;
}) => {
  dimensionsBeforeMove.value.pointerX = pointerX;
  dimensionsBeforeMove.value.pointerY = pointerY;

  dimensionsBeforeMove.value.left = left.value as number;
  dimensionsBeforeMove.value.right = right.value as number;
  dimensionsBeforeMove.value.top = top.value as number;
  dimensionsBeforeMove.value.bottom = bottom.value as number;

  dimensionsBeforeMove.value.width = width.value as number;
  dimensionsBeforeMove.value.height = height.value as number;

  aspectFactor.value = width.value / height.value;
};

/**
 * 把单边坐标夹紧到允许区间内。
 * @param limit 该边的上下限；某一侧为 null 表示该方向不限制。
 * @param current 待修正的坐标值。
 * @returns 夹紧后的坐标。
 */
const sideCorrectionByLimit = (
  limit: { max: number; min: number },
  current: number,
) => {
  let value = current;

  if (limit.min !== null && current < limit.min) {
    value = limit.min;
  } else if (limit.max !== null && limit.max < current) {
    value = limit.max;
  }

  return value;
};

/** 按当前边界限制逐边修正矩形，返回修正后的四边坐标。 */
const rectCorrectionByLimit = (rect: {
  newBottom: number;
  newLeft: number;
  newRight: number;
  newTop: number;
}) => {
  // const { limits } = this;
  let { newRight, newLeft, newBottom, newTop } = rect;

  /** 单边坐标的允许区间；上限或下限为 null 表示该侧不限制。 */
  type RectRange = {
    max: number;
    min: number;
  };

  newLeft = sideCorrectionByLimit(limits.value.left as RectRange, newLeft);
  newRight = sideCorrectionByLimit(limits.value.right as RectRange, newRight);
  newTop = sideCorrectionByLimit(limits.value.top as RectRange, newTop);
  newBottom = sideCorrectionByLimit(
    limits.value.bottom as RectRange,
    newBottom,
  );

  return {
    newLeft,
    newRight,
    newTop,
    newBottom,
  };
};

/**
 * 按锁定宽高比修正拖动产生的矩形。
 * 只调整与当前控制点垂直或水平的那一条边，另一条边保持调用方传入的值。
 * @param rect 本次拖动计算出的候选矩形
 * @param rect.newBottom 下边距
 * @param rect.newLeft 左边距
 * @param rect.newRight 右边距
 * @param rect.newTop 上边距
 * @returns 满足宽高比约束后的矩形。
 */
const rectCorrectionByAspectRatio = (rect: {
  newBottom: number;
  newLeft: number;
  newRight: number;
  newTop: number;
}) => {
  let { newLeft, newRight, newTop, newBottom } = rect;
  // const { parentWidth, parentHeight, currentStick, aspectFactor, dimensionsBeforeMove } = this;

  // 比例修正只在拖动过程中调用，此时父容器尺寸与比例系数都已写入；
  // 万一缺失则退到 0 与 1，保证函数总能返回可用的矩形而不是抛错。
  const parentW = parentWidth.value ?? 0;
  const parentH = parentHeight.value ?? 0;
  const stick = currentStick.value ?? '';
  const factor = aspectFactor.value ?? 1;

  let newWidth = parentW - newLeft - newRight;
  let newHeight = parentH - newTop - newBottom;

  if (stick[1] === 'm') {
    const deltaHeight = newHeight - dimensionsBeforeMove.value.height;

    newLeft -= (deltaHeight * factor) / 2;
    newRight -= (deltaHeight * factor) / 2;
  } else if (stick[0] === 'm') {
    const deltaWidth = newWidth - dimensionsBeforeMove.value.width;

    newTop -= deltaWidth / factor / 2;
    newBottom -= deltaWidth / factor / 2;
  } else if (newWidth / newHeight > factor) {
    newWidth = factor * newHeight;

    if (stick[1] === 'l') {
      newLeft = parentW - newRight - newWidth;
    } else {
      newRight = parentW - newLeft - newWidth;
    }
  } else {
    newHeight = newWidth / factor;

    if (stick[0] === 't') {
      newTop = parentH - newBottom - newHeight;
    } else {
      newBottom = parentH - newTop - newHeight;
    }
  }

  return { newLeft, newRight, newTop, newBottom };
};

/**
 * 按控制点位移量移动矩形的一条或两条边。
 * 开启 snapToGrid 时会把结果吸附到网格；最后再按限制区间和宽高比收敛。
 * @param delta 本次指针位移，已按父级缩放换算
 * @param delta.x 水平位移，向右为正
 * @param delta.y 垂直位移，向下为正
 */
const stickMove = (delta: { x: number; y: number }) => {
  let newTop = dimensionsBeforeMove.value.top;
  let newBottom = dimensionsBeforeMove.value.bottom;
  let newLeft = dimensionsBeforeMove.value.left;
  let newRight = dimensionsBeforeMove.value.right;
  // currentStick 形如 "br"，首字符是上下方向、次字符是左右方向；
  // 尚未开始拖动时为空串，两个 switch 都不会命中，等价于不做位移。
  const stick = currentStick.value ?? '';
  switch (stick[0]) {
    case 'b': {
      newBottom = dimensionsBeforeMove.value.bottom + delta.y;

      if (snapToGrid.value) {
        newBottom =
          (parentHeight.value as number) -
          Math.round(
            ((parentHeight.value as number) - newBottom) / gridY.value,
          ) *
            gridY.value;
      }

      break;
    }

    case 't': {
      newTop = dimensionsBeforeMove.value.top - delta.y;

      if (snapToGrid.value) {
        newTop = Math.round(newTop / gridY.value) * gridY.value;
      }

      break;
    }
    default: {
      break;
    }
  }

  switch (stick[1]) {
    case 'l': {
      newLeft = dimensionsBeforeMove.value.left - delta.x;

      if (snapToGrid.value) {
        newLeft = Math.round(newLeft / gridX.value) * gridX.value;
      }

      break;
    }

    case 'r': {
      newRight = dimensionsBeforeMove.value.right + delta.x;

      if (snapToGrid.value) {
        newRight =
          (parentWidth.value as number) -
          Math.round(((parentWidth.value as number) - newRight) / gridX.value) *
            gridX.value;
      }

      break;
    }
    default: {
      break;
    }
  }

  ({ newLeft, newRight, newTop, newBottom } = rectCorrectionByLimit({
    newLeft,
    newRight,
    newTop,
    newBottom,
  }));

  if (aspectRatio.value) {
    ({ newLeft, newRight, newTop, newBottom } = rectCorrectionByAspectRatio({
      newLeft,
      newRight,
      newTop,
      newBottom,
    }));
  }

  left.value = newLeft;
  right.value = newRight;
  top.value = newTop;
  bottom.value = newBottom;

  emit('resizing', rect.value);
};

/** 结束控制点缩放：清除缩放标记并把基准尺寸复位。 */
const stickUp = () => {
  stickDrag.value = false;
  // dimensionsBeforeMove.value = {
  //   pointerX: 0,
  //   pointerY: 0,
  //   x: 0,
  //   y: 0,
  //   w: 0,
  //   h: 0,
  // };

  Object.assign(dimensionsBeforeMove.value, {
    pointerX: 0,
    pointerY: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  });

  limits.value = {
    left: { min: null, max: null },
    right: { min: null, max: null },
    top: { min: null, max: null },
    bottom: { min: null, max: null },
  };

  emit('resizing', rect.value);
  emit('resizestop', rect.value);
};

/**
 * 计算整体拖动时四条边的可移动范围。
 * 拖动只改变位置不改变尺寸，因此上限就是"父容器减去当前内容尺寸"。
 * @returns 四个方向各自的最小值与最大值。
 */
const calcDragLimitation = () => {
  return {
    left: { min: 0, max: (parentWidth.value as number) - width.value },
    right: { min: 0, max: (parentWidth.value as number) - width.value },
    top: { min: 0, max: (parentHeight.value as number) - height.value },
    bottom: { min: 0, max: (parentHeight.value as number) - height.value },
  };
};

/**
 * 计算单个控制点可拖动的范围。
 * 先按最小宽高得到基础区间，开启宽高比时再与比例推导出的区间求交集。
 * @returns 四个方向各自的最小值与最大值，供拖动过程中夹取。
 */
const calcResizeLimits = () => {
  // const { aspectFactor, width, height, bottom, top, left, right } = this;

  const parentLim = parentLimitation.value ? 0 : null;

  if (aspectRatio.value) {
    if (minw.value / minh.value > (aspectFactor.value as number)) {
      minh.value = minw.value / (aspectFactor.value as number);
    } else {
      minw.value = ((aspectFactor.value as number) * minh.value) as number;
    }
  }

  const limits = {
    left: {
      min: parentLim,
      max: (left.value as number) + (width.value - minw.value),
    },
    right: {
      min: parentLim,
      max: (right.value as number) + (width.value - minw.value),
    },
    top: {
      min: parentLim,
      max: (top.value as number) + (height.value - minh.value),
    },
    bottom: {
      min: parentLim,
      max: (bottom.value as number) + (height.value - minh.value),
    },
  };

  // 以下换算都发生在拖动过程中，各尺寸与比例系数此时均已写入；
  // 仍按 0 与 1 兜底，保证父容器尚未测量时也能返回可用的限制区间。
  const leftPos = left.value ?? 0;
  const rightPos = right.value ?? 0;
  const topPos = top.value ?? 0;
  const bottomPos = bottom.value ?? 0;
  const factor = aspectFactor.value ?? 1;
  const minHeight = minh.value ?? 0;
  const minWidth = minw.value ?? 0;

  if (aspectRatio.value) {
    const aspectLimits = {
      left: {
        min: leftPos - Math.min(topPos, bottomPos) * factor * 2,
        max: leftPos + ((height.value - minHeight) / 2) * factor * 2,
      },
      right: {
        min: rightPos - Math.min(topPos, bottomPos) * factor * 2,
        max: rightPos + ((height.value - minHeight) / 2) * factor * 2,
      },
      top: {
        min: topPos - (Math.min(leftPos, rightPos) / factor) * 2,
        max: topPos + ((width.value - minWidth) / 2 / factor) * 2,
      },
      bottom: {
        min: bottomPos - (Math.min(leftPos, rightPos) / factor) * 2,
        max: bottomPos + ((width.value - minWidth) / 2 / factor) * 2,
      },
    };

    if ((currentStick.value ?? '')[0] === 'm') {
      limits.left = {
        min: Math.max(limits.left.min ?? 0, aspectLimits.left.min),
        max: Math.min(limits.left.max, aspectLimits.left.max),
      };
      limits.right = {
        min: Math.max(limits.right.min ?? 0, aspectLimits.right.min),
        max: Math.min(limits.right.max, aspectLimits.right.max),
      };
    } else if ((currentStick.value ?? '')[1] === 'm') {
      limits.top = {
        min: Math.max(limits.top.min ?? 0, aspectLimits.top.min),
        max: Math.min(limits.top.max, aspectLimits.top.max),
      };
      limits.bottom = {
        min: Math.max(limits.bottom.min ?? 0, aspectLimits.bottom.min),
        max: Math.min(limits.bottom.max, aspectLimits.bottom.max),
      };
    }
  }

  return limits;
};

const positionStyle = computed(
  /**
   * 内容容器的定位样式。
   * @returns 绝对定位所需的 top、left 与可选层级。
   */
  () => ({
    top: `${top.value}px`,
    left: `${left.value}px`,
    // zIndex 为 null 表示"不接管层级"，交给外部样式控制；
    // 归一成 undefined 才能通过 CSSProperties，运行时同样是不写该样式。
    zIndex: zIndex.value ?? undefined,
  }),
);

/** 内容尺寸样式：宽高为 auto 时保持自适应，否则写成像素值。 */
const sizeStyle = computed(() => ({
  width: w.value === 'auto' ? 'auto' : `${width.value}px`,
  height: h.value === 'auto' ? 'auto' : `${height.value}px`,
}));

/** 控制点样式生成器：按控制点方向给出尺寸与负偏移，使控制点居中压在边框线上。 */
const stickStyles = computed(() => (stick: string) => {
  const stickStyle = {
    width: `${stickSize.value / parentScaleX.value}px`,
    height: `${stickSize.value / parentScaleY.value}px`,
    [styleMapping.y[stick[0] as 'b' | 'm' | 't'] as 'height' | 'width']:
      `${stickSize.value / parentScaleX.value / -2}px`,
    [styleMapping.x[stick[1] as 'l' | 'm' | 'r'] as 'height' | 'width']:
      `${stickSize.value / parentScaleX.value / -2}px`,
  };
  return stickStyle;
});

/**
 * 整体拖动：按位移同时平移四边，必要时做网格吸附与父级范围限制。
 * @param delta 相对拖动起点的横向与纵向位移。
 */
const bodyMove = (delta: { x: number; y: number }) => {
  let newTop = dimensionsBeforeMove.value.top - delta.y;
  let newBottom = dimensionsBeforeMove.value.bottom + delta.y;
  let newLeft = dimensionsBeforeMove.value.left - delta.x;
  let newRight = dimensionsBeforeMove.value.right + delta.x;

  if (snapToGrid.value) {
    let alignTop = true;
    let alignLeft = true;

    let diffT = newTop - Math.floor(newTop / gridY.value) * gridY.value;
    let diffB =
      (parentHeight.value as number) -
      newBottom -
      Math.floor(((parentHeight.value as number) - newBottom) / gridY.value) *
        gridY.value;
    let diffL = newLeft - Math.floor(newLeft / gridX.value) * gridX.value;
    let diffR =
      (parentWidth.value as number) -
      newRight -
      Math.floor(((parentWidth.value as number) - newRight) / gridX.value) *
        gridX.value;

    if (diffT > gridY.value / 2) {
      diffT -= gridY.value;
    }
    if (diffB > gridY.value / 2) {
      diffB -= gridY.value;
    }
    if (diffL > gridX.value / 2) {
      diffL -= gridX.value;
    }
    if (diffR > gridX.value / 2) {
      diffR -= gridX.value;
    }

    if (Math.abs(diffB) < Math.abs(diffT)) {
      alignTop = false;
    }
    if (Math.abs(diffR) < Math.abs(diffL)) {
      alignLeft = false;
    }

    newTop -= alignTop ? diffT : diffB;
    newBottom = (parentHeight.value as number) - height.value - newTop;
    newLeft -= alignLeft ? diffL : diffR;
    newRight = (parentWidth.value as number) - width.value - newLeft;
  }

  ({
    newLeft: left.value,
    newRight: right.value,
    newTop: top.value,
    newBottom: bottom.value,
  } = rectCorrectionByLimit({ newLeft, newRight, newTop, newBottom }));

  emit('dragging', rect.value);
};

/** 结束整体拖动：清除拖动标记，并依次抛出 dragging 与 dragstop 事件。 */
const bodyUp = () => {
  bodyDrag.value = false;
  emit('dragging', rect.value);
  emit('dragstop', rect.value);

  // dimensionsBeforeMove.value = { pointerX: 0, pointerY: 0, x: 0, y: 0, w: 0, h: 0 };
  Object.assign(dimensionsBeforeMove.value, {
    pointerX: 0,
    pointerY: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  });

  limits.value = {
    left: { min: null, max: null },
    right: { min: null, max: null },
    top: { min: null, max: null },
    bottom: { min: null, max: null },
  };
};

/**
 * 在控制点上按下鼠标或触屏时开始单边缩放。
 * 记录按下位置作为后续位移基准，并按当前尺寸与最小宽高算出本次可移动区间。
 *
 * @param stick 当前控制点，形如 'br'，首字符为上下、次字符为左右
 * @param ev 鼠标或触摸事件；鼠标走 pageX/pageY，触屏取第一个触点
 * @param ev.pageX 鼠标事件的页面横坐标，触摸事件没有该字段
 * @param ev.pageY 鼠标事件的页面纵坐标，触摸事件没有该字段
 * @param ev.touches 触摸事件的触点列表，鼠标事件没有该字段
 * @param force 为 true 时忽略 isResizable 与 active 的前置判断，供 watch 触发的程序化缩放使用
 */
const stickDown = (
  stick: string,
  ev: {
    pageX?: number;
    pageY?: number;
    touches?: TouchList;
  },
  force = false,
) => {
  if ((!isResizable.value || !active.value) && !force) {
    return;
  }

  stickDrag.value = true;

  // 鼠标事件没有 pageX/pageY 时退回第一个触点；两者都取不到时按 0 处理，
  // 与 move 的取值口径保持一致，避免在缺少 touches 的事件上抛错中断拖动。
  const { pageX: pointerX, pageY: pointerY } = readPointerPosition(ev);

  saveDimensionsBeforeMove({ pointerX, pointerY });

  currentStick.value = stick;

  limits.value = calcResizeLimits();
};

/**
 * 指针移动的统一入口：按当前拖动模式分发到控制点或整体移动。
 * 未处于拖动状态时直接返回，避免与页面自身的滚动、选择行为冲突。
 * @param ev 鼠标或触摸事件；mousemove 与 touchmove 共用本函数，位移已按父级缩放换算后再传给下层。
 */
const move = (ev: ResizePointerEvent) => {
  if (!stickDrag.value && !bodyDrag.value) {
    return;
  }

  ev.stopPropagation();

  // 鼠标事件没有 pageX/pageY 时退回触点坐标；两者都取不到时按 0 处理，
  // 避免在缺少 touches 的事件上直接抛错导致拖动中断。
  const { pageX, pageY } = readPointerPosition(ev);

  const delta = {
    x: (dimensionsBeforeMove.value.pointerX - pageX) / parentScaleX.value,
    y: (dimensionsBeforeMove.value.pointerY - pageY) / parentScaleY.value,
  };

  if (stickDrag.value) {
    stickMove(delta);
  }

  if (bodyDrag.value) {
    switch (axis.value) {
      case 'none': {
        return;
      }
      case 'x': {
        delta.y = 0;

        break;
      }
      case 'y': {
        delta.x = 0;

        break;
      }
      // No default
    }
    bodyMove(delta);
  }
};

/** 指针抬起时的统一处理：按当前模式分派到控制点缩放结束或整体拖动结束。 */
const up = () => {
  if (stickDrag.value) {
    stickUp();
  } else if (bodyDrag.value) {
    bodyUp();
  }
};

/** 取消选中态；开启「阻止自动激活」时保持现状不做处理。 */
const deselect = () => {
  if (preventActiveBehavior.value) {
    return;
  }
  active.value = false;
};

const domEvents = ref(
  new Map([
    ['mousedown', deselect],
    ['mouseleave', up],
    ['mousemove', move],
    ['mouseup', up],
    ['touchcancel', up],
    ['touchend', up],
    ['touchmove', move],
    ['touchstart', up],
  ]),
);

const container = ref<HTMLDivElement>();

onMounted(
  /**
   * 挂载后测量父容器与自身尺寸，初始化四条边的位置，并注册全局拖动事件。
   * 拖动事件挂在 document 上，保证指针移出组件范围后仍能继续拖动。
   */
  () => {
    const $el = instance?.vnode.el as HTMLElement;

    parentElement.value = $el?.parentNode as HTMLElement;
    parentWidth.value = parentW.value ?? parentElement.value?.clientWidth;
    parentHeight.value = parentH.value ?? parentElement.value?.clientHeight;

    // w/h 为 auto 时按容器实际尺寸推算边距；容器尚未挂载时退到 0，
    // 避免首帧因 ref 为空而抛错，onMounted 之后会拿到真实值。
    const containerEl = container.value;
    left.value = x.value;
    top.value = y.value;
    right.value =
      (parentWidth.value ?? 0) -
      (w.value === 'auto'
        ? (containerEl?.scrollWidth ?? 0)
        : (w.value as number)) -
      (left.value ?? 0);
    bottom.value =
      (parentHeight.value ?? 0) -
      (h.value === 'auto'
        ? (containerEl?.scrollHeight ?? 0)
        : (h.value as number)) -
      (top.value ?? 0);

    addEvents(domEvents.value);

    if (dragHandle.value) {
      [...($el?.querySelectorAll(dragHandle.value) || [])].forEach(
        /**
         * 给命中的元素打上当前实例标记，bodyDown 据此判断是否允许从这里开始拖动。
         * @param dragHandle 选择器命中的元素。
         */
        (dragHandle) => {
          (dragHandle as HTMLElement).dataset.dragHandle = String(
            instance?.uid,
          );
        },
      );
    }

    if (dragCancel.value) {
      [...($el?.querySelectorAll(dragCancel.value) || [])].forEach(
        /**
         * 打上取消标记，从这些元素上按下时不会开始拖动。
         * @param cancelHandle 选择器命中的元素。
         */
        (cancelHandle) => {
          (cancelHandle as HTMLElement).dataset.dragCancel = String(
            instance?.uid,
          );
        },
      );
    }
  },
);

onBeforeUnmount(() => {
  removeEvents(domEvents.value);
});

/**
 * 在内容区域按下时开始整体拖动。
 * 先按 dragHandle、dragCancel 过滤是否允许拖动，再记录按下位置作为位移基准。
 * @param ev 鼠标或触摸事件。
 */
const bodyDown = (ev: MouseEvent & TouchEvent) => {
  const { target, button } = ev;

  if (!preventActiveBehavior.value) {
    active.value = true;
  }

  if (button && button !== 0) {
    return;
  }

  emit('clicked', ev);

  if (!active.value) {
    return;
  }

  // 事件目标可能不是元素（例如触摸事件的目标是文本节点），
  // 取不到 dataset 时按"不是拖拽手柄"处理，等价于放弃本次拖动。
  const targetDataset = (target as HTMLElement | null)?.dataset;
  if (
    dragHandle.value &&
    targetDataset?.dragHandle !== instance?.uid.toString()
  ) {
    return;
  }

  if (
    dragCancel.value &&
    targetDataset?.dragCancel === instance?.uid.toString()
  ) {
    return;
  }

  if (ev.stopPropagation !== undefined) {
    ev.stopPropagation();
  }

  if (ev.preventDefault !== undefined) {
    ev.preventDefault();
  }

  if (isDraggable.value) {
    bodyDrag.value = true;
  }

  const touch = ev.touches?.[0];
  const pointerX = ev.pageX ?? touch?.pageX ?? 0;
  const pointerY = ev.pageY ?? touch?.pageY ?? 0;

  saveDimensionsBeforeMove({ pointerX, pointerY });

  if (parentLimitation.value) {
    limits.value = calcDragLimitation();
  }
};

watch(
  () => active.value,
  (isActive) => {
    if (isActive) {
      emit('activated');
    } else {
      emit('deactivated');
    }
  },
);

watch(
  () => isActive.value,
  (val) => {
    active.value = val;
  },
  { immediate: true },
);

watch(
  () => z.value,
  (val) => {
    if ((val as number) >= 0 || val === 'auto') {
      zIndex.value = val as number;
    }
  },
  { immediate: true },
);

watch(
  () => x.value,
  /**
   * 外部改动 x 时按差值整体平移组件，保持指针位置不跳变。
   * @param newVal 最新的 x 取值。
   * @param oldVal 变化前的 x 取值。
   */
  (newVal, oldVal) => {
    if (stickDrag.value || bodyDrag.value || newVal === left.value) {
      return;
    }

    const delta = oldVal - newVal;

    bodyDown({
      pageX: left.value ?? 0,
      pageY: top.value ?? 0,
    } as MouseEvent & TouchEvent);
    bodyMove({ x: delta, y: 0 });

    nextTick(() => {
      bodyUp();
    });
  },
);

watch(
  () => y.value,
  (newVal, oldVal) => {
    if (stickDrag.value || bodyDrag.value || newVal === top.value) {
      return;
    }

    const delta = oldVal - newVal;

    bodyDown({ pageX: left.value, pageY: top.value } as MouseEvent &
      TouchEvent);
    bodyMove({ x: 0, y: delta });

    nextTick(() => {
      bodyUp();
    });
  },
);

watch(
  () => w.value,
  /**
   * 外部改动 w 时按差值从右边界缩放，并复用控制点拖动链路完成限制与比例收敛。
   * @param newVal 最新的 w 取值。
   * @param oldVal 变化前的 w 取值。
   */
  (newVal, oldVal) => {
    if (stickDrag.value || bodyDrag.value || newVal === width.value) {
      return;
    }

    const stick = 'mr';
    const delta = (oldVal as number) - (newVal as number);

    stickDown(
      stick,
      { pageX: right.value ?? 0, pageY: (top.value ?? 0) + height.value / 2 },
      true,
    );
    stickMove({ x: delta, y: 0 });

    nextTick(() => {
      stickUp();
    });
  },
);

watch(
  () => h.value,
  /**
   * 外部改动 h 时按差值从下边界缩放，复用控制点拖动链路完成限制与比例收敛。
   * @param newVal 最新的 h 取值。
   * @param oldVal 变化前的 h 取值。
   */
  (newVal, oldVal) => {
    if (stickDrag.value || bodyDrag.value || newVal === height.value) {
      return;
    }

    const stick = 'bm';
    const delta = (oldVal as number) - (newVal as number);

    stickDown(
      stick,
      { pageX: (left.value ?? 0) + width.value / 2, pageY: bottom.value ?? 0 },
      true,
    );
    stickMove({ x: 0, y: delta });

    nextTick(() => {
      stickUp();
    });
  },
);

watch(
  () => parentW.value,
  /**
   * 父容器宽度变化时重算右边距，保持内容宽度不变。
   * @param val 最新的父容器宽度。
   */
  (val) => {
    right.value = val - width.value - (left.value ?? 0);
    parentWidth.value = val;
  },
);

watch(
  () => parentH.value,
  /**
   * 父容器高度变化时重算下边距，保持内容高度不变。
   * @param val 最新的父容器高度。
   */
  (val) => {
    bottom.value = val - height.value - (top.value ?? 0);
    parentHeight.value = val;
  },
);
</script>

<template>
  <div
    :class="`${active || isActive ? 'active' : 'inactive'} ${contentClass ? contentClass : ''}`"
    :style="positionStyle"
    class="resize"
    @mousedown="bodyDown($event as TouchEvent & MouseEvent)"
    @touchend="up"
    @touchstart="bodyDown($event as TouchEvent & MouseEvent)"
  >
    <div ref="container" :style="sizeStyle" class="content-container">
      <slot></slot>
    </div>
    <div
      v-for="(stick, index) of sticks"
      :key="index"
      :class="[`resize-stick-${stick}`, isResizable ? '' : 'not-resizable']"
      :style="stickStyles(stick)"
      class="resize-stick"
      @mousedown.stop.prevent="
        stickDown(stick, $event as TouchEvent & MouseEvent)
      "
      @touchstart.stop.prevent="
        stickDown(stick, $event as TouchEvent & MouseEvent)
      "
    ></div>
  </div>
</template>

<style lang="css" scoped>
.resize {
  position: absolute;
  box-sizing: border-box;
}

.resize.active::before {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  outline: 1px dashed #d6d6d6;
  content: '';
}

.resize-stick {
  position: absolute;
  box-sizing: border-box;
  font-size: 1px;
  background: #fff;
  border: 1px solid #6c6c6c;
  box-shadow: 0 0 2px #bbb;
}

.inactive .resize-stick {
  display: none;
}

.resize-stick-tl,
.resize-stick-br {
  cursor: nwse-resize;
}

.resize-stick-tm,
.resize-stick-bm {
  left: 50%;
  cursor: ns-resize;
}

.resize-stick-tr,
.resize-stick-bl {
  cursor: nesw-resize;
}

.resize-stick-ml,
.resize-stick-mr {
  top: 50%;
  cursor: ew-resize;
}

.resize-stick.not-resizable {
  display: none;
}

.content-container {
  position: relative;
  display: block;
}
</style>
