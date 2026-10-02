# Service 业务用例

用于新增或修改 Service，确定接口组织、模型选择、业务错误与编排边界。

## 接口与实现

Service 放在所属模块的 `service/<feature>`。多调用方的稳定能力可定义接口；单实现内部能力沿用同域结构，不统一要求增加接口与实现两层。跨模块能力由提供方 API 暴露，依赖方向见[模块约定](project-framework.md#模块与装配)。

## 入参与结果

入参沿用目标模块的用例契约，不为每个方法新增一套中间模型。聚合、计算或重组结果使用明确 DTO/Result；简单同模块只读查询可返回本模块 DO。HTTP 与跨模块的转换和传递限制见[模型边界](api-controller-model.md#模型边界)。

业务失败使用所属模块已有错误码及异常工具，与项目统一异常处理衔接。

## 业务编排

Controller、API 实现、Consumer 和 Job 调用 Service 执行业务。业务校验、状态与跨资源顺序由 Service 负责；查询实现与 SQL 组织留在 Mapper，Redis 原子操作留在 DAO，外部协议适配留在 Client。

分页补充数据、关联筛选及批量访问的选择见 [Mapper](mapper.md#按查询语义选择实现)，删除语义沿用 [DO 生命周期](do.md#模型与生命周期)。

Redis、MQ、Job、Worker 和保护组件的接入位置见[框架说明](project-framework.md)，复用所属模块已有能力。

## 验证

注释执行[完整标准](java-comments.md)，测试与检查按[验证指南](testing-validation.md)选择。
