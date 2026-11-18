import type { SetupVxeTable } from './types';

import { defineComponent, watch } from 'vue';

import { usePreferences } from '@vben/preferences';

import { useVbenForm } from '@vben-core/form-ui';

import {
  VxeButton,
  VxeCheckbox,
  VxeIcon,
  VxeInput,
  VxeLoading,
  VxePager,
  VxeTooltip,
  VxeUI,
} from 'vxe-pc-ui';
import enUS from 'vxe-pc-ui/lib/language/en-US';
import zhCN from 'vxe-pc-ui/lib/language/zh-CN';
import {
  VxeColgroup,
  VxeColumn,
  VxeGrid,
  VxeTable,
  VxeToolbar,
} from 'vxe-table';

import { extendsDefaultFormatter } from './extends';

let isInit = false;

// eslint-disable-next-line import/no-mutable-exports
export let useTableForm: typeof useVbenForm;

/** 构造虚拟占位组件以跳过未使用的 VxeForm 全量脚本打包。 */
const createVirtualComponent = (name = '') => {
  return defineComponent({
    name,
  });
};

/** 按需注册管理后台表格实际使用的 VxeTable 与 VxeUI 核心单元。 */
export function initVxeTable() {
  if (isInit) {
    return;
  }

  VxeUI.component(VxeTable);
  VxeUI.component(VxeColumn);
  VxeUI.component(VxeColgroup);
  VxeUI.component(VxeGrid);
  VxeUI.component(VxeToolbar);

  VxeUI.component(VxeButton);
  VxeUI.component(VxeCheckbox);
  VxeUI.component(createVirtualComponent('VxeForm'));
  VxeUI.component(VxeIcon);
  VxeUI.component(VxeInput);
  VxeUI.component(VxeLoading);
  VxeUI.component(VxePager);
  VxeUI.component(VxeTooltip);

  isInit = true;
}

/**
 * 初始化 VxeTable 主题、语言包、默认格式化器及业务侧配置回调。
 *
 * @param setupOptions VxeTable 初始化回调与表单构建器选项
 */
export function setupVbenVxeTable(setupOptions: SetupVxeTable) {
  const { configVxeTable, useVbenForm } = setupOptions;

  initVxeTable();
  useTableForm = useVbenForm;

  const { isDark, locale } = usePreferences();

  const localMap = {
    'zh-CN': zhCN,
    'en-US': enUS,
  };

  watch(
    [() => isDark.value, () => locale.value],
    ([isDarkValue, localeValue]) => {
      VxeUI.setTheme(isDarkValue ? 'dark' : 'light');
      VxeUI.setI18n(localeValue, localMap[localeValue]);
      VxeUI.setLanguage(localeValue);
    },
    {
      immediate: true,
    },
  );

  extendsDefaultFormatter(VxeUI);

  configVxeTable(VxeUI);
}
