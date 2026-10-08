package com.basicframework.module.system.dal.mysql.sms;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplatePageReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证短信模版查询的条件拼装。
 *
 * <p>模板编码是对外调用方指定的标识，必须精确匹配；模板内容与渠道侧模板编号只是管理端检索用的条件，
 * 用模糊匹配即可。渠道编号用于删除前的占用校验，必须精确匹配到单个渠道。</p>
 *
 * @author shady2713
 */
class SmsTemplateMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<SmsTemplateDO, ?, ?> queryWrapper;
    /** 计数查询要返回的数量。 */
    private long countResult;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private SmsTemplateMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), SmsTemplateDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        countResult = 0L;
        mapper = mock(SmsTemplateMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return countResult;
        }).when(mapper).selectCount(any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(1);
            IPage<SmsTemplateDO> page = invocation.getArgument(0);
            page.setRecords(java.util.List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
    }

    /** 模板编码唯一，查询必须精确匹配而不是模糊匹配。 */
    @Test
    void selectByCodeUsesExactEquality() {
        mapper.selectByCode("SMS_LOGIN");

        assertThat(queryWrapper.getTargetSql()).contains("code =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("SMS_LOGIN");
    }

    /** 模板分页把七个筛选条件翻译成对应的精确或模糊匹配，并按编号倒序返回。 */
    @Test
    void selectPageAppliesAllFiltersAndOrdersById() {
        SmsTemplatePageReqVO reqVO = new SmsTemplatePageReqVO();
        reqVO.setType(1);
        reqVO.setStatus(0);
        reqVO.setCode("SMS");
        reqVO.setContent("验证码");
        reqVO.setApiTemplateId("SMS_1");
        reqVO.setChannelId(3L);
        LocalDateTime begin = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime end = LocalDateTime.of(2026, 9, 2, 23, 59, 59);
        reqVO.setCreateTime(new LocalDateTime[]{begin, end});

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("type =").contains("status =").contains("code LIKE").contains("content LIKE")
                .contains("api_template_id LIKE").contains("channel_id =")
                .contains("create_time BETWEEN").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .contains(1, 0, "%SMS%", "%验证码%", "%SMS_1%", 3L, begin, end);
    }

    /** 未带筛选条件时不得拼出空条件，排序仍然生效。 */
    @Test
    void selectPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new SmsTemplatePageReqVO());

        assertThat(queryWrapper.getTargetSql())
                .doesNotContain("LIKE").doesNotContain("BETWEEN").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 按渠道统计模板数用于删除渠道前的占用校验，结果必须原样透传。 */
    @Test
    void selectCountByChannelIdReturnsDatabaseCount() {
        countResult = 4L;

        assertThat(mapper.selectCountByChannelId(3L)).isEqualTo(4L);
        assertThat(queryWrapper.getTargetSql()).contains("channel_id =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly(3L);
    }

}