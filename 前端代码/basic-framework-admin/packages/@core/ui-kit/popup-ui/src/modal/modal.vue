<script lang="ts" setup>
/**
 * 弹窗视图：按 ModalApi 的状态渲染 Dialog 的标题、
 * 内容、页脚与遮罩。移动端自动全屏，全屏时关闭
 * 居中与拖拽；拖拽逻辑来自 use-modal-draggable。
 * 确认与取消转发给 api 回调；供 useVbenModal
 * 生成受控弹窗，状态流转与关闭拦截在 modal-api.ts。
 */
import type { ExtendedModalApi, ModalProps } from './modal';

import {
  computed,
  nextTick,
  onDeactivated,
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
import { Expand, Shrink } from '@vben-core/icons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  VbenButton,
  VbenHelpTooltip,
  VbenIconButton,
  VbenLoading,
  VisuallyHidden,
} from '@vben-core/shadcn-ui';
import { ELEMENT_ID_MAIN_CONTENT } from '@vben-core/shared/constants';
import { globalShareState } from '@vben-core/shared/global-state';
import { cn } from '@vben-core/shared/utils';

import { useModalDraggable } from './use-modal-draggable';

/**
 * modal.vue 自身的 props：在 ModalProps 之外多接一个 modalApi，
 * 视图的状态读写都走它；不传 api 时相关的交互会静默失效。
 */
interface Props extends ModalProps {
  modalApi?: ExtendedModalApi;
}

const props = withDefaults(defineProps<Props>(), {
  appendToMain: false,
  destroyOnClose: false,
  modalApi: undefined,
});

const components = globalShareState.getComponents();

const contentRef = ref();
// @ts-expect-error unused
const wrapperRef = ref<HTMLElement>();
const dialogRef = ref();
const headerRef = ref();
// @ts-expect-error unused
const footerRef = ref();

const id = useId();

provide('DISMISSABLE_MODAL_ID', id);

const { $t } = useSimpleLocale();
const { isMobile } = useIsMobile();
const state = props.modalApi?.useStore?.();

const {
  appendToMain,
  bordered,
  cancelText,
  centered,
  class: modalClass,
  closable,
  closeOnClickModal,
  closeOnPressEscape,
  confirmDisabled,
  confirmLoading,
  confirmText,
  contentClass,
  description,
  destroyOnClose,
  draggable,
  footer: showFooter,
  footerClass,
  fullscreen,
  fullscreenButton,
  header,
  headerClass,
  loading: showLoading,
  modal,
  openAutoFocus,
  overlayBlur,
  showCancelButton,
  showConfirmButton,
  submitting,
  title,
  titleTooltip,
  animationType,
  zIndex,
} = usePriorityValues(props, state);

/** 全屏的最终判定：显式打开 fullscreen 或处于移动端都算全屏，移动端无法被 centered 之类的配置覆盖。 */
const shouldFullscreen = computed(() => fullscreen.value || isMobile.value);

/** 拖拽开关的最终判定：可拖拽、未全屏、且渲染了标题栏三者同时成立才会绑手柄。 */
const shouldDraggable = computed(
  () => draggable.value && !shouldFullscreen.value && header.value,
);

/** 居中的最终判定：全屏时固定铺满，忽略 centered，因此全屏与居中互斥。 */
const shouldCentered = computed(
  () => centered.value && !shouldFullscreen.value,
);

/** 挂载目标选择器：appendToMain 为真时挂进主内容区，否则留在 Dialog 的默认位置。 */
const getAppendTo = computed(() => {
  return appendToMain.value
    ? `#${ELEMENT_ID_MAIN_CONTENT}>div:not(.absolute)>div`
    : undefined;
});

const { dragging, transform } = useModalDraggable(
  dialogRef,
  headerRef,
  shouldDraggable,
  getAppendTo,
  shouldCentered,
);

const firstOpened = ref(false);
const isClosed = ref(true);

watch(
  () => state?.value?.isOpen,
  async (v) => {
    if (v) {
      isClosed.value = false;
      if (!firstOpened.value) firstOpened.value = true;
      await nextTick();
      if (!contentRef.value) return;
      const innerContentRef = contentRef.value.getContentRef();
      dialogRef.value = innerContentRef.$el;
      // reopen modal reassign value
      const { offsetX, offsetY } = transform;
      dialogRef.value.style.transform = shouldCentered.value
        ? `translate(${offsetX}px, calc(-50% + ${offsetY}px))`
        : `translate(${offsetX}px, ${offsetY}px)`;
    }
  },
  { immediate: true },
);

// watch(
//   () => [showLoading.value, submitting.value],
//   ([l, s]) => {
//     if ((s || l) && wrapperRef.value) {
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
    props.modalApi?.close();
  }
});

/** 全屏按钮的点击处理：以函数式更新翻转 store 里的 fullscreen，居中与拖拽会随之自动失效。 */
function handleFullscreen() {
  props.modalApi?.setState((prev) => {
    // if (prev.fullscreen) {
    //   resetPosition();
    // }
    return { ...prev, fullscreen: !fullscreen.value };
  });
}
/** 遮罩被点按时决定是否放行：禁止点遮罩关闭或处于提交中时阻止事件，锁定期间不会被误关。 */
function interactOutside(e: Event) {
  if (!closeOnClickModal.value || submitting.value) {
    e.preventDefault();
    e.stopPropagation();
  }
}
/** ESC 关闭的放行判断：禁止 ESC 关闭或提交中时阻止默认行为，锁定期间按 ESC 无效。 */
function escapeKeyDown(e: KeyboardEvent) {
  if (!closeOnPressEscape.value || submitting.value) {
    e.preventDefault();
  }
}

