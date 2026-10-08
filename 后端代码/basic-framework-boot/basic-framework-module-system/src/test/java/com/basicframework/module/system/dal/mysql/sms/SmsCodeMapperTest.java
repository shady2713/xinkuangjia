package com.basicframework.module.system.dal.mysql.sms;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.dal.dataobject.sms.SmsCodeDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * 验证验证码"取最新一条"查询的条件拼装。
 *
 * <p>校验验证码时必须拿到该手机号、该场景下最新的一条记录：编号越大的记录越新，验证码一旦重新发送，
 * 旧验证码就应当失效。手机号与场景是等值条件（场景缺省时按可选条件处理），编号必须倒序才能取到最新。</p>
 *
 * @author shady2713
 */
class SmsCodeMapperTest {

    /** 记录分页查询交给持久化层的条件对象。 */
    private AbstractWrapper<SmsCodeDO, ?, ?> queryWrapper;
    /** 分页查询要返回的记录；空列表用于表达"没有命中"。 */
    private List<SmsCodeDO> pageRecords;
    /** 记录最近一次分页查询交给分页插件的分页对象。 */
    private IPage<SmsCodeDO> pageRef;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象分页方法只记录条件。 */
    private SmsCodeMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), SmsCodeDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象分页查询按用例设定的方式回放真实副作用。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        pageRef = null;
        pageRecords = List.of(new SmsCodeDO());
        mapper = mock(SmsCodeMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            pageRef = invocation.getArgument(0);
            queryWrapper = invocation.getArgument(1);
            pageRef.setRecords(pageRecords);
            pageRef.setTotal((long) pageRecords.size());
            return pageRef;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
    }

    /** 手机号、场景与验证码都给出时，三条条件必须同时生效并按编号倒序取最新一条。 */
    @Test
    void selectLastByMobileCombinesConditionsAndOrdersByIdDescending() {
        SmsCodeDO found = mapper.selectLastByMobile("13800000000", "123456", 1);

        assertThat(found).as("命中时返回该条验证码记录").isNotNull();
        assertThat(queryWrapper.getTargetSql())
                .contains("mobile =").contains("scene =").contains("code =").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("13800000000", "123456", 1);
    }

    /** 场景与验证码缺省时不得拼出对应条件，否则会查不到任何历史验证码。 */
    @Test
    void selectLastByMobileSkipsAbsentOptionalConditions() {
        mapper.selectLastByMobile("13800000000", null, null);

        assertThat(queryWrapper.getTargetSql())
                .as("缺省条件不得拼出").doesNotContain("scene =").doesNotContain("code =")
                .contains("mobile =").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("13800000000");
    }

    /** 分页只取一条且不统计总数，避免每次校验都执行一次多余的 COUNT 查询。 */
    @Test
    void selectLastByMobileQueriesASingleRowWithoutCount() {
        mapper.selectLastByMobile("13800000000", "123456", 1);

        assertThat(pageRef.getCurrent()).isEqualTo(1);
        assertThat(pageRef.getSize()).isEqualTo(1);
        assertThat(pageRef.searchCount()).isFalse();
    }

    /** 没有命中记录时返回 null，校验入口据此按"验证码不存在"处理而不是收到空对象。 */
    @Test
    void selectLastByMobileReturnsNullWhenNothingMatches() {
        pageRecords = List.of();

        assertThat(mapper.selectLastByMobile("13800000000", "123456", 1)).isNull();
        assertThat(queryWrapper.getTargetSql()).contains("mobile =");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("13800000000");
    }

}