/**
 * [entity-title]接口类型。
 *
 * 与 `index.ts` 分离是仓库检查器 `scripts/quality/check_crud.py` 的硬性要求。本文件只允许
 * 出现类型声明：一旦写入可执行语句，前端逐文件覆盖率门禁会把本文件当成实现纳管，而纯类型
 * 文件不可能有真实运行时覆盖，只能靠真实的运行时代码或把类型放回业务文件解决。
 */
import type { PageParam } from '@vben/request';

/** [entity-name]信息。 */
export interface [Entity] {
  /** 编号；新增时由后端生成，前端不填。 */
  id?: number;
  /** 名称，必填且唯一。 */
  name: string;
  /** 状态：0 开启、1 关闭，与后端 status 字段一致。 */
  status: number;
  /** 备注。 */
  remark?: string;
  /** 创建时间，由后端返回。 */
  createTime?: Date;
}

/** [entity-name]分页查询参数，与后端 [Entity]PageReqVO 字段一一对应。 */
export interface [Entity]PageParams extends PageParam {
  /** 名称，模糊匹配；为空表示不筛选。 */
  name?: string;
  /** 状态，精确匹配；为空表示不筛选。 */
  status?: number;
}
