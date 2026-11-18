#!/usr/bin/env python3
"""确定性前端 CRUD 页面脚手架：一键生成 API、VxeGrid 列表页、Modal 表单、Vitest 单测及可选菜单 SQL。

默认只读预览（--dry-run），仅在显式传入 --apply 时写入文件。
生成代码严格遵循 Vue Vben Admin 5 + Element Plus 规范、中文 JSDoc 注释门禁、epoch-ms 时间戳与权限码契约。

用法：
  python -B -X utf8 scripts/scaffold/new_web_crud.py crm customer --title 客户
  python -B -X utf8 scripts/scaffold/new_web_crud.py crm customer --title 客户 --apply

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


@dataclass(frozen=True)
class WebCrudPlan:
    """描述前端 CRUD 模块的生成文件清单与菜单 SQL 预览。"""

    module: str
    entity: str
    title: str
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


def _render_menu_sql(
    module: str, entity: str, title: str, parent_id: int, menu_id: int
) -> str:
    """生成幂等的菜单、按钮权限与超级管理员授权 SQL 片段。"""
    comp_name = f"{_to_pascal(module)}{_to_pascal(entity)}"
    perm_prefix = f"{module}:{entity}"
    lines = [
        f"-- {title}管理菜单与按钮权限（幂等导入，适用于本地开发库）",
        "REPLACE INTO `system_menu`",
        "    (`id`, `name`, `permission`, `type`, `menu_type`, `sort`, `parent_id`, `path`, `icon`,",
        "     `component`, `component_name`, `status`, `visible`, `keep_alive`, `always_show`,",
        "     `creator`, `create_time`, `updater`, `update_time`, `deleted`)",
        "VALUES",
        f"    ({menu_id}, '{title}管理', '', 2, 'super_admin', 10, {parent_id}, '{entity}', 'ep:grid',",
        f"     '{module}/{entity}/index', '{comp_name}', 0, b'1', b'1', b'1', 'admin', NOW(), 'admin', NOW(), b'0'),",
        f"    ({menu_id + 1}, '{title}查询', '{perm_prefix}:query', 3, 'super_admin', 1, {menu_id}, '', '', '', '', 0, b'1', b'1', b'1', 'admin', NOW(), 'admin', NOW(), b'0'),",
        f"    ({menu_id + 2}, '{title}新增', '{perm_prefix}:create', 3, 'super_admin', 2, {menu_id}, '', '', '', '', 0, b'1', b'1', b'1', 'admin', NOW(), 'admin', NOW(), b'0'),",
        f"    ({menu_id + 3}, '{title}修改', '{perm_prefix}:update', 3, 'super_admin', 3, {menu_id}, '', '', '', '', 0, b'1', b'1', b'1', 'admin', NOW(), 'admin', NOW(), b'0'),",
        f"    ({menu_id + 4}, '{title}删除', '{perm_prefix}:delete', 3, 'super_admin', 4, {menu_id}, '', '', '', '', 0, b'1', b'1', b'1', 'admin', NOW(), 'admin', NOW(), b'0'),",
        f"    ({menu_id + 5}, '{title}导出', '{perm_prefix}:export', 3, 'super_admin', 5, {menu_id}, '', '', '', '', 0, b'1', b'1', b'1', 'admin', NOW(), 'admin', NOW(), b'0');",
        "",
        f"DELETE FROM `system_role_menu` WHERE `role_id` = 1 AND `menu_id` BETWEEN {menu_id} AND {menu_id + 5};",
        "INSERT INTO `system_role_menu` (`role_id`, `menu_id`, `creator`, `create_time`, `updater`, `update_time`, `deleted`)",
        "VALUES",
        ",\n".join(
            f"    (1, {mid}, 'admin', NOW(), 'admin', NOW(), b'0')"
            for mid in range(menu_id, menu_id + 6)
        )
        + ";",
        "",
    ]
    return "\n".join(lines)


def _render_crud_files(module: str, entity: str, title: str) -> dict[str, str]:
    """生成前端 API、列与表单配置、弹窗组件、列表页与 Vitest 单元测试文件。"""
    ns_name = f"{_to_pascal(module)}{_to_pascal(entity)}Api"
    entity_pascal = _to_pascal(entity)
    entity_camel = _to_camel(entity)
    comp_name = f"{_to_pascal(module)}{entity_pascal}"
    route_prefix = f"/{module}/{entity}"
    perm_prefix = f"{module}:{entity}"

    api_ts = f"""import type {{ PageParam, PageResult }} from '@vben/request';

import {{ requestClient }} from '#/api/request';

