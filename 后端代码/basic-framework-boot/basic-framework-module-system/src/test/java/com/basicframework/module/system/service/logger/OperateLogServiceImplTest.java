package com.basicframework.module.system.service.logger;

import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.api.logger.dto.OperateLogPageReqDTO;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import com.basicframework.module.system.dal.mysql.logger.OperateLogMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证操作日志服务的系统用户兜底、字段拷贝与查询委派契约。
 *
 * <p>操作日志来自 MQ、定时任务与异步线程，这些链路没有登录上下文：缺少兜底会让日志以空用户入库，
 * 审计查询无法区分"系统操作"与"数据缺失"；兜底写成覆盖则会篡改真实操作者。用例用真实 DTO 驱动
 * 并断言最终入库对象的内容，同时确认查询结果原样返回而不是被再加工。</p>
 *
 * @author shady2713
 */
class OperateLogServiceImplTest {

    /** 被测服务。 */
    private OperateLogServiceImpl service;
    /** 操作日志 Mapper 替身，用于观察入库对象与返回结果。 */
    private OperateLogMapper operateLogMapper;

    /** 为每个用例装配独立服务与替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        service = new OperateLogServiceImpl();
        operateLogMapper = mock(OperateLogMapper.class);
        ReflectionTestUtils.setField(service, "operateLogMapper", operateLogMapper);
    }

    /** 缺少登录人时必须按系统用户 0 与管理员类型兜底入库，业务字段原样保留。 */
    @Test
    void createOperateLogFillsSystemUserWhenAbsent() {
        OperateLogCreateReqDTO reqDTO = new OperateLogCreateReqDTO();
        reqDTO.setType("DUMMY-TYPE");
        reqDTO.setSubType("DUMMY-SUB-TYPE");
        reqDTO.setBizId(100L);
        reqDTO.setAction("DUMMY-ACTION");
        reqDTO.setRequestUrl("/admin-api/system/user/page");

        service.createOperateLog(reqDTO);

        OperateLogDO inserted = captureInserted();
        assertThat(inserted.getUserId()).as("缺少登录人必须兜底为系统用户 0").isZero();
        assertThat(inserted.getUserType()).as("缺少用户类型必须兜底为管理员").isEqualTo(UserTypeEnum.ADMIN.getValue());
        assertThat(inserted.getBizId()).isEqualTo(100L);
        assertThat(inserted.getAction()).isEqualTo("DUMMY-ACTION");
        assertThat(inserted.getRequestUrl()).isEqualTo("/admin-api/system/user/page");
    }

    /** 已带真实操作者的日志不得被兜底覆盖。 */
    @Test
    void createOperateLogKeepsProvidedUser() {
        OperateLogCreateReqDTO reqDTO = new OperateLogCreateReqDTO();
        reqDTO.setUserId(7L);
        reqDTO.setUserType(UserTypeEnum.MEMBER.getValue());

        service.createOperateLog(reqDTO);

        OperateLogDO inserted = captureInserted();
        assertThat(inserted.getUserId()).as("真实操作者不得被系统用户覆盖").isEqualTo(7L);
        assertThat(inserted.getUserType()).isEqualTo(UserTypeEnum.MEMBER.getValue());
    }

    /** 单条查询必须原样返回 Mapper 结果。 */
    @Test
    void getOperateLogReturnsMapperResult() {
        OperateLogDO stored = new OperateLogDO();
        stored.setId(3L);
        when(operateLogMapper.selectById(3L)).thenReturn(stored);

        assertThat(service.getOperateLog(3L)).isSameAs(stored);
        assertThat(service.getOperateLog(4L)).as("未命中的查询必须返回 null").isNull();
    }

    /** 两种分页入口都必须把请求原样交给 Mapper，并返回其结果。 */
    @Test
    void getOperateLogPageDelegatesBothRequestTypes() {
        OperateLogPageReqVO reqVO = new OperateLogPageReqVO();
        OperateLogPageReqDTO reqDTO = new OperateLogPageReqDTO();
        PageResult<OperateLogDO> byVO = new PageResult<>(List.of(new OperateLogDO()), 1L);
        PageResult<OperateLogDO> byDTO = new PageResult<>(List.of(), 0L);
        when(operateLogMapper.selectPage(reqVO)).thenReturn(byVO);
        when(operateLogMapper.selectPage(reqDTO)).thenReturn(byDTO);

        assertThat(service.getOperateLogPage(reqVO)).isSameAs(byVO);
        assertThat(service.getOperateLogPage(reqDTO)).isSameAs(byDTO);
        verify(operateLogMapper).selectPage(reqVO);
        verify(operateLogMapper).selectPage(reqDTO);
    }

    /** 取出真实入库对象，供断言兜底与字段拷贝结果。 */
    private OperateLogDO captureInserted() {
        ArgumentCaptor<OperateLogDO> captor = ArgumentCaptor.forClass(OperateLogDO.class);
        verify(operateLogMapper).insert(captor.capture());
        return captor.getValue();
    }

}
