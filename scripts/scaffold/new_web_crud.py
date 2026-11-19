#!/usr/bin/env python3
"""确定性前端 CRUD 页面脚手架：一键生成 API、VxeGrid 列表页、Modal 表单、Vitest 单测及兼容门禁的菜单 SQL。

默认只读预览（--dry-run），仅在显式传入 --apply 时写入文件。
生成代码严格遵循 Vue Vben Admin 5 + Element Plus 规范、weetion/comments 中文注释门禁、
64 位主键与 epoch-ms 时间戳契约，以及 SchemaDoRbacParityTest 菜单 SQL 契约；
同步后端 OpenAPI 快照并运行 pnpm api:gen 后，可直接替换接口模型为 OpenApiSchemas。

用法：
  python -B -X utf8 scripts/scaffold/new_web_crud.py crm customer --title 客户
  python -B -X utf8 scripts/scaffold/new_web_crud.py --module crm --entity customer --title 客户 --apply

@author shady2713
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.dont_write_bytecode = True

DEFAULT_ROOT = Path(__file__).resolve().parents[2]
SEGMENT_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
MENU_ID_RE = re.compile(r"INSERT\s+INTO\s+`system_menu`\s+VALUES\s*\((\d+),")
ROLE_MENU_ID_RE = re.compile(r"INSERT\s+INTO\s+`system_role_menu`\s+VALUES\s*\((\d+),")
AUTO_INC_RE = re.compile(r"CREATE\s+TABLE\s+`system_menu`[\s\S]*?AUTO_INCREMENT\s*=\s*(\d+)")


@dataclass(frozen=True)
class WebCrudPlan:
    """描述前端 CRUD 模块的生成文件清单与菜单 SQL 预览。"""

    module: str
    entity: str
    title: str
    menu_id_start: int
    created_files: tuple[str, ...]
    menu_sql: str
    applied: bool


def _validate_segment(label: str, value: str) -> str:
    """校验模块或实体路径段命名合法性。"""
    normalized = value.strip().lower()
    if not SEGMENT_RE.fullmatch(normalized):
        raise ValueError(f"{label} '{value}' 非法：必须以小写字母开头，仅含小写字母、数字和连字符")
    return normalized


def _to_pascal(text: str) -> str:
    """将 kebab-case 字符串转换为 PascalCase 标识符。"""
    return "".join(part.capitalize() for part in text.split("-") if part)


def _to_camel(text: str) -> str:
    """将 kebab-case 字符串转换为 camelCase 标识符。"""
    pascal = _to_pascal(text)
    return pascal[:1].lower() + pascal[1:]


def resolve_next_menu_ids(root: Path) -> tuple[int, int]:
    """扫描数据库基线 SQL 计算不冲突的 system_menu 与 system_role_menu 起始主键。

    Args:
        root: 仓库根目录。
    Returns:
        ``(next_menu_id, next_role_menu_id)`` 起始主键元组。
    """
    sql_path = root.resolve() / "数据库文件" / "basic_framework.sql"
    if not sql_path.is_file():
        return 6000, 6000
    sql = sql_path.read_text(encoding="utf-8", errors="replace")
    menu_ids = [int(m.group(1)) for m in MENU_ID_RE.finditer(sql)]
    auto_inc = AUTO_INC_RE.search(sql)
    if auto_inc:
        menu_ids.append(int(auto_inc.group(1)))
    role_menu_ids = [int(m.group(1)) for m in ROLE_MENU_ID_RE.finditer(sql)]
    next_menu = max(menu_ids, default=5999) + 1
    next_role_menu = max(role_menu_ids, default=5999) + 1
    return max(next_menu, 6000), max(next_role_menu, 6000)


def _escape_ts_single(text: str) -> str:
    """转义 TypeScript 单引号字符串字面量。"""
    return text.replace("\\", "\\\\").replace("'", "\\'").replace("\r", "").replace("\n", "")


def _escape_sql_single(text: str) -> str:
    """转义 MySQL 单引号字符串字面量。"""
    return text.replace("\\", "\\\\").replace("'", "''").replace("\r", "").replace("\n", "")


def _render_menu_sql(
    module: str,
    entity: str,
    title: str,
    parent_id: int,
    menu_id: int,
    role_menu_id: int,
) -> str:
    """生成与 SchemaDoRbacParityTest 正则完全兼容的单行标准 INSERT 菜单与超管授权 SQL。"""
    title = _escape_sql_single(title)
    comp_name = f"{_to_pascal(module)}{_to_pascal(entity)}"
    perm_prefix = f"{module}:{entity}"
    ts = "2026-01-01 00:00:00"
    menu_rows = [
        (menu_id, f"{title}管理", "", 2, "super_admin", 10, parent_id, entity, "ep:grid", f"{module}/{entity}/index", comp_name),
        (menu_id + 1, f"{title}查询", f"{perm_prefix}:query", 3, "super_admin", 1, menu_id, "", "", "", ""),
        (menu_id + 2, f"{title}新增", f"{perm_prefix}:create", 3, "super_admin", 2, menu_id, "", "", "", ""),
        (menu_id + 3, f"{title}修改", f"{perm_prefix}:update", 3, "super_admin", 3, menu_id, "", "", "", ""),
        (menu_id + 4, f"{title}删除", f"{perm_prefix}:delete", 3, "super_admin", 4, menu_id, "", "", "", ""),
        (menu_id + 5, f"{title}导出", f"{perm_prefix}:export", 3, "super_admin", 5, menu_id, "", "", "", ""),
    ]
    lines = [
        f"-- {title}管理菜单与按钮权限（标准单行 INSERT，可直接合入 basic_framework.sql 并通过 SchemaDoRbacParityTest）",
    ]
    for row in menu_rows:
        mid, name, perm, mtype, platform, sort, pid, path, icon, comp, cname = row
        lines.append(
            f"INSERT INTO `system_menu` VALUES ({mid}, '{name}', '{perm}', {mtype}, '{platform}', {sort}, {pid}, "
            f"'{path}', '{icon}', '{comp}', '{cname}', 0, b'1', b'1', b'1', 'admin', '{ts}', 'admin', '{ts}', b'0');"
        )
    lines.append("")
    for idx, mid in enumerate(range(menu_id, menu_id + 6)):
        lines.append(
            f"INSERT INTO `system_role_menu` VALUES ({role_menu_id + idx}, 1, {mid}, 'admin', '{ts}', 'admin', '{ts}', b'0');"
        )
    lines.append("")
    return "\n".join(lines)


def _render_crud_files(module: str, entity: str, title: str) -> dict[str, str]:
    """生成通过 weetion/comments、vue-tsc 与 check_crud.py 的完整前端 CRUD 文件集。"""
    title = _escape_ts_single(title)
    ns_name = f"{_to_pascal(module)}{_to_pascal(entity)}Api"
    entity_pascal = _to_pascal(entity)
    comp_name = f"{_to_pascal(module)}{entity_pascal}"
    route_prefix = f"/{module}/{entity}"
    perm_prefix = f"{module}:{entity}"

    api_ts = f"""/**
 * {title}管理前端 API 契约与请求封装。
 */
