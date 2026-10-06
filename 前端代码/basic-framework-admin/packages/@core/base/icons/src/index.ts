/**
 * 图标包入口：模块加载时把 lucide 全集注册进 iconify，供按名取用。
 * 对外提供图标工厂、精选图标清单，以及 addIcon、addCollection、
 * IconifyIcon、listIcons 原语；其余图标集需使用方自行注册。
 */
import lucideIcons from '@iconify/json/json/lucide.json';
import {
  addCollection,
  addIcon,
  Icon as IconifyIcon,
  listIcons,
} from '@iconify/vue';

addCollection(lucideIcons);

export * from './create-icon';

export * from './lucide';

export type { IconifyIcon as IconifyIconStructure } from '@iconify/vue';
export { addCollection, addIcon, IconifyIcon, listIcons };
