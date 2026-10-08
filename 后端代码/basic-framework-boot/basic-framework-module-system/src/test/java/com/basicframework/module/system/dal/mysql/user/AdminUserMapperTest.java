package com.basicframework.module.system.dal.mysql.user;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.basicframework.module.system.controller.admin.user.vo.user.UserPageReqVO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
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
 * 验证管理员账号查询的条件拼装，重点是跨平台同名账号的隔离。
 *
 * <p>管理平台与业务平台允许存在同名账号，因此带平台类型的查询必须把 {@code user_type} 与账号名或
 * 手机号一起作为条件；漏掉平台条件会让登录入口按手机号或账号名命中另一个平台的账号，等于把别人的
 * 账号当成当前平台的账号放行。</p>
 *
 * <p>业务管理平台还兼容一批平台字段为空的老账号，只能对该平台放开这个兼容分支，扩大到其它平台
 * 就会让管理平台的匿名账号共享业务平台的权限边界。</p>
 *
 * @author shady2713
 */
class AdminUserMapperTest {

    /** 记录查询交给持久化层的条件对象。 */
    private AbstractWrapper<AdminUserDO, ?, ?> queryWrapper;
    /** 记录最近一次分页查询交给分页插件的分页对象。 */
    private IPage<AdminUserDO> page;
    /** 被测 Mapper 替身；默认方法走真实实现，抽象方法只记录条件。 */
    private AdminUserMapper mapper;

