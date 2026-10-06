/**
 * 菜单管理接口：菜单的增删改查、详情与批量删除。
 * 精简列表一次取回整棵菜单树，供角色分配菜单等场景使用；
 * 完整列表供菜单管理页的列表与表单使用。
 */
import { requestClient } from '#/api/request';

export namespace SystemMenuApi {
  /** 菜单信息 */
  export interface Menu {
    id: number;
    name: string;
    permission: string;
    type: number;
    sort: number;
    parentId: number;
    path: string;
    icon: string;
    component: string;
    componentName?: string;
    status: number;
    visible: boolean;
    keepAlive: boolean;
    alwaysShow?: boolean;
    createTime: Date;
  }
}

/**
 * 查询菜单精简列表，供角色分配菜单等场景一次取回整棵菜单树。
 * @returns 菜单精简记录，每项仅含 id、name、menuType、parentId、type，不含路由与权限等完整字段。
 */
export async function getSimpleMenusList() {
  return requestClient.get<SystemMenuApi.Menu[]>('/system/menu/simple-list');
}

/**
 * 查询菜单列表
 * @param params 查询条件，由菜单管理页按当前筛选表单拼装
 * @returns 满足条件的菜单列表
 */
export async function getMenuList(params?: Record<string, unknown>) {
  return requestClient.get<SystemMenuApi.Menu[]>('/system/menu/list', {
    params,
  });
}

/**
 * 查询菜单详情。
 * @param id 菜单编号；编号不存在时后端按业务码拒绝。
 * @returns 菜单完整字段，含路由、组件与权限标识，未做契约校验。
 */
export async function getMenu(id: number) {
  return requestClient.get<SystemMenuApi.Menu>(`/system/menu/get?id=${id}`);
}

/**
 * 新增菜单。
 * @param data 菜单表单数据；后端校验父菜单存在、父菜单类型可挂载该子项、
 *             同级菜单名与组件名不重复，编号由后端生成。
 * @returns 新建菜单的编号。
 */
export async function createMenu(data: SystemMenuApi.Menu) {
  return requestClient.post('/system/menu/create', data);
}

/**
 * 修改菜单。
 * @param data 菜单表单数据，必须携带已有菜单编号；父菜单、子项挂载关系与同级重名校验同新增。
 * @returns 更新结果标识。
 */
export async function updateMenu(data: SystemMenuApi.Menu) {
  return requestClient.put('/system/menu/update', data);
}

/**
 * 删除菜单并清理已授予角色的对应权限。
 * @param id 菜单编号；菜单不存在或仍有子菜单时后端按业务码拒绝，不级联删除子菜单。
 * @returns 删除结果标识。
 */
export async function deleteMenu(id: number) {
  return requestClient.delete(`/system/menu/delete?id=${id}`);
}

/**
 * 批量删除菜单并清理已授予角色的对应权限。
 * @param ids 菜单编号数组，以逗号拼入查询串；任一编号仍有子菜单时后端拒绝整批删除。
 * @returns 删除结果标识。
 */
export async function deleteMenuList(ids: number[]) {
  return requestClient.delete(`/system/menu/delete-list?ids=${ids.join(',')}`);
}
