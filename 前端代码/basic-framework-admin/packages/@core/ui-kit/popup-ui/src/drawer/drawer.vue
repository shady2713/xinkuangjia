<script lang="ts" setup>
/**
 * 抽屉视图：按 DrawerApi 的状态渲染 Sheet 的方向、
 * 遮罩、页头页脚与按钮；确认、取消转发给 api 回调，
 * 关闭动画缺失时用兜底定时器收口 onClosed。
 * 供 useVbenDrawer 生成受控抽屉，关闭条件与状态
 * 判定在 drawer-api.ts。
 */
import type { DrawerProps, ExtendedDrawerApi } from './drawer';

import {
  computed,
  onDeactivated,
  onUnmounted,
  provide,
  ref,
  unref,
  useId,
  watch,
} from 'vue';

import {
  useIsMobile,
  usePriorityValues,
  useSimpleLocale,
} from '@vben-core/composables';
import { X } from '@vben-core/icons';
import {
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  VbenButton,
  VbenHelpTooltip,
  VbenIconButton,
  VbenLoading,
  VisuallyHidden,
} from '@vben-core/shadcn-ui';
import { ELEMENT_ID_MAIN_CONTENT } from '@vben-core/shared/constants';
import { globalShareState } from '@vben-core/shared/global-state';
import { cn } from '@vben-core/shared/utils';

/**
 * 抽屉视图的属性契约：在 DrawerProps 之外补一个可选的 drawerApi。
 * 传入 API 时视图订阅它的状态，并把确认、取消、关闭动作转发回 API；
 * 不传时只按 props 渲染，状态订阅与回调转发都不会发生。
 */
interface Props extends DrawerProps {
  drawerApi?: ExtendedDrawerApi;
}

const props = withDefaults(defineProps<Props>(), {
  appendToMain: false,
  closeIconPlacement: 'right',
  destroyOnClose: false,
  drawerApi: undefined,
  submitting: false,
  zIndex: 1000,
});

const components = globalShareState.getComponents();

const id = useId();
provide('DISMISSABLE_DRAWER_ID', id);

// @ts-expect-error unused
const wrapperRef = ref<HTMLElement>();
const { $t } = useSimpleLocale();
const { isMobile } = useIsMobile();

const state = props.drawerApi?.useStore?.();

const {
  appendToMain,
  cancelText,
  class: drawerClass,
  closable,
  closeIconPlacement,
  closeOnClickModal,
  closeOnPressEscape,
  confirmLoading,
  confirmText,
  contentClass,
  description,
  destroyOnClose,
  footer: showFooter,
  footerClass,
  header: showHeader,
  headerClass,
  loading: showLoading,
  modal,
  openAutoFocus,
  overlayBlur,
  placement,
  showCancelButton,
  showConfirmButton,
  submitting,
  title,
  titleTooltip,
  zIndex,
} = usePriorityValues(props, state);

// watch(
//   () => showLoading.value,
//   (v) => {
//     if (v && wrapperRef.value) {
//       wrapperRef.value.scrollTo({
//         // behavior: 'smooth',
//         top: 0,
//       });
//     }
//   },
// );

/**
 * 在开启keepAlive情况下 直接通过浏览器按钮/手势等返回 不会关闭弹窗
 */
onDeactivated(() => {
  // 如果弹窗没有被挂载到内容区域，则关闭弹窗
  if (!appendToMain.value) {
    props.drawerApi?.close();
  }
});

/**
 * 交互发生在抽屉外部时决定是否拦截：closeOnClickModal 为假或正处于提交等待中时阻止默认行为，
 * 避免误触遮罩把正在提交的抽屉关掉。
 */
function interactOutside(e: Event) {
  if (!closeOnClickModal.value || submitting.value) {
    e.preventDefault();
  }
}

/** 按下 ESC 时按同样口径拦截：closeOnPressEscape 为假或提交中时，不放行 ESC 带来的关闭动作。 */
function escapeKeyDown(e: KeyboardEvent) {
  if (!closeOnPressEscape.value || submitting.value) {
    e.preventDefault();
  }
}
// pointer-down-outside
/**
 * 指针按下落在抽屉外部时判断是否拦截：提交中、已关闭点击遮罩关闭，
 * 或按下位置带的抽屉标记与当前 id 不一致时，都阻止默认行为。
 */
