package com.basicframework.module.[module].dal.mysql.[entity];

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.module.[module].dal.dataobject.[entity].[Entity]DO;
import org.apache.ibatis.annotations.Mapper;

/**
 * [entity-name]持久化接口。
 *
 * <p>这里刻意保持为纯接口：单表 CRUD 由 BaseMapperX 提供，条件查询由 Service 用
 * LambdaQueryWrapperX 组装。原因是当前覆盖率门禁按文件纳管“有方法体的手写实现”——
 * Mapper 里写 {@code default} 方法就必须同时提供能真实执行它的测试，而这类测试通常需要
 * 真实数据库并落在必须显式纳入的 *IT 入口里；把条件留在 Service 可以让默认 surefire 范围
 * 内即可满足逐文件 100% 行/方法覆盖，条件本身的正确性由 Service 测试断言 Wrapper 的实际
 * SQL 片段。若本模块确实需要自定义 SQL 或 Join，再按 Mapper 规范新增带入参与结果映射的方法，
 * 并为其补可执行测试。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]。</p>
 *
 * @author [author]
 */
@Mapper
public interface [Entity]Mapper extends BaseMapperX<[Entity]DO> {
}