import type {{ PageParam, PageResult }} from '@vben/request';

import {{ requestClient }} from '#/api/request';

export namespace {ns_name} {{
  /** {title}信息模型（64 位主键支持 number | string，时间戳为毫秒级数值）。 */
  export interface {entity_pascal} {{
    id?: number | string;
    code: string;
    name: string;
    status: number;
    remark?: string;
    createTime?: number;
  }}

  /** {title}分页查询参数。 */
  export interface {entity_pascal}PageReqVO extends PageParam {{
    name?: string;
    status?: number;
    createTime?: string[];
  }}

  /** {title}导出筛选参数。 */
  export type {entity_pascal}ExportReqVO = Partial<{entity_pascal}PageReqVO>;
}}

/**
 * 查询{title}分页列表。
 *
 * @param params 分页与筛选参数
 * @returns {title}分页结果
 */
export function get{entity_pascal}Page(params: {ns_name}.{entity_pascal}PageReqVO) {{
  return requestClient.get<PageResult<{ns_name}.{entity_pascal}>>(
    '{route_prefix}/page',
    {{ params }},
  );
}}

/**
 * 查询单条{title}详情。
 *
 * @param id {title}主键编号
 * @returns {title}详情数据
 */
export function get{entity_pascal}(id: number | string) {{
  return requestClient.get<{ns_name}.{entity_pascal}>(
    `{route_prefix}/get?id=${{id}}`,
  );
}}

