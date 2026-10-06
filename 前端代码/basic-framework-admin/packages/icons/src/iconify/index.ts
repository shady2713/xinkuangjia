/**
 * 在线图标集：转出 @vben-core/icons 的基础图标能力，并把本项目用到的
 * mdi、material-symbols、tabler、ant-design 图标注册为具名组件。
 * 本地 svg 图标不在这里，见 ../svg。
 */
import { createIconifyIcon } from '@vben-core/icons';

export * from '@vben-core/icons';

/** 键盘 Esc 键图标，用于提示按 Esc 关闭当前浮层。 */
export const MdiKeyboardEsc = createIconifyIcon('mdi:keyboard-esc');

/** Google 品牌图标，用于第三方登录入口。 */
export const MdiGoogle = createIconifyIcon('mdi:google');

/** 圆圈内打勾的描边图标，表示已通过校验或已完成。 */
export const MdiCheckboxMarkedCircleOutline = createIconifyIcon(
  'mdi:checkbox-marked-circle-outline',
);

/** 圆角刷新箭头图标，用于重新加载当前视图或数据。 */
export const MsRefresh = createIconifyIcon('material-symbols:refresh-rounded');

/** 向内收拢的箭头图标，用于最小化面板或退出全屏。 */
export const TMinimize = createIconifyIcon('tabler:arrows-minimize');

/** 人物描边图标，用于个人资料入口。 */
export const AntdProfileOutlined = createIconifyIcon(
  'ant-design:profile-outlined',
);

/** 打开的文件夹图标，用于目录类操作。 */
export const FolderOpenOutlined = createIconifyIcon(
  'ant-design:folder-open-outlined',
);

/** 下载箭头图标，用于导出或下载附件。 */
export const DownloadOutlined = createIconifyIcon(
  'ant-design:download-outlined',
);

/** 眼睛图标，用于查看详情或切换明文显示。 */
export const EyeOutlined = createIconifyIcon('ant-design:eye-outlined');

/** 接口字样图标，用于 API 相关菜单与操作。 */
export const ApiOutlined = createIconifyIcon('ant-design:api-outlined');

/** 放大镜带减号图标，用于缩小预览。 */
export const ZoomOutOutlined = createIconifyIcon(
  'ant-design:zoom-out-outlined',
);

/** 放大镜带加号图标，用于放大预览。 */
export const ZoomInOutlined = createIconifyIcon('ant-design:zoom-in-outlined');

/** 左弯箭头图标，用于撤销上一步编辑。 */
export const UndoOutlined = createIconifyIcon('ant-design:undo-outlined');

/** 右弯箭头图标，用于恢复被撤销的编辑。 */
export const RedoOutlined = createIconifyIcon('ant-design:redo-outlined');

/** 循环箭头图标，用于重新加载数据。 */
export const ReloadOutlined = createIconifyIcon('ant-design:reload-outlined');

/** 左对齐横线图标，用于文本或布局左对齐。 */
export const AlignLeftOutlined = createIconifyIcon(
  'ant-design:align-left-outlined',
);

/** 三角感叹号图标，用于提示风险或异常状态。 */
export const WarningOutlined = createIconifyIcon('ant-design:warning-outlined');

/** 三条横线图标，用于展开或收起导航菜单。 */
export const MenuOutlined = createIconifyIcon('ant-design:menu-outlined');

/** 加号图标，用于新增记录或添加条目。 */
export const PlusOutlined = createIconifyIcon('ant-design:plus-outlined');

/** 实心圆内叉号图标，用于移除已选项或清空条件。 */
export const CloseCircleFilled = createIconifyIcon(
  'ant-design:close-circle-filled',
);

/** 勾选图标，用于确认选中当前项。 */
export const SelectOutlined = createIconifyIcon('ant-design:select-outlined');
