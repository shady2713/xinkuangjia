package com.basicframework.module.system.dal.mysql.logger;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.api.logger.dto.OperateLogPageReqDTO;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
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
 * 验证操作日志两种分页入口的条件口径差异。
 *
 * <p>管理端分页允许按类型、子类型与动作模糊检索，并支持创建时间区间，便于人工排查。跨模块的接口分页
 * 只能按精确的类型、业务编号与用户编号过滤：这些值来自调用方，若改成模糊匹配，调用方传一个业务编号
 * 前缀就会把其它业务的日志一起读出来。</p>
 *
 * @author shady2713
 */
class OperateLogMapperTest {

    /** 记录分页查询交给持久化层的条件对象。 */
    private AbstractWrapper<OperateLogDO, ?, ?> queryWrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private OperateLogMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), OperateLogDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象分页查询记录条件后返回空页。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        mapper = mock(OperateLogMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(1);
            IPage<OperateLogDO> page = invocation.getArgument(0);
            page.setRecords(java.util.List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
    }

    /** 管理端分页把六个筛选条件全部翻译成查询条件，并按编号倒序返回最新操作。 */
    @Test
    void adminPageAppliesAllFiltersAndOrdersById() {
        OperateLogPageReqVO reqVO = new OperateLogPageReqVO();
        reqVO.setUserId(7L);
        reqVO.setBizId(88L);
        reqVO.setType("create");
        reqVO.setSubType("user");
        reqVO.setAction("新增");
        LocalDateTime begin = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime end = LocalDateTime.of(2026, 9, 2, 23, 59, 59);
        reqVO.setCreateTime(new LocalDateTime[]{begin, end});

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("user_id =").contains("biz_id =").contains("type LIKE").contains("sub_type LIKE")
                .contains("action LIKE").contains("create_time BETWEEN").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .contains(7L, 88L, "%create%", "%user%", "%新增%", begin, end);
    }

    /** 管理端分页未带筛选条件时不得拼出空条件，排序仍然生效。 */
    @Test
    void adminPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new OperateLogPageReqVO());

        assertThat(queryWrapper.getTargetSql())
                .doesNotContain("LIKE").doesNotContain("BETWEEN").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 跨模块分页的三个条件都是精确匹配，不得退化为模糊检索把其它业务的日志读出来。 */
    @Test
    void dtoPageUsesExactEqualityOnly() {
        OperateLogPageReqDTO reqDTO = new OperateLogPageReqDTO();
        reqDTO.setType("create");
        reqDTO.setBizId(88L);
        reqDTO.setUserId(7L);

        mapper.selectPage(reqDTO);

        assertThat(queryWrapper.getTargetSql())
                .as("跨模块分页不得使用模糊匹配").doesNotContain("LIKE").doesNotContain("BETWEEN")
                .contains("type =").contains("biz_id =").contains("user_id =").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactlyInAnyOrder("create", 88L, 7L);
    }

    /** 跨模块分页条件缺省时按全量返回，并沿用编号倒序。 */
    @Test
    void dtoPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new OperateLogPageReqDTO());

        assertThat(queryWrapper.getTargetSql()).contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

}