package com.basicframework.module.system.service.logger;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;

import jakarta.validation.Valid;

/**
 * 登录日志服务接口。
 * <p>
 * 提供登录日志记录、详情查询和分页查询能力。
 *
 * @author 李杰
 */
public interface LoginLogService {

    /**
     * 获取登录日志。
     *
     * @param id 登录日志编号
     * @return 登录日志信息
     */
    LoginLogDO getLoginLog(Long id);

    /**
     * 分页查询登录日志。
     *
     * @param pageReqVO 分页条件
     * @return 登录日志分页结果
     */
    PageResult<LoginLogDO> getLoginLogPage(LoginLogPageReqVO pageReqVO);

    /**
     * 创建登录日志。
     *
     * @param reqDTO 登录日志创建参数
     */
    void createLoginLog(@Valid LoginLogCreateReqDTO reqDTO);

}
