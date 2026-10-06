/**
 * form-create 插件装配：注册字典、部门、用户等设计器自定义组件
 * 与一批 element-plus 组件，使 JSON 表单能按组件名解析控件。
 * 只在应用启动时执行一次，表单取值与提交由业务页面负责。
 */
import type { App, Component } from 'vue';

import formCreate from '@form-create/element-ui';
import install from '@form-create/element-ui/auto-import';
// 使用 form-create 需额外全局引入 element plus 组件
import {
  ElAlert,
  ElAside,
  ElBadge,
  ElCard,
  ElCollapse,
  ElCollapseItem,
  ElContainer,
  ElDivider,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElFooter,
  ElHeader,
  ElMain,
  ElMenu,
  ElMenuItem,
  ElMessage,
  ElPopconfirm,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTag,
  ElText,
  ElTransfer,
} from 'element-plus';

// ======================= 自定义组件 =======================
import { useApiSelect } from '#/components/form-create';
import DeptSelect from '#/components/form-create/components/dept-select.vue';
import DictSelect from '#/components/form-create/components/dict-select.vue';
import IframeComponent from '#/components/form-create/components/iframe.vue';
import { useImagesUpload } from '#/components/form-create/components/use-images-upload';
import { FileUpload, ImageUpload } from '#/components/upload';

const UserSelect = useApiSelect({
  name: 'UserSelect',
  labelField: 'nickname',
  valueField: 'id',
  url: '/system/user/simple-list',
});
const ApiSelect = useApiSelect({
  name: 'ApiSelect',
});
const ImagesUpload = useImagesUpload();

const components = [
  ImageUpload,
  ImagesUpload,
  FileUpload,
  DictSelect,
  UserSelect,
  DeptSelect,
  ApiSelect,
  IframeComponent,
  ElAlert,
  ElTransfer,
  ElAside,
  ElContainer,
  ElDivider,
  ElHeader,
  ElMain,
  ElPopconfirm,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElBadge,
  ElTag,
  ElText,
  ElMenu,
  ElMenuItem,
  ElFooter,
  ElMessage,
  ElCollapse,
  ElCollapseItem,
  ElCard,
];

/**
 * 注册 form-create 所需的组件与运行时，使 JSON 描述的表单能按组件名解析到具体控件。
 *
 * components 中的组件按各自的 name 全局注册，名称冲突时后注册者覆盖先注册者。
 *
 * 参考 http://www.form-create.com/v3/element-ui/auto-import.html 文档
 *
 * @param app 待安装 form-create 的应用实例
 */
export const setupFormCreate = (app: App<Element>) => {
  components.forEach((component) => {
    app.component(component.name as string, component as Component);
  });
  formCreate.use(install);
  app.use(formCreate);
};
