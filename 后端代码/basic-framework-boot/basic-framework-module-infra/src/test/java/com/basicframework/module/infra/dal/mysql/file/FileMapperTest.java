package com.basicframework.module.infra.dal.mysql.file;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
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
 * 验证文件元数据分页的条件拼装。
 *
 * <p>路径与类型是管理端的检索条件，用模糊匹配即可；时间区间用于按上传批次清理。三者都可缺省，
 * 缺省时不得拼出空条件，否则清理任务会把条件传空后删掉全部文件元数据。</p>
 *
 * @author shady2713
 */
class FileMapperTest {

    /** 记录分页查询交给持久化层的条件对象。 */
    private AbstractWrapper<FileDO, ?, ?> queryWrapper;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象分页方法只记录条件。 */
    private FileMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), FileDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象分页查询记录条件后返回空页。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        mapper = mock(FileMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(1);
            IPage<FileDO> page = invocation.getArgument(0);
            page.setRecords(java.util.List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
    }

    /** 路径与类型按模糊匹配、上传时间按闭区间，并按编号倒序返回最新文件。 */
    @Test
    void selectPageAppliesFiltersAndOrdersById() {
        FilePageReqVO reqVO = new FilePageReqVO();
        reqVO.setPath("2026/09");
        reqVO.setType("image");
        LocalDateTime begin = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime end = LocalDateTime.of(2026, 9, 2, 23, 59, 59);
        reqVO.setCreateTime(new LocalDateTime[]{begin, end});

        mapper.selectPage(reqVO);

        assertThat(queryWrapper.getTargetSql())
                .contains("path LIKE").contains("type LIKE").contains("create_time BETWEEN")
                .contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .contains("%2026/09%", "%image%", begin, end);
    }

    /** 未带筛选条件时不得拼出空条件，排序仍然生效。 */
    @Test
    void selectPageWithoutFiltersOnlyKeepsOrdering() {
        mapper.selectPage(new FilePageReqVO());

        assertThat(queryWrapper.getTargetSql())
                .doesNotContain("LIKE").doesNotContain("BETWEEN").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

}