/**
 * 新增{title}记录。
 *
 * @param data {title}表单载荷
 * @returns 新建记录主键编号
 */
export function create{entity_pascal}(data: {ns_name}.{entity_pascal}) {{
  return requestClient.post<number | string>('{route_prefix}/create', data);
}}

/**
 * 修改{title}记录。
 *
 * @param data {title}表单载荷
 * @returns 更新操作结果
 */
export function update{entity_pascal}(data: {ns_name}.{entity_pascal}) {{
  return requestClient.put<boolean>('{route_prefix}/update', data);
}}

/**
 * 删除单条{title}记录。
 *
 * @param id {title}主键编号
 * @returns 删除操作结果
 */
export function delete{entity_pascal}(id: number | string) {{
  return requestClient.delete<boolean>(`{route_prefix}/delete?id=${{id}}`);
}}

/**
 * 批量删除{title}记录。
 *
 * @param ids {title}主键编号列表
 * @returns 批量删除操作结果
 */
export function delete{entity_pascal}List(ids: Array<number | string>) {{
  return requestClient.delete<boolean>(
    `{route_prefix}/delete-list?ids=${{ids.join(',')}}`,
  );
}}

/**
 * 导出{title} Excel 文件二进制流。
 *
 * @param params 筛选参数
 * @returns Excel 二进制数据
 */
export function export{entity_pascal}(params: {ns_name}.{entity_pascal}ExportReqVO) {{
  return requestClient.download('{route_prefix}/export-excel', {{ params }});
}}
"""

    data_ts = f"""/**
 * {title}管理列表页、搜索栏与弹窗表单 Schema 配置。
 */
import type {{ VbenFormSchema }} from '#/adapter/form';
import type {{ VxeTableGridOptions }} from '#/adapter/vxe-table';
import type {{ {ns_name} }} from '#/api/{module}/{entity}';

import {{ CommonStatusEnum, DICT_TYPE }} from '@vben/constants';
import {{ getDictOptions }} from '@vben/hooks';

import {{ getRangePickerDefaultProps }} from '#/utils';

/**
 * 主键隐藏域展示判定（始终隐藏）。
 *
 * @returns 固定返回 false
 */
function hideIdField(): boolean {{
  return false;
}}

/**
 * 构建新增与编辑{title}弹窗的表单字段配置。
 *
 * @returns 表单 Schema 列表
 */
export function useFormSchema(): VbenFormSchema[] {{
  return [
    {{
      component: 'Input',
      fieldName: 'id',
      dependencies: {{
        triggerFields: [''],
        show: hideIdField,
      }},
    }},
    {{
      component: 'Input',
      fieldName: 'code',
      label: '{title}编码',
      rules: 'required',
    }},
    {{
      component: 'Input',
      fieldName: 'name',
      label: '{title}名称',
      rules: 'required',
    }},
    {{
      component: 'RadioGroup',
      componentProps: {{
        isButton: true,
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
      }},
      defaultValue: CommonStatusEnum.ENABLE,
      fieldName: 'status',
      label: '状态',
      rules: 'required',
    }},
    {{
      component: 'Textarea',
      fieldName: 'remark',
      label: '备注',
    }},
  ];
}}

/**
 * 构建{title}列表页搜索栏字段配置。
 *
 * @returns 搜索表单 Schema 列表
 */
export function useGridFormSchema(): VbenFormSchema[] {{
  return [
    {{
      component: 'Input',
      fieldName: 'name',
      label: '{title}名称',
    }},
    {{
      component: 'Select',
      componentProps: {{
        clearable: true,
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
      }},
      fieldName: 'status',
      label: '状态',
    }},
    {{
      component: 'RangePicker',
      componentProps: {{
        ...getRangePickerDefaultProps(),
        clearable: true,
      }},
      fieldName: 'createTime',
      label: '创建时间',
    }},
  ];
}}

