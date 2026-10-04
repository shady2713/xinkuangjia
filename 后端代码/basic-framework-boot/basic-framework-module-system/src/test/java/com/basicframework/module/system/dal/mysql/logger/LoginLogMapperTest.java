package com.basicframework.module.system.dal.mysql.logger;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证登录日志分页查询的条件拼装与排序口径。
 *
 * <p>分页查询把管理端的筛选条件翻译成条件对象：IP 与账号按模糊匹配、时间按闭区间、
 * 状态筛选必须区分“成功”与“失败”。失败不能简单写成“结果不等于成功”，因为登录结果编码
 * 里成功为 0、失败均大于 0，真实的失败口径是大于成功编码；写错会把后续新增的中间状态
 * 也算成失败或漏掉失败记录。排序固定按编号倒序，保证最新登录在最前。</p>
 *
 * @author shady2713
 */
class LoginLogMapperTest {

    /** 记录分页参数与查询条件的引用。 */
    private final AtomicReference<IPage<LoginLogDO>> page = new AtomicReference<>();
    /** 记录查询条件对象的引用。 */
    private final AtomicReference<AbstractWrapper<LoginLogDO, ?, ?>> queryWrapper = new AtomicReference<>();

    /** 被测 Mapper 替身；默认方法走真实实现，抽象分页方法只记录参数。 */
    private LoginLogMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), LoginLogDO.class);
    }

    /** 为每个用例创建独立替身并记录默认方法交给持久化层的分页参数与条件对象。 */
    @BeforeEach
    void setUp() {
        page.set(null);
        queryWrapper.set(null);
        mapper = mock(LoginLogMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            page.set(invocation.getArgument(0));
            queryWrapper.set(invocation.getArgument(1));
            return null;
        }).when(mapper).selectPage(any(IPage.class), any());
    }

    /** 全部筛选条件必须同时生效，并按编号倒序返回最新记录。 */
    @Test
    void allFiltersAreAppliedWithDescendingOrder() {
        LoginLogPageReqVO reqVO = new LoginLogPageReqVO();
        reqVO.setUserIp("1.1.1.1");
        reqVO.setUsername("admin");
        reqVO.setStatus(true);
        LocalDateTime begin = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime end = LocalDateTime.of(2026, 9, 2, 23, 59, 59);
        reqVO.setCreateTime(new LocalDateTime[]{begin, end});

        mapper.selectPage(reqVO);

        AbstractWrapper<LoginLogDO, ?, ?> wrapper = queryWrapper.get();
        assertThat(wrapper.getTargetSql())
                .contains("user_ip LIKE").contains("username LIKE")
                .contains("create_time BETWEEN").contains("result =")
                .contains("ORDER BY id DESC");
        assertThat(wrapper.getParamNameValuePairs().values())
                .contains("%1.1.1.1%", "%admin%", begin, end, LoginResultEnum.SUCCESS.getResult());
        assertThat(page.get().getCurrent()).as("页码原样传给分页插件").isEqualTo(1);
        assertThat(page.get().getSize()).isEqualTo(10);
    }

    /** 状态为失败时必须按“结果大于成功编码”过滤，而不是不等于成功。 */
    @Test
    void failedStatusFiltersResultsGreaterThanSuccess() {
        LoginLogPageReqVO reqVO = new LoginLogPageReqVO();
        reqVO.setStatus(false);

        mapper.selectPage(reqVO);

        AbstractWrapper<LoginLogDO, ?, ?> wrapper = queryWrapper.get();
        assertThat(wrapper.getTargetSql()).contains("result >");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(LoginResultEnum.SUCCESS.getResult());
    }

    /** 未传状态时不得拼接任何结果条件，也不得拼接空的模糊匹配条件。 */
    @Test
    void absentFiltersProduceNoConditions() {
        LoginLogPageReqVO reqVO = new LoginLogPageReqVO();

        mapper.selectPage(reqVO);

        AbstractWrapper<LoginLogDO, ?, ?> wrapper = queryWrapper.get();
        assertThat(wrapper.getTargetSql())
                .doesNotContain("result").doesNotContain("LIKE").doesNotContain("BETWEEN")
                .contains("ORDER BY id DESC");
        assertThat(wrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 自定义页码与每页条数必须原样传给分页插件。 */
    @Test
    void pagingParametersAreForwarded() {
        LoginLogPageReqVO reqVO = new LoginLogPageReqVO();
        reqVO.setPageNo(3);
        reqVO.setPageSize(50);

        mapper.selectPage(reqVO);

        assertThat(page.get().getCurrent()).isEqualTo(3);
        assertThat(page.get().getSize()).isEqualTo(50);
    }
}
