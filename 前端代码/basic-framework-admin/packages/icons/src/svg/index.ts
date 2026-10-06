/**
 * 本地 svg 图标出口：先副作用引入 load.ts 把 ./icons 下的 svg 注册为
 * svg: 前缀图标，再用这些图标名生成 SvgBellIcon、SvgAvatar1Icon 等具名组件。
 */
import { createIconifyIcon } from '@vben-core/icons';

import './load.js';

const SvgAvatar1Icon = createIconifyIcon('svg:avatar-1');
const SvgAvatar2Icon = createIconifyIcon('svg:avatar-2');
const SvgAvatar3Icon = createIconifyIcon('svg:avatar-3');
const SvgAvatar4Icon = createIconifyIcon('svg:download');
const SvgDownloadIcon = createIconifyIcon('svg:download');
const SvgCardIcon = createIconifyIcon('svg:card');
const SvgBellIcon = createIconifyIcon('svg:bell');
const SvgCakeIcon = createIconifyIcon('svg:cake');
const SvgGoogleIcon = createIconifyIcon('svg:google');

export {
  SvgAvatar1Icon,
  SvgAvatar2Icon,
  SvgAvatar3Icon,
  SvgAvatar4Icon,
  SvgBellIcon,
  SvgCakeIcon,
  SvgCardIcon,
  SvgDownloadIcon,
  SvgGoogleIcon,
};
