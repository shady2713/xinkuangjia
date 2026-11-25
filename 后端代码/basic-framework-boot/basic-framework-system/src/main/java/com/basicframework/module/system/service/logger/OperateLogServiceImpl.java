package com.basicframework.module.system.service.logger;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
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
 * @author shady
 */
@Service
@Validated
@Slf4j
public class OperateLogServiceImpl implements OperateLogService {

    private static final long SYSTEM_USER_ID = 0L;
    private static final int TRACE_ID_MAX_LEN = 64;
    private static final int TYPE_MAX_LEN = 50;
    private static final int ACTION_MAX_LEN = 2000;
    private static final int REQUEST_METHOD_MAX_LEN = 16;
    private static final int REQUEST_URL_MAX_LEN = 255;
    private static final int USER_IP_MAX_LEN = 50;
    private static final int USER_AGENT_MAX_LEN = 512;

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
        // 按数据库列宽安全截断，防止攻击者构造超长 User-Agent/URL 引发截断异常逃逸异步操作审计。
        log.setTraceId(truncateColumn(log.getTraceId(), TRACE_ID_MAX_LEN));
        log.setType(truncateColumn(log.getType(), TYPE_MAX_LEN));
        log.setSubType(truncateColumn(log.getSubType(), TYPE_MAX_LEN));
        log.setAction(truncateColumn(log.getAction(), ACTION_MAX_LEN));
        log.setExtra(truncateColumn(log.getExtra(), ACTION_MAX_LEN));
        log.setRequestMethod(truncateColumn(log.getRequestMethod(), REQUEST_METHOD_MAX_LEN));
        log.setRequestUrl(truncateColumn(log.getRequestUrl(), REQUEST_URL_MAX_LEN));
        log.setUserIp(truncateColumn(log.getUserIp(), USER_IP_MAX_LEN));
        log.setUserAgent(truncateColumn(log.getUserAgent(), USER_AGENT_MAX_LEN));
        operateLogMapper.insert(log);
    }

    private static String truncateColumn(String value, int maxLength) {
        String safe = StrUtil.nullToEmpty(value);
        if (safe.length() <= maxLength) {
            return safe;
        }
        int end = maxLength;
        if (end > 0 && Character.isHighSurrogate(safe.charAt(end - 1))) {
            end--;
        }
        return safe.substring(0, end);
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

}
