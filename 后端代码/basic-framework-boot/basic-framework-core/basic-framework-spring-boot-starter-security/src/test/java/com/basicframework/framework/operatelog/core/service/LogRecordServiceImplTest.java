package com.basicframework.framework.operatelog.core.service;

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.biz.system.logger.OperateLogCommonApi;
import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.mzt.logapi.beans.LogRecord;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

/**
 * 验证操作日志记录服务的用户归属、模块字段与失败隔离。
 *
 * <p>非 Web 线程（RPC、MQ、定时任务）没有登录态，必须落到约定的系统用户；
 * 若落成 null，日志入库会因用户编号非空约束失败而整条丢失。</p>
 *
 * @author shady2713
 */
class LogRecordServiceImplTest {

    /** 记录实际提交的操作日志。 */
    private final List<OperateLogCreateReqDTO> submitted = Collections.synchronizedList(new ArrayList<>());
    /** 提交是否应抛出异常。 */
    private final AtomicBoolean failing = new AtomicBoolean();

    private LogRecordServiceImpl service;

    /** 每例使用干净替身与空上下文。 */
    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        RequestContextHolder.resetRequestAttributes();
        submitted.clear();
        failing.set(false);
        service = new LogRecordServiceImpl();
        ReflectionTestUtils.setField(service, "operateLogApi", recordingOperateLogApi());
    }

    /** 清理静态上下文，避免影响同 JVM 的其他测试。 */
    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        RequestContextHolder.resetRequestAttributes();
    }

    /** 无登录态时必须记录为系统用户，并使用管理员类型。 */
    @Test
    void anonymousThreadIsRecordedAsSystemUser() {
        service.record(logRecord());

        assertThat(submitted).hasSize(1);
        assertThat(submitted.get(0).getUserId()).isZero();
        assertThat(submitted.get(0).getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
    }

    /** 已登录时必须记录真实用户，不能一律记为系统用户。 */
    @Test
    void loggedInUserIsRecordedWithRealIdentity() {
        asUser(42L);

        service.record(logRecord());

        assertThat(submitted.get(0).getUserId()).isEqualTo(42L);
        assertThat(submitted.get(0).getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
    }

    /** 机器主体的零号用户编号必须如实保留，便于识别非人工操作。 */
    @Test
    void machinePrincipalKeepsZeroUserId() {
        asUser(0L);

        service.record(logRecord());

        assertThat(submitted.get(0).getUserId()).isZero();
    }

    /** 模块维度字段必须逐项透传，缺失会让日志无法按模块与业务对象检索。 */
    @Test
    void moduleFieldsAreCopiedFromLogRecord() {
        service.record(logRecord());

        OperateLogCreateReqDTO dto = submitted.get(0);
        assertThat(dto.getType()).isEqualTo("system");
        assertThat(dto.getSubType()).isEqualTo("update");
        assertThat(dto.getBizId()).isEqualTo(1001L);
        assertThat(dto.getAction()).isEqualTo("修改用户");
        assertThat(dto.getExtra()).isEqualTo("{\"id\":1001}");
    }

    /** 处于 Web 请求中时必须补齐请求方法、地址、来源与 UA。 */
    @Test
    void requestFieldsAreFilledInsideWebRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/admin-api/system/user/update");
        request.setRemoteAddr("10.0.0.8");
        request.addHeader("User-Agent", "JUnit-Agent/1.0");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        service.record(logRecord());

        OperateLogCreateReqDTO dto = submitted.get(0);
        assertThat(dto.getRequestMethod()).isEqualTo("POST");
        assertThat(dto.getRequestUrl()).isEqualTo("/admin-api/system/user/update");
        assertThat(dto.getUserIp()).isEqualTo("10.0.0.8");
        assertThat(dto.getUserAgent()).isEqualTo("JUnit-Agent/1.0");
    }

    /**
     * 记录查询接口不被支持。
     * 静默返回空列表会让调用方误以为确实没有日志，掩盖查询能力缺失。
     */
    @Test
    void queryLogIsExplicitlyUnsupported() {
        assertThatThrownBy(() -> service.queryLog("1001", "system"))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("OperateLogApi");
    }

    /** 按业务编号查询同样必须显式拒绝。 */
    @Test
    void queryLogByBizNoIsExplicitlyUnsupported() {
        assertThatThrownBy(() -> service.queryLogByBizNo("1001", "system", "update"))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("OperateLogApi");
    }

    /**
     * 提交失败不得向业务抛出异常。
     * 操作日志是旁路能力，日志故障不能连带业务请求失败。
     */
    @Test
    void submissionFailureDoesNotPropagate() {
        failing.set(true);

        org.assertj.core.api.Assertions.assertThatCode(() -> service.record(logRecord()))
                .doesNotThrowAnyException();
    }

    /** 提交失败后仍不得影响调用方的身份上下文。 */
    @Test
    void submissionFailureKeepsLoginContext() {
        asUser(7L);
        failing.set(true);

        org.assertj.core.api.Assertions.assertThatCode(() -> service.record(logRecord()))
                .doesNotThrowAnyException();

        assertThat(SecurityFrameworkUtils.getLoginUserId()).isEqualTo(7L);
    }

    /** 静态模块字段补全方法必须可独立复用，并保持字段语义。 */
    @Test
    void fillModuleFieldsWorksStandalone() {
        OperateLogCreateReqDTO dto = new OperateLogCreateReqDTO();

        LogRecordServiceImpl.fillModuleFields(dto, logRecord());

        assertThat(dto.getType()).isEqualTo("system");
        assertThat(dto.getSubType()).isEqualTo("update");
        assertThat(dto.getBizId()).isEqualTo(1001L);
    }

    /** 以指定身份建立登录上下文。 */
    private void asUser(Long userId) {
        LoginUser loginUser = new LoginUser();
        loginUser.setId(userId);
        loginUser.setUserType(UserTypeEnum.ADMIN.getValue());
        SecurityFrameworkUtils.setLoginUser(loginUser, new MockHttpServletRequest());
    }

    /** 构造一条固定的业务日志记录。 */
    private static LogRecord logRecord() {
        LogRecord logRecord = new LogRecord();
        logRecord.setType("system");
        logRecord.setSubType("update");
        logRecord.setBizNo("1001");
        logRecord.setAction("修改用户");
        logRecord.setExtra("{\"id\":1001}");
        return logRecord;
    }

    /**
     * 操作日志接口替身：记录同步提交内容，并可模拟异步提交失败。
     * 异步提交走接口默认方法委托到同步方法，因此只需实现同步方法即可覆盖异步路径；
     * 异步提交失败必须被隔离，否则业务请求会被日志旁路拖垮。
     */
    private OperateLogCommonApi recordingOperateLogApi() {
        return new OperateLogCommonApi() {

            /** 记录提交内容，按需模拟失败。 */
            @Override
            public void createOperateLog(OperateLogCreateReqDTO createReqDTO) {
                if (failing.get()) {
                    throw new IllegalStateException("模拟异步提交失败");
                }
                submitted.add(createReqDTO);
            }
        };
    }
}
