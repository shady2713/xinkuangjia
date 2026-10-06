package com.basicframework.module.system.service.logger;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.basicframework.module.system.api.logger.dto.OperateLogPageReqDTO;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import com.basicframework.module.system.dal.mysql.logger.OperateLogMapper;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

/**
 * 操作日志 Service 实现类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Service
@Validated
@Slf4j
public class OperateLogServiceImpl implements OperateLogService {

    private static final long SYSTEM_USER_ID = 0L;

    @Resource
    private OperateLogMapper operateLogMapper;

    /**
     * 创建操作日志。
     *
     * @param createReqDTO createReqDTO 参数
     */
    @Override
    public void createOperateLog(OperateLogCreateReqDTO createReqDTO) {
        OperateLogDO log = BeanUtils.toBean(createReqDTO, OperateLogDO.class);
        fillSystemUserIfAbsent(log);
        operateLogMapper.insert(log);
    }

    /**
     * 操作日志可能来自 MQ、定时任务或异步线程，缺少登录人时按系统用户 0 兜底入库。
     */
    private void fillSystemUserIfAbsent(OperateLogDO log) {
        if (log.getUserId() == null) {
            log.setUserId(SYSTEM_USER_ID);
        }
        if (log.getUserType() == null) {
            log.setUserType(UserTypeEnum.ADMIN.getValue());
        }
    }

    /**
     * 获取操作日志。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    public OperateLogDO getOperateLog(Long id) {
        return operateLogMapper.selectById(id);
    }

    /**
     * 获取操作日志分页数据。
     *
     * @param pageReqVO pageReqVO 参数
     * @return 查询或转换后的结果
     */
    @Override
    public PageResult<OperateLogDO> getOperateLogPage(OperateLogPageReqVO pageReqVO) {
        return operateLogMapper.selectPage(pageReqVO);
    }

    /**
     * 获取操作日志分页数据。
     *
     * @param pageReqDTO pageReqDTO 参数
     * @return 查询或转换后的结果
     */
    @Override
    public PageResult<OperateLogDO> getOperateLogPage(OperateLogPageReqDTO pageReqDTO) {
        return operateLogMapper.selectPage(pageReqDTO);
    }

}
