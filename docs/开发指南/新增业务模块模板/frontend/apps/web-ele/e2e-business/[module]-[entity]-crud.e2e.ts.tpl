/**
 * [entity-name] CRUD 浏览器业务用例。
 *
 * 覆盖真实登录、通过左侧菜单进入[entity-title]、新建、列表可见、编辑、删除，以及重名新建被
 * 拒的关键失败路径；环境由 scripts/e2e/run_business_e2e.py 准备，缺少后端、种子账号或浏览器
 * 时用例直接失败，不使用跳过。删除后的数据结果由运行脚本另行直连数据库独立复核，不用页面
 * 自身的提示代替。
 *
 * 占位符：[module]、[entity]、[entity-name]、[entity-title]、[module-title]、[permission]。
 */
import type { Locator, Page } from '@playwright/test';

import process from 'node:process';

import { expect, test } from '@playwright/test';

/** 种子管理员账号，与隔离环境脚本 --admin-username 的默认值一致。 */
const ADMIN_USERNAME = 'e2eadmin';
/** 弹窗提交与删除二次确认按钮文案，取自管理前端当前中文语言包。 */
const CONFIRM_TEXT = '确认';

/**
 * 读取本次运行注入的种子账号口令，缺失时明确失败。
 * @returns 本次隔离环境的管理员明文口令。
 * @throws {Error} 缺少环境注入口令时抛出，避免用例在无凭据时静默通过。
 */
function adminPassword(): string {
  const value = process.env.BF_E2E_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      '缺少 BF_E2E_ADMIN_PASSWORD：请通过 scripts/e2e/run_business_e2e.py 运行本用例',
    );
  }
  return value;
}

/**
 * 生成本次运行内唯一的业务标识，避免与库中既有数据重名。
 * @returns 由运行时刻派生的短标识。
 */
function runSuffix(): string {
  return Date.now().toString(36);
}

/**
 * 通过真实登录表单进入管理平台，并以概览页确认登录已生效。
 * @param page Playwright 页面对象，用于驱动真实浏览器交互。
 */
async function login(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByPlaceholder('请输入账号').fill(ADMIN_USERNAME);
  await page.getByPlaceholder('请输入密码').fill(adminPassword());
  await page.getByRole('button', { name: 'login' }).click();
  await expect(page).toHaveURL(/#\/dashboard/u);
}

/**
 * 通过左侧菜单进入[entity-title]，验证菜单、路由与按钮权限链路而不是直接改地址。
 * @param page Playwright 页面对象。
 */
async function open[Entity]Page(page: Page): Promise<void> {
  const menu = page.locator('.vben-menu');
  await menu.getByText('[module-title]', { exact: true }).click();
  await menu.getByRole('menuitem', { name: '[entity-title]' }).click();
  await expect(page).toHaveURL(/#\/[module]\/[entity]/u);
  // 新增按钮受 [permission]:create 权限控制，可见即证明菜单与角色授权链路生效。
  await expect(page.getByRole('button', { name: '新增[entity-name]' })).toBeVisible();
}

/**
 * 打开新增弹窗并等待弹窗就绪。
 * @param page Playwright 页面对象。
 */
async function openCreateDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: '新增[entity-name]' }).click();
  await expect(page.getByRole('dialog').getByText('新增[entity-name]')).toBeVisible();
}

/**
 * 填写弹窗中的名称与备注。
 * @param page Playwright 页面对象。
 * @param values 本次要写入的名称与备注。
 * @param values.name 名称，必填。
 * @param values.remark 备注，可为空字符串。
 */
async function fill[Entity]Form(
  page: Page,
  values: { name: string; remark: string },
): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('请输入[entity-name]名称').fill(values.name);
  await dialog.getByPlaceholder('请输入备注').fill(values.remark);
}

/**
 * 提交当前弹窗，不判断结果，由调用方断言成功或失败提示。
 * @param page Playwright 页面对象。
 */
async function submit[Entity]Form(page: Page): Promise<void> {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: CONFIRM_TEXT })
    .click();
}

/**
 * 在列表中新建一条记录并等待成功提示。
 * @param page Playwright 页面对象。
 * @param values 本次新建的名称与备注。
 * @param values.name 名称，必须与既有记录不同。
 * @param values.remark 备注，可为空字符串。
 */
