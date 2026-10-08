package com.basicframework.module.system.dal.mysql.sms;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelPageReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证短信渠道查询的条件拼装。
 *
 * <p>渠道编码是供应商配置的对外标识，全局唯一，查询必须精确匹配；签名与创建时间是可选的模糊或区间
 * 条件，用于管理端按关键字检索渠道。</p>
 *
 * @author shady2713
 */
class SmsChannelMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<SmsChannelDO, ?, ?> queryWrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private SmsChannelMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), SmsChannelDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        mapper = mock(SmsChannelMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(1);
            var page = invocation.getArgument(0);
            ((com.baomidou.mybatisplus.core.metadata.IPage<SmsChannelDO>) page).setRecords(List.of());
            return page;
        }).when(mapper).selectPage(any(com.baomidou.mybatisplus.core.metadata.IPage.class), any(Wrapper.class));
    }

    /** 渠道分页应用签名模糊、编码精确、状态精确与创建时间区间，并按编号倒序返回。 */
    @Test
    void selectPageAppliesAllFiltersAndOrdersById() {
        SmsChannelPageReqVO reqVO = new SmsChannelPageReqVO();
        reqVO.setSignature("阿里");
        reqVO.setCode("ALIYUN");
        reqVO.setStatus(0);
        LocalDateTime begin = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime end = LocalDateTime.of(2026, 9, 2, 23, 59, 59);
        reqVO.setCreateTime(new LocalDateTime[]{begin, end});

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("signature LIKE").contains("code =").contains("status =")
                .contains("create_time BETWEEN").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .contains("%阿里%", "ALIYUN", 0, begin, end);
    }

    /** 未带筛选条件时不得拼出空条件，排序仍然生效。 */
    @Test
    void selectPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new SmsChannelPageReqVO());

        assertThat(queryWrapper.getTargetSql())
                .doesNotContain("LIKE").doesNotContain("BETWEEN").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 渠道编码唯一，查询必须精确匹配，避免命中签名相同的其它渠道。 */
    @Test
    void selectByCodeUsesExactEquality() {
        mapper.selectByCode("ALIYUN");

        assertThat(queryWrapper.getTargetSql()).contains("code =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("ALIYUN");
    }

}