/**
 * 构建{title}表格列配置。
 *
 * @returns VxeGrid 列定义数组
 */
export function useGridColumns(): VxeTableGridOptions<{ns_name}.{entity_pascal}>['columns'] {{
  return [
    {{ type: 'checkbox', width: 40 }},
    {{
      field: 'id',
      title: '编号',
      minWidth: 100,
    }},
    {{
      field: 'code',
      title: '{title}编码',
      minWidth: 140,
    }},
    {{
      field: 'name',
      title: '{title}名称',
      minWidth: 180,
    }},
    {{
      cellRender: {{
        name: 'CellDict',
        props: {{ type: DICT_TYPE.COMMON_STATUS }},
      }},
      field: 'status',
      title: '状态',
      minWidth: 100,
    }},
    {{
      field: 'remark',
      title: '备注',
      minWidth: 200,
    }},
    {{
      field: 'createTime',
      formatter: 'formatDateTime',
      minWidth: 180,
      title: '创建时间',
    }},
    {{
      align: 'center',
      field: 'actions',
      fixed: 'right',
      slots: {{ default: 'actions' }},
      title: '操作',
      width: 160,
    }},
  ];
}}
"""

    form_vue = f"""<script lang="ts" setup>
/**
 * {title}新增与编辑弹窗表单组件。
 */
import type {{ {ns_name} }} from '#/api/{module}/{entity}';

import {{ computed, ref }} from 'vue';

import {{ useVbenModal }} from '@vben/common-ui';

import {{ ElMessage }} from 'element-plus';

import {{ useVbenForm }} from '#/adapter/form';
import {{
  create{entity_pascal},
  get{entity_pascal},
  update{entity_pascal},
}} from '#/api/{module}/{entity}';
import {{ $t }} from '#/locales';

import {{ useFormSchema }} from '../data';

const emit = defineEmits<{{ success: [] }}>();
const formData = ref<{ns_name}.{entity_pascal}>();

const getTitle = computed(() =>
  formData.value?.id
    ? $t('ui.actionTitle.edit', ['{title}'])
    : $t('ui.actionTitle.create', ['{title}']),
);

const [Form, formApi] = useVbenForm({{
  commonConfig: {{
    componentProps: {{
      class: 'w-full',
    }},
    labelWidth: 96,
  }},
  layout: 'horizontal',
  schema: useFormSchema(),
  showDefaultActions: false,
}});

/**
 * 校验并提交新增或编辑{title}表单。
 */
async function handleConfirm() {{
  const {{ valid }} = await formApi.validate();
  if (!valid) {{
    return;
  }}
  modalApi.lock();
  try {{
    const values = (await formApi.getValues()) as {ns_name}.{entity_pascal};
    await (formData.value?.id
      ? update{entity_pascal}(values)
      : create{entity_pascal}(values));
    await modalApi.close();
    emit('success');
    ElMessage.success($t('ui.actionMessage.operationSuccess'));
  }} finally {{
    modalApi.unlock();
  }}
}}

/**
 * 弹窗打开时加载待编辑记录详情并回填表单，关闭时清理编辑态。
 *
 * @param isOpen 弹窗是否处于打开状态
 */
async function handleOpenChange(isOpen: boolean) {{
  if (!isOpen) {{
    formData.value = undefined;
    return;
  }}
  const incoming = modalApi.getData<{ns_name}.{entity_pascal}>();
  if (!incoming?.id) {{
    await formApi.resetForm();
    return;
  }}
  modalApi.lock();
  try {{
    formData.value = await get{entity_pascal}(incoming.id);
    await formApi.setValues(formData.value);
  }} finally {{
    modalApi.unlock();
  }}
}}

const [Modal, modalApi] = useVbenModal({{
  onConfirm: handleConfirm,
  onOpenChange: handleOpenChange,
}});
</script>

<template>
  <Modal :title="getTitle">
    <Form class="mx-4" />
  </Modal>