/** 未开启 openAutoFocus 时拦掉打开即聚焦，避免弹窗一出现就抢走输入焦点。 */
function handleOpenAutoFocus(e: Event) {
  if (!openAutoFocus.value) {
    e?.preventDefault();
  }
}

// pointer-down-outside
/**
 * 外部按下的最终拦截：只有按到本弹窗自己的遮罩、允许点遮罩关闭且不在提交中时才放行。
 * 嵌套弹窗靠 data-dismissable-modal 与本弹窗的 id 比对来区分归属。
 */
function pointerDownOutside(e: Event) {
  const target = e.target as HTMLElement;
  const isDismissableModal = target?.dataset.dismissableModal;
  if (
    !closeOnClickModal.value ||
    isDismissableModal !== id ||
    submitting.value
  ) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/** 焦点移出弹窗时一律拦截，弹窗内的表单控件因此不会因为点击外部而丢焦点。 */
function handleFocusOutside(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

/** 首次打开之后且不是用完即销毁时让内容常驻 DOM，关闭期间靠 hidden 隐藏，重开可保留内部状态。 */
const getForceMount = computed(() => {
  return !unref(destroyOnClose) && unref(firstOpened);
});

/** 打开动画播完才通知 api：多等一帧，确保回调触发时弹窗已经完整可见。 */
const handleOpened = () => {
  requestAnimationFrame(() => {
    props.modalApi?.onOpened();
  });
};

/** 关闭动画播完时标记为已关闭并转发给 api，模板据此加上 hidden 把残留内容藏起来。 */
function handleClosed() {
  isClosed.value = true;
  props.modalApi?.onClosed();
}
</script>
<template>
  <Dialog
    :modal="false"
    :open="state?.isOpen"
    @update:open="() => (!submitting ? modalApi?.close() : undefined)"
  >
    <DialogContent
      ref="contentRef"
      :append-to="getAppendTo"
      :class="
        cn(
          'left-0 right-0 top-[10vh] mx-auto flex max-h-[80%] w-[520px] flex-col p-0',
          shouldFullscreen ? 'sm:rounded-none' : 'sm:rounded-[var(--radius)]',
          modalClass,
          {
            'border border-border': bordered,
            'shadow-3xl': !bordered,
            'left-0 top-0 size-full max-h-full !translate-x-0 !translate-y-0':
              shouldFullscreen,
            'top-1/2': centered && !shouldFullscreen,
            'duration-300': !dragging,
            hidden: isClosed,
          },
        )
      "
      :force-mount="getForceMount"
      :modal="modal"
      :open="state?.isOpen"
      :show-close="closable"
      :animation-type="animationType"
      :z-index="zIndex"
      :overlay-blur="overlayBlur"
      close-class="top-3"
      @close-auto-focus="handleFocusOutside"
      @closed="handleClosed"
      :close-disabled="submitting"
      @escape-key-down="escapeKeyDown"
      @focus-outside="handleFocusOutside"
      @interact-outside="interactOutside"
      @open-auto-focus="handleOpenAutoFocus"
      @opened="handleOpened"
      @pointer-down-outside="pointerDownOutside"
    >
      <DialogHeader
        ref="headerRef"
        :class="
          cn(
            'px-5 py-4',
            {
              'border-b': bordered,
              hidden: !header,
              'cursor-move select-none': shouldDraggable,
            },
            headerClass,
          )
        "
      >
        <DialogTitle v-if="title" class="text-left">
          <slot name="title">
            {{ title }}

            <slot v-if="titleTooltip" name="titleTooltip">
              <VbenHelpTooltip trigger-class="pb-1">
                {{ titleTooltip }}
              </VbenHelpTooltip>
            </slot>
          </slot>
        </DialogTitle>
        <DialogDescription v-if="description">
          <slot name="description">
            {{ description }}
          </slot>
        </DialogDescription>
        <VisuallyHidden v-if="!title || !description">
          <DialogTitle v-if="!title" />
          <DialogDescription v-if="!description" />
        </VisuallyHidden>
      </DialogHeader>
      <div
        ref="wrapperRef"
        :class="
          cn('relative min-h-40 flex-1 overflow-y-auto p-3', contentClass, {
            'pointer-events-none': showLoading || submitting,
          })
        "
      >
        <slot></slot>
      </div>
      <VbenLoading v-if="showLoading || submitting" spinning />
      <VbenIconButton
        v-if="fullscreenButton"
        class="flex-center absolute right-10 top-3 hidden size-6 rounded-full px-1 text-lg text-foreground/80 opacity-70 transition-opacity hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus:outline-none disabled:pointer-events-none sm:block"
        @click="handleFullscreen"
      >
        <Shrink v-if="fullscreen" class="size-3.5" />
        <Expand v-else class="size-3.5" />
      </VbenIconButton>

      <DialogFooter
        ref="footerRef"
        v-if="showFooter"
        :class="
          cn(
            'flex-row items-center justify-end p-2',
            {
              'border-t': bordered,
            },
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
            @click="() => modalApi?.onCancel()"
          >
            <slot name="cancelText">
              {{ cancelText || $t('cancel') }}
            </slot>
          </component>
          <slot name="center-footer"></slot>
          <component
            :is="components.PrimaryButton || VbenButton"
            v-if="showConfirmButton"
            :disabled="confirmDisabled"
            :loading="confirmLoading || submitting"
            @click="() => modalApi?.onConfirm()"
          >
            <slot name="confirmText">
              {{ confirmText || $t('confirm') }}
            </slot>
          </component>
        </slot>
        <slot name="append-footer"></slot>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
