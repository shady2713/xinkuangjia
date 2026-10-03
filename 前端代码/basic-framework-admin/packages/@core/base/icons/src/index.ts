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