async function create[Entity](
  page: Page,
  values: { name: string; remark: string },
): Promise<void> {
  await openCreateDialog(page);
  await fill[Entity]Form(page, values);
  await submit[Entity]Form(page);
  await expect(page.getByText('操作成功').first()).toBeVisible();
}

/**
 * 定位列表中包含指定名称的数据行。
 * @param page Playwright 页面对象。
 * @param name 本次运行的名称，用于在真实表格中筛选目标行。
 * @returns 该名称所在主表行的定位器；列表未刷新时可能为空。
 */
function [entity]Row(page: Page, name: string): Locator {
  return page
    .locator('.vxe-table--main-wrapper .vxe-table--body tbody tr')
    .filter({ hasText: name });
}

/**
 * 定位指定数据行的操作按钮行；vxe-table 把固定列渲染到独立表格，需要按行标识关联。
 * @param page Playwright 页面对象。
 * @param name 本次运行的名称。
 * @returns 该行操作按钮所在的固定列行定位器。
 * @throws {Error} 列表中没有该名称的数据行时抛出，避免误点其他记录。
 */
async function [entity]ActionRow(page: Page, name: string): Promise<Locator> {
  const row = [entity]Row(page, name).first();
  const rowId = await row.getAttribute('rowid');
  if (!rowId) {
    throw new Error(`[entity-name]列表中未找到 ${name} 的数据行`);
  }
  // 列宽超出容器时 vxe-table 把固定列拆到独立表格渲染；列较少时操作按钮仍在主表行内，
  // 两种形态都必须能定位，否则用例会在“表格没横向溢出”的机器上误报找不到按钮。
  const fixed = page.locator(
    `.vxe-table--fixed-right-wrapper tr[rowid="${rowId}"]`,
  );
  return (await fixed.count()) > 0 ? fixed : row;
}

test('[entity-name]完整流程：新建、列表可见、编辑与删除', /** 用真实浏览器完成一次代表性 CRUD，并验证删除后记录不再出现在列表中。 */ async ({
  page,
}) => {
  const suffix = runSuffix();
  const name = `E2E [entity-name] ${suffix}`;
  const renamed = `${name} 已改`;

  await login(page);
  await open[Entity]Page(page);

  await create[Entity](page, { name, remark: '端到端新建' });
  const created = [entity]Row(page, name);
  await expect(created).toHaveCount(1);
  await expect(created).toContainText(name);

  const editRow = await [entity]ActionRow(page, name);
  await editRow.getByText('修改', { exact: true }).click();
  await expect(page.getByRole('dialog').getByText('修改[entity-name]')).toBeVisible();
  await fill[Entity]Form(page, { name: renamed, remark: '端到端修改' });
  await submit[Entity]Form(page);
  await expect(page.getByText('操作成功').first()).toBeVisible();
  await expect([entity]Row(page, renamed)).toContainText(renamed);

  const deleteRow = await [entity]ActionRow(page, renamed);
  await deleteRow.getByText('删除', { exact: true }).click();
  const confirmBox = page.locator('.el-message-box');
  await expect(confirmBox).toContainText(`确定删除 ${renamed} 吗？`);
  await confirmBox.getByRole('button', { name: CONFIRM_TEXT }).click();
  // 逻辑删除后的真实契约：删除成功后该记录不再出现在分页列表中。
  await expect([entity]Row(page, renamed)).toHaveCount(0);
  await expect(page.getByText('操作成功').first()).toBeVisible();
});

test('[entity-name]失败路径：重名新建被拒且不留残留', /** 覆盖真实重名拒绝路径，并确认列表没有产生新记录。 */ async ({
  page,
}) => {
  const suffix = runSuffix();
  const name = `E2E 重名 ${suffix}`;
  const otherName = `E2E 重名副本 ${suffix}`;

  await login(page);
  await open[Entity]Page(page);
  await create[Entity](page, { name, remark: '失败路径基线' });
  await expect([entity]Row(page, name)).toHaveCount(1);

  await openCreateDialog(page);
  await fill[Entity]Form(page, { name, remark: '重复名称' });
  await submit[Entity]Form(page);
  await expect(page.getByText('已经存在名为').first()).toBeVisible();

  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // 失败不得产生新记录：原名称仍只有一行，未使用的名称没有落库。
  await expect([entity]Row(page, name)).toHaveCount(1);
  await expect([entity]Row(page, otherName)).toHaveCount(0);
});