function pointerDownOutside(e: Event) {
  const target = e.target as HTMLElement;
  const dismissableDrawer = target?.dataset.dismissableDrawer;
  if (
    submitting.value ||
    !closeOnClickModal.value ||
    dismissableDrawer !== id
  ) {
    e.preventDefault();
  }
}

/** 抽屉打开时决定是否接管初始焦点：未开启 openAutoFocus 时拦掉自动聚焦，焦点留给用户手动切换。 */
function handerOpenAutoFocus(e: Event) {
  if (!openAutoFocus.value) {
    e?.preventDefault();
  }
}

/**
 * 打开与关闭两个方向的焦点事件都不做处理：同时阻止默认行为与冒泡，
 * 避免焦点被移出抽屉或穿透到背后的内容。
 */
function handleFocusOutside(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

/**
 * 关闭按钮的点击入口：交给 api.close() 先过 onBeforeClose 校验，
 * 确认允许关闭后立刻收口关闭状态，不必再等关闭动画事件才隐藏内容。
 */
async function handleClose() {
  // 自定义图标按钮不再依赖 SheetClose 的 as-child 事件透传，避免关闭事件被组件封装吞掉。
  await props.drawerApi?.close();
  if (!props.drawerApi?.store.state.isOpen) {
    // X 按钮关闭需要即时反馈；确认允许关闭后立刻隐藏抽屉内容，不再等待动画兜底。
    markClosed();
  }
}

/**
 * 抽屉的挂载点选择器：appendToMain 为真时挂到主内容区下一个非绝对定位 div 的内部，
 * 让抽屉随布局一起滚动；缺省为 undefined，交给 Sheet 自行决定挂载位置。
 */
const getAppendTo = computed(() => {
  return appendToMain.value
    ? `#${ELEMENT_ID_MAIN_CONTENT}>div:not(.absolute)>div`
    : undefined;
});

/**
 * destroyOnClose功能完善
 */
// 是否打开过
const hasOpened = ref(false);
const isClosed = ref(true);
let closeFallbackTimer: ReturnType<typeof setTimeout> | undefined;

/** 清掉关闭兜底定时器，避免抽屉重新打开后仍被上一轮的兜底回调误判为已关闭。 */
function clearCloseFallbackTimer() {
  if (!closeFallbackTimer) {
    return;
  }
  clearTimeout(closeFallbackTimer);
  closeFallbackTimer = undefined;
}

/**
 * 关闭完成的统一收口：已收口时直接返回，只在首次执行时置位 isClosed 并转发 onClosed，
 * 避免关闭动画回调与兜底定时器都触发时上层回调被执行两次。
 */
function markClosed() {
  // 关闭动画回调和兜底定时器都可能触发，这里统一收口，避免重复执行 onClosed。
  if (isClosed.value) {
    return;
  }
  clearCloseFallbackTimer();
  isClosed.value = true;
  props.drawerApi?.onClosed();
}

watch(
  () => state?.value?.isOpen,
  (value) => {
    clearCloseFallbackTimer();
    if (value) {
      isClosed.value = false;
      if (!unref(hasOpened)) {
        hasOpened.value = true;
      }
      return;
    }

    if (unref(hasOpened)) {
      // 部分场景下 Reka 的关闭动画事件不会触发，增加兜底避免遮罩已关闭但抽屉内容残留。
      closeFallbackTimer = setTimeout(markClosed, 350);
    }
  },
);
/** 关闭动画播放完毕的回调：转入 markClosed，与兜底定时器共用同一条收口路径。 */
function handleClosed() {
  markClosed();
}
onUnmounted(clearCloseFallbackTimer);
/**
 * 是否让 Sheet 常驻 DOM：未开启 destroyOnClose 且抽屉打开过一次时保持挂载，
 * 关闭后只靠 isClosed 隐藏内容，这样反复打开不会丢失抽屉内部状态。
 */
const getForceMount = computed(() => {
  return !unref(destroyOnClose) && unref(hasOpened);
});
</script>
<template>
  <Sheet
    :modal="false"
    :open="state?.isOpen"
    @update:open="() => drawerApi?.close()"
  >
    <SheetContent
      :append-to="getAppendTo"
      :class="
        cn('flex w-[520px] flex-col', drawerClass, {
          '!w-full': isMobile || placement === 'bottom' || placement === 'top',
          'max-h-[100vh]': placement === 'bottom' || placement === 'top',
          hidden: isClosed,
        })
      "
      :modal="modal"
      :open="state?.isOpen"
      :side="placement"
      :z-index="zIndex"
      :force-mount="getForceMount"
      :overlay-blur="overlayBlur"
      @close-auto-focus="handleFocusOutside"
      @closed="handleClosed"
      @escape-key-down="escapeKeyDown"
      @focus-outside="handleFocusOutside"
      @interact-outside="interactOutside"
      @open-auto-focus="handerOpenAutoFocus"
      @opened="() => drawerApi?.onOpened()"
      @pointer-down-outside="pointerDownOutside"
    >
      <SheetHeader
        v-if="showHeader"
        :class="
          cn(
            '!flex flex-row items-center justify-between border-b px-6 py-5',
            headerClass,
            {
              'px-4 py-3': closable,
              'pl-2': closable && closeIconPlacement === 'left',
            },
          )
        "
      >
        <div class="flex items-center">
          <VbenIconButton
            v-if="closable && closeIconPlacement === 'left'"
            :disabled="submitting"
            class="ml-[2px] cursor-pointer rounded-full opacity-80 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none data-[state=open]:bg-secondary"
            @click.stop="handleClose"
          >
            <slot name="close-icon">
              <X class="size-4" />
            </slot>
          </VbenIconButton>
          <Separator
            v-if="closable && closeIconPlacement === 'left'"
            class="ml-1 mr-2 h-8"
            decorative
            orientation="vertical"
          />
          <SheetTitle v-if="title" class="text-left">
            <slot name="title">
              {{ title }}

              <VbenHelpTooltip v-if="titleTooltip" trigger-class="pb-1">
                {{ titleTooltip }}
              </VbenHelpTooltip>
            </slot>
          </SheetTitle>
          <SheetDescription v-if="description" class="mt-1 text-xs">
            <slot name="description">
              {{ description }}
            </slot>
          </SheetDescription>
        </div>

        <VisuallyHidden v-if="!title || !description">
          <SheetTitle v-if="!title" />
          <SheetDescription v-if="!description" />
        </VisuallyHidden>

        <div class="flex-center">
          <slot name="extra"></slot>
          <VbenIconButton
            v-if="closable && closeIconPlacement === 'right'"
            :disabled="submitting"
            class="ml-[2px] cursor-pointer rounded-full opacity-80 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none data-[state=open]:bg-secondary"
            @click.stop="handleClose"
          >
            <slot name="close-icon">
              <X class="size-4" />
            </slot>
          </VbenIconButton>
        </div>
      </SheetHeader>
      <template v-else>
        <VisuallyHidden>
          <SheetTitle />
          <SheetDescription />
        </VisuallyHidden>
      </template>
      <div
        ref="wrapperRef"
        :class="
          cn('relative flex-1 overflow-y-auto p-3', contentClass, {
            'pointer-events-none': showLoading || submitting,
          })
        "
      >
        <slot></slot>
      </div>
      <VbenLoading v-if="showLoading || submitting" spinning />
      <SheetFooter
        v-if="showFooter"
        :class="
          cn(
            'w-full flex-row items-center justify-end border-t p-2 px-3',
            footerClass,
          )
        "
      >
        <slot name="prepend-footer"></slot>
        <slot name="footer">
          <component
            :is="components.DefaultButton || VbenButton"
            v-if="showCancelButton"
            variant="ghost"
            :disabled="submitting"
            @click="() => drawerApi?.onCancel()"
          >
            <slot name="cancelText">
              {{ cancelText || $t('cancel') }}
            </slot>
          </component>
          <slot name="center-footer"></slot>
          <component
            :is="components.PrimaryButton || VbenButton"
            v-if="showConfirmButton"
            :loading="confirmLoading || submitting"
            @click="() => drawerApi?.onConfirm()"
          >
            <slot name="confirmText">
              {{ confirmText || $t('confirm') }}
            </slot>
          </component>
        </slot>
        <slot name="append-footer"></slot>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
