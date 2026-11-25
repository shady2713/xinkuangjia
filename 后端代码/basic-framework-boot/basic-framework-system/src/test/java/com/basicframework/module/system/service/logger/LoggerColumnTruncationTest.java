package com.basicframework.module.system.service.logger;

import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import com.basicframework.module.system.dal.mysql.logger.LoginLogMapper;
import com.basicframework.module.system.dal.mysql.logger.OperateLogMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

/**
 * 验证登录日志与操作日志入库前的定长截断保护，避免超长 User-Agent 或请求字段导致 DB 写入异常阻断登录。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class LoggerColumnTruncationTest {

    @Mock
    private LoginLogMapper loginLogMapper;
    @Mock
    private OperateLogMapper operateLogMapper;

    @InjectMocks
    private LoginLogServiceImpl loginLogService;
    @InjectMocks
    private OperateLogServiceImpl operateLogService;

    @Test
    void loginLogTruncatesOverlongUserAgentAndPreservesSurrogatePair() {
        // 511 个 ASCII 字符 + 1 个补充平面字符（2 个 UTF-16 code units，共 513 chars）
        String overlongUa = "A".repeat(511) + "\uD83D\uDE00";
        LoginLogCreateReqDTO reqDTO = new LoginLogCreateReqDTO();
        reqDTO.setTraceId("T".repeat(80));
        reqDTO.setUsername("u".repeat(80));
        reqDTO.setUserIp("1".repeat(80));
        reqDTO.setUserAgent(overlongUa);

        loginLogService.createLoginLog(reqDTO);

        ArgumentCaptor<LoginLogDO> captor = ArgumentCaptor.forClass(LoginLogDO.class);
        verify(loginLogMapper).insert(captor.capture());
        LoginLogDO saved = captor.getValue();
        assertThat(saved.getTraceId()).hasSize(64);
        assertThat(saved.getUsername()).hasSize(50);
        assertThat(saved.getUserIp()).hasSize(50);
        // 截断不能在代理对中间劈开，结果应为 511 个 'A'
        assertThat(saved.getUserAgent()).hasSize(511);
    }

    @Test
    void operateLogTruncatesOverlongFieldsSafely() {
        OperateLogCreateReqDTO reqDTO = new OperateLogCreateReqDTO();
        reqDTO.setTraceId("T".repeat(80));
        reqDTO.setType("类型".repeat(40));
        reqDTO.setSubType("子类型".repeat(30));
        reqDTO.setAction("动作".repeat(1500));
        reqDTO.setExtra("扩展".repeat(1500));
        reqDTO.setRequestMethod("CUSTOM_LONG_METHOD_NAME");
        reqDTO.setRequestUrl("/api/" + "x".repeat(300));
        reqDTO.setUserIp("2".repeat(80));
        reqDTO.setUserAgent("Mozilla/5.0 " + "Z".repeat(600));

        operateLogService.createOperateLog(reqDTO);

        ArgumentCaptor<OperateLogDO> captor = ArgumentCaptor.forClass(OperateLogDO.class);
        verify(operateLogMapper).insert(captor.capture());
        OperateLogDO saved = captor.getValue();
        assertThat(saved.getTraceId()).hasSize(64);
        assertThat(saved.getType()).hasSize(50);
        assertThat(saved.getSubType()).hasSize(50);
        assertThat(saved.getAction()).hasSize(2000);
        assertThat(saved.getExtra()).hasSize(2000);
        assertThat(saved.getRequestMethod()).hasSize(16);
        assertThat(saved.getRequestUrl()).hasSize(255);
        assertThat(saved.getUserIp()).hasSize(50);
        assertThat(saved.getUserAgent()).hasSize(512);
    }

}