</template>
"""

    index_vue = f"""<script lang="ts" setup>
/**
 * {title}管理主列表页面：提供条件检索、新增、编辑、单条删除、批量删除与 Excel 导出。
 */
import type {{ VxeTableGridOptions }} from '#/adapter/vxe-table';
import type {{ {ns_name} }} from '#/api/{module}/{entity}';

import {{ Page, useVbenModal }} from '@vben/common-ui';
import {{ downloadFileFromBlobPart, isEmpty }} from '@vben/utils';

import {{ ACTION_ICON, TableAction, useVbenVxeGrid }} from '#/adapter/vxe-table';
import {{
  delete{entity_pascal},
  delete{entity_pascal}List,
  export{entity_pascal},
  get{entity_pascal}Page,
}} from '#/api/{module}/{entity}';
import {{ useCrudActions }} from '#/composables/use-crud-actions';
import {{ $t }} from '#/locales';

import {{ useGridColumns, useGridFormSchema }} from './data';
import Form from './modules/form.vue';

defineOptions({{ name: '{comp_name}' }});

const [FormModal, formModalApi] = useVbenModal({{
  connectedComponent: Form,
  destroyOnClose: true,
}});

/**
 * 提取列表行展示名称用于删除确认提示。
 *
 * @param row 当前{title}记录
 * @returns 用于确认提示的展示名称
 */
function getDeleteName(row: {ns_name}.{entity_pascal}): string {{
  return row.name || '';
}}

/**
 * 代理请求{title}分页列表数据。
 *
 * @param params VxeGrid 分页上下文
 * @param params.page 当前页码与分页大小
 * @param formValues 搜索栏表单筛选值
 * @returns 分页查询结果
 */
async function queryPage(
  {{ page }}: {{ page: {{ currentPage: number; pageSize: number }} }},
  formValues: {ns_name}.{entity_pascal}ExportReqVO,
) {{
  return await get{entity_pascal}Page({{
    pageNo: page.currentPage,
    pageSize: page.pageSize,
    ...formValues,
  }});
}}

/**
 * 按当前搜索条件导出{title} Excel 文件。
 */
async function handleExport() {{
  const values =
    (await gridApi.formApi.getValues()) as {ns_name}.{entity_pascal}ExportReqVO;
  const data = await export{entity_pascal}(values);
  downloadFileFromBlobPart({{ fileName: '{title}.xlsx', source: data }});
}}

const {{
  checkedIds,
  getGridEvents,
  handleCreate,
  handleDelete,
  handleDeleteBatch,
  handleEdit,
}} = useCrudActions<{ns_name}.{entity_pascal}>({{
  batchDeleteApi: delete{entity_pascal}List,
  deleteApi: delete{entity_pascal},
  getDeleteName,
  modalApi: formModalApi,
  refresh: handleRefresh,
}});

const [Grid, gridApi] = useVbenVxeGrid({{
  formOptions: {{
    schema: useGridFormSchema(),
  }},
  gridEvents: getGridEvents(),
  gridOptions: {{
    columns: useGridColumns(),
    height: 'auto',
    keepSource: true,
    proxyConfig: {{
      ajax: {{
        query: queryPage,
      }},
    }},
    rowConfig: {{
      isHover: true,
      keyField: 'id',
    }},
    toolbarConfig: {{
      refresh: true,
      search: true,
    }},
  }} as VxeTableGridOptions<{ns_name}.{entity_pascal}>,
}});

/**
 * 刷新{title}表格数据。
 */
function handleRefresh() {{
  gridApi.query();
}}
</script>