export namespace {ns_name} {{
  /** {title}信息模型（64 位主键超过安全整数范围时由服务端序列化为字符串，时间戳为毫秒级数值）。 */
  export interface {entity_pascal} {{
    id?: number | string;
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
 * 导出{title} Excel 文件二进制流。
 *
 * @param params 筛选参数
 * @returns Excel 二进制数据
 */
export function export{entity_pascal}(params: {ns_name}.{entity_pascal}PageReqVO) {{
  return requestClient.download('{route_prefix}/export-excel', {{ params }});
}}
"""

    data_ts = f"""import type {{ VbenFormSchema }} from '#/adapter/form';
import type {{ VxeTableGridOptions }} from '#/adapter/vxe-table';
import type {{ {ns_name} }} from '#/api/{module}/{entity}';

import {{ CommonStatusEnum, DICT_TYPE }} from '@vben/constants';
import {{ getDictOptions }} from '@vben/hooks';

import {{ getRangePickerDefaultProps }} from '#/utils';

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
        show: () => false,
      }},
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
        buttonStyle: 'solid',
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
        optionType: 'button',
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
export function useColumns(): VxeTableGridOptions<{ns_name}.{entity_pascal}>['columns'] {{
  return [
    {{
      field: 'id',
      title: '编号',
      minWidth: 100,
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
      cellRender: {{
        name: 'CellDatetime',
      }},
      field: 'createTime',
      title: '创建时间',
      minWidth: 180,
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

/** 提交新增或编辑{title}表单。 */
async function handleConfirm() {{
  const {{ valid }} = await formApi.validate();
  if (!valid) {{
    return;
  }}
  modalApi.lock();
  const values = (await formApi.getValues()) as {ns_name}.{entity_pascal};
  try {{
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

/** 弹窗打开时加载待编辑记录详情并填充表单。 */
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
import type {{ VxeTableGridOptions }} from '#/adapter/vxe-table';
import type {{ {ns_name} }} from '#/api/{module}/{entity}';

import {{ Page, useVbenModal }} from '@vben/common-ui';
import {{ downloadFileFromBlobPart }} from '@vben/utils';

import {{ ElMessage }} from 'element-plus';

import {{ ACTION_ICON, TableAction, useVbenVxeGrid }} from '#/adapter/vxe-table';
import {{
  delete{entity_pascal},
  export{entity_pascal},
  get{entity_pascal}Page,
}} from '#/api/{module}/{entity}';
import {{ $t }} from '#/locales';
import {{ showLoadingMessage }} from '#/utils/feedback';

import {{ useColumns, useGridFormSchema }} from './data';
import Form from './modules/form.vue';

defineOptions({{ name: '{comp_name}' }});

const [FormModal, formModalApi] = useVbenModal({{
  connectedComponent: Form,
  destroyOnClose: true,
}});

/** 刷新{title}表格数据。 */
function handleRefresh() {{
  gridApi.query();
}}

/** 打开新增{title}弹窗。 */
function handleCreate() {{
  formModalApi.setData(null).open();
}}

/** 打开编辑{title}弹窗。 */
function handleEdit(row: {ns_name}.{entity_pascal}) {{
  formModalApi.setData(row).open();
}}

/** 删除单条{title}记录并刷新列表。 */
async function handleDelete(row: {ns_name}.{entity_pascal}) {{
  if (!row.id) {{
    return;
  }}
  const loading = showLoadingMessage(
    $t('ui.actionMessage.deleting', [row.name]),
  );
  try {{
    await delete{entity_pascal}(row.id);
    ElMessage.success($t('ui.actionMessage.deleteSuccess', [row.name]));
    handleRefresh();
  }} finally {{
    loading.close();
  }}
}}

/** 按当前搜索条件导出{title} Excel 文件。 */
async function handleExport() {{
  const values = await gridApi.formApi.getValues();
  const data = await export{entity_pascal}(values);
  downloadFileFromBlobPart({{ fileName: '{title}.xls', source: data }});
}}

const [Grid, gridApi] = useVbenVxeGrid({{
  formOptions: {{
    schema: useGridFormSchema(),
  }},
  gridOptions: {{
    columns: useColumns(),
    height: 'auto',
    keepSource: true,
    proxyConfig: {{
      ajax: {{
        query: async ({{ page }}, formValues) => {{
          return await get{entity_pascal}Page({{
            pageNo: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
          }});
        }},
      }},
    }},
    rowConfig: {{
      keyField: 'id',
      isHover: true,
    }},
    toolbarConfig: {{
      refresh: true,
      search: true,
    }},
  }} as VxeTableGridOptions<{ns_name}.{entity_pascal}>,
}});
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

    data_test_ts = f"""/**
 * 验证{title} CRUD 表单与表格列定义完整性。
 *
 * @author shady2713
 */
import {{ describe, expect, it }} from 'vitest';

import {{ useColumns, useFormSchema, useGridFormSchema }} from './data';

/** 验证新增编辑表单、搜索栏与表格列均包含核心业务字段。 */
function definesExpectedCrudMetadata() {{
  const formFields = useFormSchema().map((item) => item.fieldName);
  expect(formFields).toEqual(['id', 'name', 'status', 'remark']);

  const searchFields = useGridFormSchema().map((item) => item.fieldName);
  expect(searchFields).toEqual(['name', 'status', 'createTime']);

  const columnFields = (useColumns() ?? []).map((col) => col.field);
  expect(columnFields).toContain('id');
  expect(columnFields).toContain('name');
  expect(columnFields).toContain('actions');
}}

/** {entity_camel} 元数据配置测试套件。 */
function {entity_camel}DataSuite() {{
  it('生成完整的表单字段、搜索条件与操作列定义', definesExpectedCrudMetadata);
}}

describe('{module}/{entity} data schema', {entity_camel}DataSuite);
"""

    web_src = f"前端代码/basic-framework-admin/apps/web-ele/src"
    return {
        f"{web_src}/api/{module}/{entity}/index.ts": api_ts,
        f"{web_src}/views/{module}/{entity}/data.ts": data_ts,
        f"{web_src}/views/{module}/{entity}/modules/form.vue": form_vue,
        f"{web_src}/views/{module}/{entity}/index.vue": index_vue,
        f"{web_src}/views/{module}/{entity}/data.test.ts": data_test_ts,
    }


def scaffold_web_crud(
    root: Path,
    raw_module: str,
    raw_entity: str,
    *,
    title: str,
    menu_parent_id: int = 1,
    menu_id: int = 5000,
    sql_out: Path | None = None,
    apply: bool = False,
) -> WebCrudPlan:
    """构建或写入前端标准 CRUD 页面与 API 客户端骨架。

    Args:
        root: 仓库根目录。
        raw_module: 所属模块目录名（如 system、infra、crm）。
        raw_entity: 实体目录名（如 customer、order-item）。
        title: 业务实体中文名称（如 客户）。
        menu_parent_id: 父菜单 ID。
        menu_id: 起始菜单 ID（占用连续 6 个编号）。
        sql_out: 可选菜单 SQL 输出文件路径。
        apply: 为 True 时实际写入文件。
    Returns:
        前端 CRUD 生成计划快照。
    Raises:
        ValueError: 参数非法或目标文件已存在时抛出。
    """
    module = _validate_segment("module", raw_module)
    entity = _validate_segment("entity", raw_entity)
    clean_title = title.strip()
    if not clean_title:
        raise ValueError("必须提供非空的中文业务标题 --title")

    resolved_root = root.resolve()
    files = _render_crud_files(module, entity, clean_title)
    menu_sql = _render_menu_sql(module, entity, clean_title, menu_parent_id, menu_id)
    if sql_out is not None:
        rel_sql = (
            sql_out.resolve().relative_to(resolved_root).as_posix()
            if sql_out.is_absolute()
            else sql_out.as_posix()
        )
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
        created_files=tuple(sorted(files)),
        menu_sql=menu_sql,
        applied=apply,
    )


def main(argv: list[str] | None = None) -> int:
    """解析命令行参数并执行前端 CRUD 脚手架。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("module", help="所属业务模块名（如 crm、system）")
    parser.add_argument("entity", help="实体路径名（如 customer）")
    parser.add_argument("--title", required=True, help="实体中文名称（如 客户）")
    parser.add_argument("--menu-parent-id", type=int, default=1, help="父级菜单编号")
    parser.add_argument("--menu-id", type=int, default=5000, help="菜单起始编号（连续占用 6 个）")
    parser.add_argument("--sql-out", type=Path, default=None, help="可选菜单权限 SQL 输出路径")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="仓库根目录")
    parser.add_argument("--apply", action="store_true", help="实际写入文件（默认仅预览）")
    args = parser.parse_args(argv)

    try:
        plan = scaffold_web_crud(
            args.root,
            args.module,
            args.entity,
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
    print(f"[{mode_label}] 前端 CRUD：{plan.module}/{plan.entity}（{plan.title}）")
    for path in plan.created_files:
        print(f"  + {path}")
    if args.sql_out is None:
        print("\n-- 配套菜单与权限 SQL 片段预览 --")
        print(plan.menu_sql.rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
