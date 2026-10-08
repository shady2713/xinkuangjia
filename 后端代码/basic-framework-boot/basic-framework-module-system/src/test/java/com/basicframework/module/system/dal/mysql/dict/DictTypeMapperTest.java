package com.basicframework.module.system.dal.mysql.dict;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypePageReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 验证字典类型的条件拼装与逻辑删除条件。
 *
 * <p>字典类型采用逻辑删除：删除时把 {@code deleted} 置为真并记录删除时间与操作人，而不是物理删除，
 * 这样历史引用仍然可追溯。批量删除的编号集合可能为空，空集合必须直接返回 0 且不发出任何更新语句——
 * 否则退化成无 WHERE 的更新会把整张字典类型表标记为已删除。</p>
 *
 * @author shady2713
 */
class DictTypeMapperTest {

    /** 记录查询或更新交给持久化层的条件对象。 */
    private AbstractWrapper<DictTypeDO, ?, ?> wrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private DictTypeMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), DictTypeDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询与更新方法记录条件。 */
    @BeforeEach
    void setUp() {
        wrapper = null;
        mapper = mock(DictTypeMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(1);
            IPage<DictTypeDO> page = invocation.getArgument(0);
            page.setRecords(List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
        doAnswer(invocation -> {
            wrapper = invocation.getArgument(1);
            return 1;
        }).when(mapper).update(isNull(), any(Wrapper.class));
    }

    /** 字典类型分页应用名称与类型模糊匹配、状态精确匹配与创建时间区间，并按编号倒序返回。 */
    @Test
    void selectPageAppliesAllFiltersAndOrdersById() {
        DictTypePageReqVO reqVO = new DictTypePageReqVO();
        reqVO.setName("状态");
        reqVO.setType("sys_status");
        reqVO.setStatus(0);
        LocalDateTime begin = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime end = LocalDateTime.of(2026, 9, 2, 23, 59, 59);
        reqVO.setCreateTime(new LocalDateTime[]{begin, end});

        mapper.selectPage(reqVO);

        assertThat(wrapper.getTargetSql())
                .contains("name LIKE").contains("type LIKE").contains("status =")
                .contains("create_time BETWEEN").contains("ORDER BY id DESC");
        assertThat(wrapper.getParamNameValuePairs().values())
                .contains("%状态%", "%sys_status%", 0, begin, end);
    }

    /** 未带筛选条件时不得拼出空条件，排序仍然生效。 */
    @Test
    void selectPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new DictTypePageReqVO());

        assertThat(wrapper.getTargetSql())
                .doesNotContain("LIKE").doesNotContain("BETWEEN").contains("ORDER BY id DESC");
        assertThat(wrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 字典类型编码与名称都要唯一，查询必须精确匹配而不是模糊匹配。 */
    @Test
    void selectByTypeAndNameUseExactEquality() {
        mapper.selectByType("sys_status");
        assertThat(wrapper.getTargetSql()).contains("type =").doesNotContain("LIKE");

        mapper.selectByName("状态");
        assertThat(wrapper.getTargetSql()).contains("name =").doesNotContain("LIKE");
        assertThat(wrapper.getParamNameValuePairs().values()).containsExactly("状态");
    }

    /** 单条逻辑删除必须同时写入删除标记、删除时间、操作人，并把范围限定在该条记录上。 */
    @Test
    void updateToDeleteMarksTheRowDeletedWithAuditingFields() {
        LocalDateTime deletedTime = LocalDateTime.of(2026, 9, 5, 10, 0);

        mapper.updateToDelete(9L, deletedTime, "admin");

        assertThat(wrapper.getSqlSet())
                .as("逻辑删除必须写入删除标记、删除时间与操作人")
                .contains("deleted").contains("deleted_time").contains("updater");
        assertThat(wrapper.getTargetSql()).contains("id =");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(true, deletedTime, "admin", 9L);
    }

    /** 操作人缺省时不得写入该列，否则会把已有操作人覆盖为空。 */
    @Test
    void updateToDeleteOmitsUpdaterWhenNotSupplied() {
        LocalDateTime deletedTime = LocalDateTime.of(2026, 9, 5, 10, 0);

        mapper.updateToDelete(9L, deletedTime, null);

        assertThat(wrapper.getSqlSet()).doesNotContain("updater").contains("deleted").contains("deleted_time");
        assertThat(wrapper.getTargetSql()).contains("id =");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(true, deletedTime, 9L).doesNotContainNull();
    }

    /** 批量逻辑删除的编号集合非空时按 IN 更新，并返回受影响的行数。 */
    @Test
    void updateToDeleteByIdsUsesInConditionForNonEmptyCollection() {
        Collection<Long> ids = List.of(1L, 2L, 3L);
        LocalDateTime deletedTime = LocalDateTime.of(2026, 9, 5, 10, 0);

        int updated = mapper.updateToDeleteByIds(ids, deletedTime, "admin");

        assertThat(updated).isEqualTo(1);
        assertThat(wrapper.getSqlSet()).contains("deleted").contains("deleted_time").contains("updater");
        assertThat(wrapper.getTargetSql()).contains("id IN");
        assertThat(wrapper.getParamNameValuePairs().values())
                .contains(true, deletedTime, "admin", 1L, 2L, 3L);
    }

    /** 编号集合为空时必须直接返回 0 且不发出更新，否则会退化成无 WHERE 的全表逻辑删除。 */
    @Test
    void updateToDeleteByIdsWithEmptyCollectionIssuesNoUpdate() {
        LocalDateTime deletedTime = LocalDateTime.of(2026, 9, 5, 10, 0);

        assertThat(mapper.updateToDeleteByIds(List.of(), deletedTime, "admin")).isZero();
        assertThat(mapper.updateToDeleteByIds(null, deletedTime, "admin")).isZero();

        verify(mapper, never()).update(isNull(), any(Wrapper.class));
        assertThat(wrapper).as("空集合路径不得拼出任何更新条件").isNull();
    }

}