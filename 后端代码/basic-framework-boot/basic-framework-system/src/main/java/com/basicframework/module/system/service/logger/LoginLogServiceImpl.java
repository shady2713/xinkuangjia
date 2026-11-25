package com.basicframework.module.system.service.logger;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.dal.mysql.logger.LoginLogMapper;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

/**
 * 登录日志服务实现类。
 * <p>
 * 负责登录日志的持久化和查询。
 *
 * @author shady
 */
@Service
@Validated
public class LoginLogServiceImpl implements LoginLogService {

    @Resource
    private LoginLogMapper loginLogMapper;

    /**
     * 获取登录日志。
     *
     * @param id 登录日志编号
     * @return 登录日志信息
     */
    @Override
    public LoginLogDO getLoginLog(Long id) {
        return loginLogMapper.selectById(id);
    }

    /**
     * 分页查询登录日志。
     *
     * @param pageReqVO 分页条件
     * @return 登录日志分页结果
     */
    @Override
    public PageResult<LoginLogDO> getLoginLogPage(LoginLogPageReqVO pageReqVO) {
        return loginLogMapper.selectPage(pageReqVO);
    }

    /**
     * 创建登录或安全审计日志。
     *
     * <p>使用 {@link Propagation#REQUIRES_NEW} 独立事务边界提交审计记录，
     * 避免外层业务事务（如密码重置校验失败）回滚时连带撤销失败审计。</p>
     *
     * @param reqDTO 登录日志创建参数
     */
    private static final int TRACE_ID_MAX_LEN = 64;
    private static final int USERNAME_MAX_LEN = 50;
    private static final int USER_IP_MAX_LEN = 50;
    private static final int USER_AGENT_MAX_LEN = 512;

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public void createLoginLog(LoginLogCreateReqDTO reqDTO) {
        LoginLogDO loginLog = BeanUtils.toBean(reqDTO, LoginLogDO.class);
        // 兜底非空列并按数据库列宽安全截断，防止超长 User-Agent/Header 触发 MySQL 严格模式截断异常导致审计丢失或 500。
        loginLog.setTraceId(truncateColumn(loginLog.getTraceId(), TRACE_ID_MAX_LEN));
        loginLog.setUsername(truncateColumn(loginLog.getUsername(), USERNAME_MAX_LEN));
        loginLog.setUserIp(truncateColumn(loginLog.getUserIp(), USER_IP_MAX_LEN));
        loginLog.setUserAgent(truncateColumn(loginLog.getUserAgent(), USER_AGENT_MAX_LEN));
        if (loginLog.getUserId() == null) {
            loginLog.setUserId(0L);
        }
        if (loginLog.getUserType() == null) {
            loginLog.setUserType(0);
        }
        loginLogMapper.insert(loginLog);
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

}
