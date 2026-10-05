package com.basicframework.module.[module].service.[entity];

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]PageReqVO;
import com.basicframework.module.[module].controller.admin.[entity].vo.[Entity]SaveReqVO;
import com.basicframework.module.[module].dal.dataobject.[entity].[Entity]DO;

/**
 * [entity-name]服务接口。
 *
 * <p>对外只暴露业务动作：创建、修改、删除、单条查询与分页查询。接口保持纯声明（不写
 * default 方法），实现类即逐文件覆盖率门禁纳管的唯一实现。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]。</p>
 *
 * @author [author]
 */
public interface [Entity]Service {

    /**
     * 创建[entity-name]。
     *
     * @param createReqVO 创建请求，名称必须尚未被占用
     * @return 新记录编号
     */
    Long create[Entity]([Entity]SaveReqVO createReqVO);

    /**
     * 修改[entity-name]。
     *
     * @param updateReqVO 修改请求，编号必须已存在；名称冲突或编号不存在时抛出业务异常
     */
    void update[Entity]([Entity]SaveReqVO updateReqVO);

    /**
     * 删除[entity-name]。
     *
     * @param id 目标记录编号；不存在时抛出业务异常而不是静默成功
     */
    void delete[Entity](Long id);

    /**
     * 查询[entity-name]详情。
     *
     * @param id 目标记录编号
     * @return 记录；不存在时返回 {@code null}
     */
    [Entity]DO get[Entity](Long id);

    /**
     * 分页查询[entity-name]。
     *
     * @param pageReqVO 分页与筛选条件，空筛选不参与 SQL
     * @return 按编号倒序的分页结果
     */
    PageResult<[Entity]DO> get[Entity]Page([Entity]PageReqVO pageReqVO);

}