<template>
  <Page auto-content-height>
    <FormModal @success="handleRefresh" />
    <Grid table-title="{title}列表">
      <template #toolbar-tools>
        <TableAction
          :actions="[
            {{
              label: $t('ui.actionTitle.create', ['{title}']),
              type: 'primary',
              icon: ACTION_ICON.ADD,
              auth: ['{perm_prefix}:create'],
              onClick: handleCreate,
            }},
            {{
              label: $t('ui.actionTitle.export'),
              type: 'primary',
              icon: ACTION_ICON.DOWNLOAD,
              auth: ['{perm_prefix}:export'],
              onClick: handleExport,
            }},
            {{
              label: $t('ui.actionTitle.deleteBatch'),
              type: 'danger',
              icon: ACTION_ICON.DELETE,
              auth: ['{perm_prefix}:delete'],
              disabled: isEmpty(checkedIds),
              onClick: handleDeleteBatch,
            }},
          ]"
        />
      </template>
      <template #actions="{{ row }}">
        <TableAction
          :actions="[
            {{
              label: $t('common.edit'),
              type: 'primary',
              link: true,
              icon: ACTION_ICON.EDIT,
              auth: ['{perm_prefix}:update'],
              onClick: handleEdit.bind(null, row),
            }},
            {{
              label: $t('common.delete'),
              type: 'danger',
              link: true,
              icon: ACTION_ICON.DELETE,
              auth: ['{perm_prefix}:delete'],
              popConfirm: {{
                title: $t('ui.actionMessage.deleteConfirm', [row.name]),
                confirm: handleDelete.bind(null, row),
              }},
            }},
          ]"
        />
      </template>
    </Grid>
  </Page>
</template>
"""

    test_ts = f"""/**
 * 验证{title}管理表单与列表列配置包含核心业务字段与格式化契约。
 */
import {{ describe, expect, it, vi }} from 'vitest';

import {{ useFormSchema, useGridColumns, useGridFormSchema }} from './data';

vi.mock('@vben/hooks', () => ({{
  /** 模拟字典选项读取函数。 */
  getDictOptions: () => [
    {{ label: '开启', value: 0 }},
    {{ label: '关闭', value: 1 }},
  ],
}}));

/** 验证{title} CRUD 配置骨架套件。 */
function describe{entity_pascal}Data() {{
  /** 验证表单、筛选栏与表格列均包含核心字段与正确时间格式化器。 */
  function verifiesCoreFields() {{
    const formFields = useFormSchema().map((item) => item.fieldName);
    const searchFields = useGridFormSchema().map((item) => item.fieldName);
    const columns = useGridColumns() ?? [];
    const columnFields = columns.map((item) => item.field);

    expect(formFields).toContain('name');
    expect(formFields).toContain('status');
    expect(searchFields).toContain('name');
    expect(columnFields).toContain('id');
    expect(columnFields).toContain('actions');
    const createTimeCol = columns.find((item) => item.field === 'createTime');
    expect(createTimeCol?.formatter).toBe('formatDateTime');
  }}

  it('包含核心表单、筛选与列表列字段', verifiesCoreFields);
}}

