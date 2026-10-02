package com.basicframework.module.system.service.logger;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.basicframework.module.system.api.logger.dto.OperateLogPageReqDTO;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;

/**
 * 操作日志服务接口。
 * <p>
 * 提供操作日志记录、详情查询和分页查询能力。
 *
 * @author 李杰
 */
public interface OperateLogService {

    /**
     * 创建操作日志。
     *
     * @param createReqDTO 操作日志创建参数
     */
    void createOperateLog(OperateLogCreateReqDTO createReqDTO);

    /**
     * 获取操作日志。
     *
     * @param id 操作日志编号
     * @return 操作日志信息
     */
    OperateLogDO getOperateLog(Long id);

    /**
     * 管理端分页查询操作日志。
     *
     * @param pageReqVO 管理端分页条件
     * @return 操作日志分页结果
     */
    PageResult<OperateLogDO> getOperateLogPage(OperateLogPageReqVO pageReqVO);

    /**
     * API 分页查询操作日志。
     *
     * @param pageReqVO API 分页条件
     * @return 操作日志分页结果
     */
    PageResult<OperateLogDO> getOperateLogPage(OperateLogPageReqDTO pageReqVO);

}
