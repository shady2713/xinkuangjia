<script lang="ts" setup>
/**
 * 声明式 Alert 组件：用 AlertDialog 组合标题、图标、
 * 内容与确认/取消按钮，供需要自定义插槽或自行
 * 控制 open 的场景；命令式调用请走 AlertBuilder。
 * beforeClose 返回 false 会拦截关闭，确认与取消
 * 经上下文暴露给内容区。
 */
import type { Component } from 'vue';

import type { AlertProps } from './alert';

import { computed, h, nextTick, ref } from 'vue';

import { useSimpleLocale } from '@vben-core/composables';
import {
  CircleAlert,
  CircleCheckBig,
  CircleHelp,
  CircleX,
  Info,
  X,
} from '@vben-core/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  VbenButton,
  VbenLoading,
  VbenRenderContent,
} from '@vben-core/shadcn-ui';
import { globalShareState } from '@vben-core/shared/global-state';
import { cn } from '@vben-core/shared/utils';

import { provideAlertContext } from './alert';

const props = withDefaults(defineProps<AlertProps>(), {
  bordered: true,
  buttonAlign: 'end',
  centered: true,
});
const emits = defineEmits(['closed', 'confirm', 'opened']);
const open = defineModel<boolean>('open', { default: false });
const { $t } = useSimpleLocale();
const components = globalShareState.getComponents();
const isConfirm = ref(false);

/**
 * 关闭动画播完时对外广播 closed，并把 isConfirm 复位，
 * 让下一次打开时不会沿用上一次的确认标记。
 */
function onAlertClosed() {
  emits('closed', isConfirm.value);
  isConfirm.value = false;
}

/** ESC 关闭属于取消路径，先把确认标记清掉，closed 事件才能报出取消。 */
function onEscapeKeyDown() {
  isConfirm.value = false;
}

/**
 * 按 props.icon 解析标题前的图标节点：字符串按语义色映射成内置图标，
 * 组件直接透传；未传 icon 或类型不匹配时得到 null，模板上不渲染图标。
 */
const getIconRender = computed(() => {
  let iconRender: Component | null = null;
  if (props.icon) {
    if (typeof props.icon === 'string') {
      switch (props.icon) {
        case 'error': {
          iconRender = h(CircleX, {
            style: { color: 'hsl(var(--destructive))' },
          });
          break;
        }
        case 'info': {
          iconRender = h(Info, { style: { color: 'hsl(var(--info))' } });
          break;
        }
        case 'question': {
          iconRender = CircleHelp;
          break;
        }
        case 'success': {
          iconRender = h(CircleCheckBig, {
            style: { color: 'hsl(var(--success))' },
          });
          break;
        }
        case 'warning': {
          iconRender = h(CircleAlert, {
            style: { color: 'hsl(var(--warning))' },
          });
          break;
        }
        default: {
          iconRender = null;
          break;
        }
      }
    }
  } else {
    iconRender = props.icon ?? null;
  }
  return iconRender;
});

/**
 * 暴露给内容区的取消动作：先标记为取消，再走统一的关闭流程，
 * 这样 beforeClose 收到的 isConfirm 才是 false。
 */
function doCancel() {
  handleCancel();
  handleOpenChange(false);
}

/** 暴露给内容区的确认动作：标记为确认后关闭，beforeClose 收到的 isConfirm 为 true。 */
function doConfirm() {
  handleConfirm();
  handleOpenChange(false);
}

provideAlertContext({
  doCancel,
  doConfirm,
});

/** 确认按钮与内容区确认共用：置位确认标记并广播 confirm 事件，关闭动作由调用方接着发起。 */
function handleConfirm() {
  isConfirm.value = true;
  emits('confirm');
}

/** 取消按钮、关闭按钮与 ESC 共用：清掉确认标记，不直接改 open。 */
function handleCancel() {
  isConfirm.value = false;
}

const loading = ref(false);
/**
 * open 变化的统一入口：关闭方向且配了 beforeClose 时先等它放行，
 * 期间打开 loading 遮罩，只有返回值不是 false 才真正写入 open。
 * @param val 目标打开状态；false 表示本次是关闭，true 表示直接打开。
 */
async function handleOpenChange(val: boolean) {
  await nextTick(); // 等待标记isConfirm状态
  if (!val && props.beforeClose) {
    loading.value = true;
    try {
      const res = await props.beforeClose({ isConfirm: isConfirm.value });
      if (res !== false) {
        open.value = false;
      }
    } finally {
      loading.value = false;
    }
  } else {
    open.value = val;
  }
}
</script>
<template>
  <AlertDialog :open="open" @update:open="handleOpenChange">
    <AlertDialogContent
      :open="open"
      :centered="centered"
      :overlay-blur="overlayBlur"
      @opened="emits('opened')"
      @closed="onAlertClosed"
      @escape-key-down="onEscapeKeyDown"
      :class="
        cn(
          containerClass,
          'left-0 right-0 mx-auto flex max-h-[80%] flex-col p-0 duration-300 sm:w-[520px] sm:max-w-[80%] sm:rounded-[var(--radius)]',
          {
            'border border-border': bordered,
            'shadow-3xl': !bordered,
          },
        )
      "
    >
      <div :class="cn('relative flex-1 overflow-y-auto p-3', contentClass)">
        <AlertDialogTitle v-if="title">
          <div class="flex items-center">
            <component :is="getIconRender" class="mr-2" />
            <span class="flex-auto">{{ $t(title) }}</span>
            <AlertDialogCancel v-if="showCancel" as-child>
              <VbenButton
                variant="ghost"
                size="icon"
                class="rounded-full"
                :disabled="loading"
                @click="handleCancel"
              >
                <X class="size-4 text-muted-foreground" />
              </VbenButton>
            </AlertDialogCancel>
          </div>
        </AlertDialogTitle>
        <AlertDialogDescription>
          <div class="m-4 min-h-[30px]">
            <VbenRenderContent :content="content" render-br />
          </div>
          <VbenLoading v-if="loading && contentMasking" :spinning="loading" />
        </AlertDialogDescription>
        <div
          class="flex items-center justify-end gap-x-2"
          :class="`justify-${buttonAlign}`"
        >
          <VbenRenderContent :content="footer" />
          <AlertDialogCancel v-if="showCancel" as-child>
            <component
              :is="components.DefaultButton || VbenButton"
              :disabled="loading"
              variant="ghost"
              @click="handleCancel"
            >
              {{ cancelText || $t('cancel') }}
            </component>
          </AlertDialogCancel>
          <AlertDialogAction as-child>
            <component
              :is="components.PrimaryButton || VbenButton"
              :loading="loading"
              @click="handleConfirm"
            >
              {{ confirmText || $t('confirm') }}
            </component>
          </AlertDialogAction>
        </div>
      </div>
    </AlertDialogContent>
  </AlertDialog>
</template>