describe('{module}/{entity} data schema', describe{entity_pascal}Data);
"""

    web_prefix = "前端代码/basic-framework-admin/apps/web-ele/src"
    return {
        f"{web_prefix}/api/{module}/{entity}/index.ts": api_ts,
        f"{web_prefix}/views/{module}/{entity}/data.ts": data_ts,
        f"{web_prefix}/views/{module}/{entity}/modules/form.vue": form_vue,
        f"{web_prefix}/views/{module}/{entity}/index.vue": index_vue,
        f"{web_prefix}/views/{module}/{entity}/data.test.ts": test_ts,
    }


def scaffold_web_crud(
    root: Path,
    raw_module: str,
    raw_entity: str,
    *,
    title: str,
    menu_parent_id: int = 0,
    menu_id: int | None = None,
    sql_out: Path | None = None,
    apply: bool = False,
) -> WebCrudPlan:
    """构建或写入标准前端 CRUD 5 件套文件与兼容 SchemaDoRbacParityTest 的菜单 SQL。

    Args:
        root: 仓库根目录。
        raw_module: 业务模块名（如 crm、system）。
        raw_entity: 实体路径名（如 customer）。
        title: 中文业务名称（如 客户）。
        menu_parent_id: 上级菜单 ID（默认 0 顶层目录）。
        menu_id: 起始菜单 ID；默认自动扫描 basic_framework.sql 递增分配避免撞号。
        sql_out: 可选菜单 SQL 输出路径（必须位于仓库目录内）。
        apply: 为 True 时实际写入；默认只读预览。
    Returns:
        前端 CRUD 生成计划快照。
    Raises:
        ValueError: 命名非法、目标文件已存在或 sql_out 越出仓库目录时抛出。
    """
    module = _validate_segment("模块名", raw_module)
    entity = _validate_segment("实体名", raw_entity)
    clean_title = title.strip()
    if not clean_title:
        raise ValueError("必须提供非空的中文业务标题 --title")

    resolved_root = root.resolve()
    auto_menu_id, auto_role_menu_id = resolve_next_menu_ids(resolved_root)
    effective_menu_id = menu_id if menu_id is not None else auto_menu_id

    files = _render_crud_files(module, entity, clean_title)
    menu_sql = _render_menu_sql(
        module, entity, clean_title, menu_parent_id, effective_menu_id, auto_role_menu_id
    )
    if sql_out is not None:
        resolved_sql = (
            sql_out.resolve() if sql_out.is_absolute() else (resolved_root / sql_out).resolve()
        )
        if not resolved_sql.is_relative_to(resolved_root):
            raise ValueError(f"--sql-out 路径越出仓库根目录：{sql_out.as_posix()}")
        rel_sql = resolved_sql.relative_to(resolved_root).as_posix()
        files[rel_sql] = menu_sql

    for rel_path in files:
        target = resolved_root / rel_path
        if target.exists():
            raise ValueError(f"目标文件已存在，拒绝覆盖：{rel_path}")

    if apply:
        for rel_path, content in files.items():
            target = resolved_root / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8", newline="\n")

    return WebCrudPlan(
        module=module,
        entity=entity,
        title=clean_title,
        menu_id_start=effective_menu_id,
        created_files=tuple(sorted(files)),
        menu_sql=menu_sql,
        applied=apply,
    )


def main(argv: list[str] | None = None) -> int:
    """解析命令行参数并执行前端 CRUD 脚手架（同时兼容位置参数与 --module/--entity 选项）。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("module", nargs="?", default=None, help="所属业务模块名（如 crm、system）")
    parser.add_argument("entity", nargs="?", default=None, help="实体路径名（如 customer）")
    parser.add_argument("--module", dest="module_opt", default=None, help="所属业务模块名（命名参数形式）")
    parser.add_argument("--entity", dest="entity_opt", default=None, help="实体路径名（命名参数形式）")
    parser.add_argument("--title", required=True, help="实体中文名称（如 客户）")
    parser.add_argument("--menu-parent-id", type=int, default=0, help="父级菜单编号（默认 0）")
    parser.add_argument(
        "--menu-id",
        type=int,
        default=None,
        help="菜单起始编号（默认扫描 basic_framework.sql 自动递增分配，连续占用 6 个）",
    )
    parser.add_argument("--sql-out", type=Path, default=None, help="可选菜单权限 SQL 输出路径（限仓库内）")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="仓库根目录")
    parser.add_argument("--apply", action="store_true", help="实际写入文件（默认仅预览）")
    args = parser.parse_args(argv)

    raw_module = args.module_opt or args.module
    raw_entity = args.entity_opt or args.entity
    if not raw_module or not raw_entity:
        parser.error("必须提供模块名与实体名（如 crm customer 或 --module crm --entity customer）")

    try:
        plan = scaffold_web_crud(
            args.root,
            raw_module,
            raw_entity,
            title=args.title,
            menu_parent_id=args.menu_parent_id,
            menu_id=args.menu_id,
            sql_out=args.sql_out,
            apply=args.apply,
        )
    except ValueError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    mode_label = "已写入" if plan.applied else "预览（未写入，传入 --apply 落盘）"
    print(
        f"[{mode_label}] 前端 CRUD：{plan.module}/{plan.entity}（{plan.title}），"
        f"菜单起始编号：{plan.menu_id_start}"
    )
    for path in plan.created_files:
        print(f"  + {path}")
    if args.sql_out is None:
        print("\n-- 配套菜单与权限 SQL 片段预览 --")
        print(plan.menu_sql.rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
