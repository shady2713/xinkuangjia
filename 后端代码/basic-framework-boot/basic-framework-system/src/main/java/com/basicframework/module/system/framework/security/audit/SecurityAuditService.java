package com.basicframework.module.system.framework.security.audit;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.util.monitor.TracerUtils;
import com.basicframework.framework.common.util.servlet.ServletUtils;
import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.service.logger.LoginLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 安全审计服务，统一写入登录日志体系中的安全事件。
 *
 * <p>覆盖登录成功与失败、失败锁定、自助改密、密码重置、短信登录失败以及 SM2 传输校验失败。
 * 审计记录只包含用户编号、账号、IP、User-Agent、日志类型和结果原因；调用方不得传入密码、
 * 密文、短信验证码或其他凭据内容。</p>
 *
 * @author shady2713
 */
@Service
@RequiredArgsConstructor
public class SecurityAuditService {

    private final LoginLogService loginLogService;

    /**
     * 写入一条安全审计记录。
     *
     * <p>请求上下文存在时记录客户端 IP 和 User-Agent，不存在时写入空字符串，保证审计行可落库。</p>
     *
     * @param logType 安全事件类型
     * @param result 事件结果与原因
     * @param userId 相关用户编号，未知时传 null
     * @param username 相关账号，未知时传 null
     */
    public void record(LoginLogTypeEnum logType, LoginResultEnum result, Long userId, String username) {
        LoginLogCreateReqDTO reqDTO = new LoginLogCreateReqDTO();
        reqDTO.setLogType(logType.getType());
        reqDTO.setResult(result.getResult());
        reqDTO.setTraceId(TracerUtils.getTraceId());
        reqDTO.setUserId(userId != null ? userId : 0L);
        reqDTO.setUserType(UserTypeEnum.ADMIN.getValue());
        reqDTO.setUsername(StrUtil.nullToEmpty(username));
        reqDTO.setUserIp(StrUtil.nullToEmpty(ServletUtils.getClientIP()));
        reqDTO.setUserAgent(StrUtil.nullToEmpty(ServletUtils.getUserAgent()));
        loginLogService.createLoginLog(reqDTO);
    }
}