    /**
     * 初始化实体的 MyBatis-Plus 元数据，使条件对象能解析出真实列名。
     *
     * <p>生产由 MyBatis-Plus 在装配 Mapper 时完成同一步骤。</p>
     */
    @BeforeAll
    static void initTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), AdminUserDO.class);
    }

    /** 为每个用例创建独立替身，并让抽象查询方法记录条件后返回空结果。 */
    @BeforeEach
    void setUp() {
        queryWrapper = null;
        page = null;
        mapper = mock(AdminUserMapper.class, CALLS_REAL_METHODS);
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return null;
        }).when(mapper).selectOne(any(Wrapper.class));
        doAnswer(invocation -> {
            page = invocation.getArgument(0);
            queryWrapper = invocation.getArgument(1);
            page.setRecords(List.of());
            return page;
        }).when(mapper).selectPage(any(IPage.class), any(Wrapper.class));
        doAnswer(invocation -> {
            queryWrapper = invocation.getArgument(0);
            return List.of();
        }).when(mapper).selectList(any(Wrapper.class));
    }

    /** 按编号加锁查询必须只锁定指定行，供改密码、解锁等串行化更新使用。 */
    @Test
    void selectByIdForUpdateLocksExactlyTheRequestedRow() {
        mapper.selectByIdForUpdate(7L);

        assertThat(queryWrapper.getTargetSql()).contains("id =").endsWith("FOR UPDATE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(7L);
    }

    /** 按账号名查询不带平台条件，用于平台内唯一性检查，与登录入口的带平台查询区分。 */
    @Test
    void selectByUsernameUsesExactEqualityOnly() {
        mapper.selectByUsername("admin");

        assertThat(queryWrapper.getTargetSql()).contains("username =").doesNotContain("user_type");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly("admin");
    }

    /** 登录入口按账号名加平台类型查询，平台条件必须同时生效，避免命中另一个平台的同名账号。 */
    @Test
    void selectByUsernameAndUserTypeCarriesPlatformCondition() {
        mapper.selectByUsernameAndUserType("admin", AdminPlatformTypeEnum.SUPER_ADMIN.getType());

        assertThat(queryWrapper.getTargetSql()).contains("username =").contains("user_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .containsExactlyInAnyOrder("admin", AdminPlatformTypeEnum.SUPER_ADMIN.getType());
    }

    /** 按邮箱与手机号查询同样使用精确匹配，模糊匹配会把相近的邮箱当成同一账号。 */
    @Test
    void selectByEmailAndMobileUseExactEquality() {
        mapper.selectByEmail("a@b.com");
        assertThat(queryWrapper.getTargetSql()).contains("email =").doesNotContain("LIKE");

        mapper.selectByMobile("13800000000");
        assertThat(queryWrapper.getTargetSql()).contains("mobile =").doesNotContain("LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("13800000000");
    }

    /** 按手机号登录必须同时限定平台类型，否则同名手机号会跨平台串号登录。 */
    @Test
    void selectByMobileAndUserTypeCarriesPlatformCondition() {
        mapper.selectByMobileAndUserType("13800000000", AdminPlatformTypeEnum.SUPER_ADMIN.getType());

        assertThat(queryWrapper.getTargetSql()).contains("mobile =").contains("user_type =");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .contains("13800000000", AdminPlatformTypeEnum.SUPER_ADMIN.getType());
    }

    /** 用户分页按所属部门与编号集合收窄范围，两个集合都为空时不得拼出空的 IN 条件。 */
    @Test
    void selectPageAppliesDepartmentAndUserIdFiltersAndOrdersById() {
        UserPageReqVO reqVO = new UserPageReqVO();
        reqVO.setUsername("adm");

        mapper.selectPage(reqVO, List.<Long>of(10L, 20L), List.<Long>of(1L, 2L));

        assertThat(queryWrapper.getTargetSql())
                .contains("username LIKE").contains("dept_id IN").contains("id IN").contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("%adm%", 10L, 20L, 1L, 2L);
    }

    /** 部门与用户集合都为空时只能按请求自身的可选条件过滤，不得退化成全表条件。 */
    @Test
    void selectPageWithoutCollectionsProducesNoInCondition() {
        UserPageReqVO reqVO = new UserPageReqVO();

        mapper.selectPage(reqVO, List.<Long>of(), null);

        assertThat(queryWrapper.getTargetSql())
                .as("空集合不得拼出 IN").doesNotContain("dept_id IN").doesNotContain("id IN")
                .contains("ORDER BY id DESC");
        assertThat(queryWrapper.getParamNameValuePairs()).isEmpty();
    }

    /** 自定义页码与每页条数必须原样传给分页插件。 */
    @Test
    void selectPageForwardsPagingParameters() {
        UserPageReqVO reqVO = new UserPageReqVO();
        reqVO.setPageNo(2);
        reqVO.setPageSize(30);

        mapper.selectPage(reqVO, (java.util.Collection<Long>) null, null);

        assertThat(page.getCurrent()).isEqualTo(2);
        assertThat(page.getSize()).isEqualTo(30);
    }

    /** 昵称查询按模糊匹配，用于成员选择器按关键字检索。 */
    @Test
    void selectListByNicknameUsesLikeMatching() {
        mapper.selectListByNickname("张");

        assertThat(queryWrapper.getTargetSql()).contains("nickname LIKE");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains("%张%");
    }

    /** 按状态查询只带状态条件，不得顺带按昵称或平台过滤。 */
    @Test
    void selectListByStatusUsesOnlyStatusCondition() {
        mapper.selectListByStatus(1);

        assertThat(queryWrapper.getTargetSql()).contains("status =").doesNotContain("nickname");
        assertThat(queryWrapper.getParamNameValuePairs().values()).containsExactly(1);
    }

    /**
     * 业务管理平台兼容平台字段为空的老账号，必须生成"等于平台或为空"的三分支条件。
     *
     * <p>写成一个简单等值条件会让这批老账号在业务平台登录时查不到自己，只能迁移数据才能登录。</p>
     */
    @Test
    void businessPlatformAlsoMatchesLegacyAccountsWithoutPlatformField() {
        mapper.selectListByStatusAndUserType(1, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        assertThat(queryWrapper.getTargetSql())
                .contains("status =").contains("user_type =").contains("user_type IS NULL").contains("OR");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .contains(1, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType(), "");
    }

    /** 其它平台不得继承老账号兼容分支，否则平台为空的历史账号会获得跨平台可见性。 */
    @Test
    void otherPlatformsDoNotInheritLegacyCompatibility() {
        mapper.selectListByStatusAndUserType(1, AdminPlatformTypeEnum.SUPER_ADMIN.getType());

        assertThat(queryWrapper.getTargetSql())
                .contains("status =").contains("user_type =").doesNotContain("IS NULL");
        assertThat(queryWrapper.getParamNameValuePairs().values())
                .contains(1, AdminPlatformTypeEnum.SUPER_ADMIN.getType()).doesNotContain("");
    }

    /** 按部门编号集合查询用于数据权限过滤，空集合必须直接返回空列表而不是退化成全部门。 */
    @Test
    void selectListByDeptIdsUsesInCondition() {
        mapper.selectListByDeptIds(List.of(3L, 4L));

        assertThat(queryWrapper.getTargetSql()).contains("dept_id IN");
        assertThat(queryWrapper.getParamNameValuePairs().values()).contains(3L, 4L);
    }

}