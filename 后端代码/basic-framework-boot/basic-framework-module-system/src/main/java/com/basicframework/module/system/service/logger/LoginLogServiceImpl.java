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
 * @author 李杰
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
    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public void createLoginLog(LoginLogCreateReqDTO reqDTO) {
        LoginLogDO loginLog = BeanUtils.toBean(reqDTO, LoginLogDO.class);
        // 兜底非空列默认空串或 0，确保无 HTTP 请求或未识别账号时失败审计仍可独立落库。
        loginLog.setTraceId(StrUtil.nullToEmpty(loginLog.getTraceId()));
        loginLog.setUsername(StrUtil.nullToEmpty(loginLog.getUsername()));
        loginLog.setUserIp(StrUtil.nullToEmpty(loginLog.getUserIp()));
        loginLog.setUserAgent(StrUtil.nullToEmpty(loginLog.getUserAgent()));
        if (loginLog.getUserId() == null) {
            loginLog.setUserId(0L);
        }
        if (loginLog.getUserType() == null) {
            loginLog.setUserType(0);
        }
        loginLogMapper.insert(loginLog);
    }

}
