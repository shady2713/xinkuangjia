package com.basicframework.module.system.service.permission;

import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.permission.vo.role.RolePageReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleSaveReqVO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.permission.UserRoleDO;
import com.basicframework.module.system.dal.mysql.permission.RoleMapper;
import com.basicframework.module.system.dal.mysql.permission.UserRoleMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.DataScopeEnum;
import com.basicframework.module.system.enums.permission.RoleCodeEnum;
import com.basicframework.module.system.enums.permission.RoleTypeEnum;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证角色服务的唯一性校验、内置角色保护、禁用引用保护与批量删除契约。
 *
 * <p>角色是权限与数据范围的载体，以下边界决定授权安全：超级管理员标识不允许被业务创建；
 * 名称与编码在新增与改名时都必须唯一，但更新自身记录不算冲突；系统内置角色不允许更新或删除；
 * 已分配给用户的启用角色不允许被禁用，否则存量用户会突然失去权限；批量删除必须逐条校验后再一次性删除，
 * 并对每个编号执行关联权限清理。</p>
 *
 * <p>角色缓存相关方法经 {@code SpringUtil} 获取自身代理以复用 Spring Cache 语义。本用例只把
 * {@code SpringUtil} 的静态上下文替换为返回同一实例的替身，不引入静态方法拦截；断言的是
 * "按编号逐个读取并在结果中过滤 null" 的循环契约，缓存代理本身不在此处验证。</p>
 *
 * <p>持久层、用户角色关联与权限服务按进程外边界替换为替身，服务内的转换、校验与异常逻辑真实执行。</p>
 *
 * @author shady2713
 */
class RoleServiceImplTest {

    /** 被测服务。 */
    private RoleServiceImpl roleService;
    /** 角色持久层替身。 */
    private RoleMapper roleMapper;
    /** 用户角色关联持久层替身。 */
    private UserRoleMapper userRoleMapper;
    /** 权限服务替身，用于验证删除角色后的关联清理。 */
    private PermissionService permissionService;
    /** 用例开始前的 {@code SpringUtil} 应用上下文，结束后原样恢复。 */
    private Object previousApplicationContext;
    /** 用例开始前的 {@code SpringUtil} Bean 工厂，结束后原样恢复。 */
    private Object previousBeanFactory;

    /** 装配服务与替身，并让自身代理查询返回同一实例。 */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        roleService = new RoleServiceImpl();
        roleMapper = mock(RoleMapper.class);
        userRoleMapper = mock(UserRoleMapper.class);
        permissionService = mock(PermissionService.class);
        ObjectProvider<PermissionService> permissionServiceProvider = mock(ObjectProvider.class);
        when(permissionServiceProvider.getObject()).thenReturn(permissionService);
        ReflectionTestUtils.setField(roleService, "roleMapper", roleMapper);
        ReflectionTestUtils.setField(roleService, "userRoleMapper", userRoleMapper);
        ReflectionTestUtils.setField(roleService, "permissionServiceProvider", permissionServiceProvider);

        previousApplicationContext = ReflectionTestUtils.getField(SpringUtil.class, "applicationContext");
        previousBeanFactory = ReflectionTestUtils.getField(SpringUtil.class, "beanFactory");
        ApplicationContext applicationContext = mock(ApplicationContext.class);
        when(applicationContext.getBean(RoleServiceImpl.class)).thenReturn(roleService);
        ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", null);
    }

    /** 还原 {@code SpringUtil} 静态上下文，避免影响同 JVM 内的其他用例。 */
    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", previousApplicationContext);
        ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", previousBeanFactory);
    }

    /** 创建角色必须校验唯一性，并补齐平台类型、角色类型、状态与默认数据范围。 */
    @Test
    void createRoleValidatesAndFillsDefaults() {
        RoleSaveReqVO reqVO = saveReqVO(null, "DUMMY-角色", "DUMMY_ROLE");
        reqVO.setRoleType(null);
        reqVO.setStatus(null);
        when(roleMapper.selectByName("DUMMY-角色")).thenReturn(null);
        when(roleMapper.selectByCode("DUMMY_ROLE")).thenReturn(null);
        doAnswer(invocation -> {
            invocation.getArgument(0, RoleDO.class).setId(100L);
            return 1;
        }).when(roleMapper).insert(any(RoleDO.class));

        Long id = roleService.createRole(reqVO, null);

        assertThat(id).as("创建结果必须返回落库后的主键").isEqualTo(100L);
        ArgumentCaptor<RoleDO> captor = ArgumentCaptor.forClass(RoleDO.class);
        verify(roleMapper).insert(captor.capture());
        RoleDO inserted = captor.getValue();
        assertThat(inserted.getRoleType()).as("平台类型缺省按历史业务平台处理")
                .isEqualTo(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        assertThat(inserted.getType()).isEqualTo(RoleTypeEnum.CUSTOM.getType());
        assertThat(inserted.getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(inserted.getDataScope()).as("新角色默认可查看所有数据").isEqualTo(DataScopeEnum.ALL.getScope());
    }

    /** 创建角色遇到超级管理员标识、重名或重复编码时必须拒绝。 */
    @Test
    void createRoleRejectsDuplicateIdentity() {
        RoleSaveReqVO superAdmin = saveReqVO(null, "DUMMY-角色", RoleCodeEnum.SUPER_ADMIN.getCode());
        assertBusinessError(() -> roleService.createRole(superAdmin, null), ErrorCodeConstants.ROLE_ADMIN_CODE_ERROR);

        RoleSaveReqVO duplicateName = saveReqVO(null, "DUMMY-角色", "DUMMY_ROLE");
        when(roleMapper.selectByName("DUMMY-角色")).thenReturn(role(2L, "DUMMY-角色", "DUMMY_OTHER"));
        assertBusinessError(() -> roleService.createRole(duplicateName, null), ErrorCodeConstants.ROLE_NAME_DUPLICATE);

        RoleSaveReqVO duplicateCode = saveReqVO(null, "DUMMY-其它角色", "DUMMY_ROLE");
        when(roleMapper.selectByName("DUMMY-其它角色")).thenReturn(null);
        when(roleMapper.selectByCode("DUMMY_ROLE")).thenReturn(role(3L, "DUMMY-其它角色", "DUMMY_ROLE"));
        assertBusinessError(() -> roleService.createRole(duplicateCode, null), ErrorCodeConstants.ROLE_CODE_DUPLICATE);

        verify(roleMapper, never()).insert(any(RoleDO.class));
    }

    /** 更新角色必须校验存在性、唯一性与"启用改禁用"的引用保护，通过后写库。 */
    @Test
    void updateRoleValidatesReferencesBeforeWriting() {
        RoleSaveReqVO reqVO = saveReqVO(1L, "DUMMY-角色", "DUMMY_ROLE");
        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-角色", "DUMMY_ROLE"));
        when(roleMapper.selectByName("DUMMY-角色")).thenReturn(role(1L, "DUMMY-角色", "DUMMY_ROLE"));
        when(roleMapper.selectByCode("DUMMY_ROLE")).thenReturn(role(1L, "DUMMY-角色", "DUMMY_ROLE"));

        roleService.updateRole(reqVO);

        ArgumentCaptor<RoleDO> captor = ArgumentCaptor.forClass(RoleDO.class);
        verify(roleMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1L);
    }

    /** 启用中的角色被用户引用时不允许禁用，且不得写库。 */
    @Test
    void updateRoleRejectsDisablingReferencedRole() {
        RoleSaveReqVO reqVO = saveReqVO(1L, "DUMMY-角色", "DUMMY_ROLE");
        reqVO.setStatus(CommonStatusEnum.DISABLE.getStatus());
        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-角色", "DUMMY_ROLE"));
        when(roleMapper.selectByName("DUMMY-角色")).thenReturn(role(1L, "DUMMY-角色", "DUMMY_ROLE"));
        when(roleMapper.selectByCode("DUMMY_ROLE")).thenReturn(role(1L, "DUMMY-角色", "DUMMY_ROLE"));
        when(userRoleMapper.selectListByRoleIds(Collections.singletonList(1L)))
                .thenReturn(List.of(new UserRoleDO()));

        assertThatThrownBy(() -> roleService.updateRole(reqVO))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode()).isEqualTo(ErrorCodeConstants.ROLE_IS_REFERENCED.getCode());
                    assertThat(exception.getMessage()).contains("DUMMY-角色");
                });
        verify(roleMapper, never()).updateById(any(RoleDO.class));
    }

    /** 更新不存在或系统内置的角色必须拒绝，且不得写库。 */
    @Test
    void updateRoleRejectsMissingAndSystemRole() {
        RoleSaveReqVO absent = saveReqVO(9L, "DUMMY-角色", "DUMMY_ROLE");
        when(roleMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> roleService.updateRole(absent), ErrorCodeConstants.ROLE_NOT_EXISTS);

        RoleSaveReqVO systemRole = saveReqVO(1L, "DUMMY-角色", "DUMMY_ROLE");
        RoleDO system = role(1L, "DUMMY-角色", "DUMMY_ROLE");
        system.setType(RoleTypeEnum.SYSTEM.getType());
        when(roleMapper.selectById(1L)).thenReturn(system);
        assertBusinessError(() -> roleService.updateRole(systemRole),
                ErrorCodeConstants.ROLE_CAN_NOT_UPDATE_SYSTEM_TYPE_ROLE);

        verify(roleMapper, never()).updateById(any(RoleDO.class));
    }

    /** 更新数据范围必须校验角色可更新，并且只提交编号、数据范围与部门集合。 */
    @Test
    void updateRoleDataScopeWritesOnlyScopeFields() {
        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-角色", "DUMMY_ROLE"));

        roleService.updateRoleDataScope(1L, DataScopeEnum.ALL.getScope(), Collections.singleton(7L));

        ArgumentCaptor<RoleDO> captor = ArgumentCaptor.forClass(RoleDO.class);
        verify(roleMapper).updateById(captor.capture());
        RoleDO update = captor.getValue();
        assertThat(update.getId()).isEqualTo(1L);
        assertThat(update.getDataScope()).isEqualTo(DataScopeEnum.ALL.getScope());
        assertThat(update.getDataScopeDeptIds()).containsExactly(7L);
        assertThat(update.getName()).as("数据范围更新不得顺带改写角色名称").isNull();
    }

    /** 删除单个角色必须先校验可更新，再删除并清理该角色的权限关联。 */
    @Test
    void deleteRoleDeletesAndCleansPermissions() {
        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-角色", "DUMMY_ROLE"));

        roleService.deleteRole(1L);

        verify(roleMapper).deleteById(1L);
        verify(permissionService).processRoleDeleted(1L);

        when(roleMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> roleService.deleteRole(9L), ErrorCodeConstants.ROLE_NOT_EXISTS);
        verify(roleMapper, never()).deleteById(9L);
    }

    /** 批量删除必须逐条校验后一次性删除，并对每个编号清理权限关联。 */
    @Test
    void deleteRoleListValidatesEachThenDeletesOnce() {
        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-角色一", "DUMMY_ROLE_1"));
        when(roleMapper.selectById(2L)).thenReturn(role(2L, "DUMMY-角色二", "DUMMY_ROLE_2"));

        roleService.deleteRoleList(List.of(1L, 2L));

        verify(roleMapper).deleteByIds(List.of(1L, 2L));
        verify(permissionService).processRoleDeleted(1L);
        verify(permissionService).processRoleDeleted(2L);
    }

    /** 批量删除中任一角色不可更新时必须整体拒绝，且不得删除任何记录。 */
    @Test
    void deleteRoleListRejectsWhenAnyRoleNotUpdatable() {
        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-角色一", "DUMMY_ROLE_1"));
        when(roleMapper.selectById(2L)).thenReturn(null);

        assertBusinessError(() -> roleService.deleteRoleList(List.of(1L, 2L)), ErrorCodeConstants.ROLE_NOT_EXISTS);
        verify(roleMapper, never()).deleteByIds(anyCollection());
    }

    /** 名称唯一性校验必须区分未命中、新增冲突、改到他人名称与保持自身名称。 */
    @Test
    void validateRoleDuplicateDistinguishesNameCases() {
        when(roleMapper.selectByName("DUMMY-角色")).thenReturn(null);
        roleService.validateRoleDuplicate("DUMMY-角色", "DUMMY_ROLE", 1L);

        when(roleMapper.selectByName("DUMMY-角色")).thenReturn(role(2L, "DUMMY-角色", "DUMMY_OTHER"));
        assertBusinessError(() -> roleService.validateRoleDuplicate("DUMMY-角色", "DUMMY_ROLE", null),
                ErrorCodeConstants.ROLE_NAME_DUPLICATE);
        assertBusinessError(() -> roleService.validateRoleDuplicate("DUMMY-角色", "DUMMY_ROLE", 1L),
                ErrorCodeConstants.ROLE_NAME_DUPLICATE);

        roleService.validateRoleDuplicate("DUMMY-角色", "DUMMY_ROLE", 2L);
    }

    /** 编码为空时必须跳过编码唯一性查询；编码冲突与保持自身编码按不同结果处理。 */
    @Test
    void validateRoleDuplicateSkipsBlankCodeAndChecksConflict() {
        when(roleMapper.selectByName("DUMMY-角色")).thenReturn(null);

        roleService.validateRoleDuplicate("DUMMY-角色", "", 1L);
        verify(roleMapper, never()).selectByCode("");

        when(roleMapper.selectByCode("DUMMY_ROLE")).thenReturn(null);
        roleService.validateRoleDuplicate("DUMMY-角色", "DUMMY_ROLE", 1L);

        when(roleMapper.selectByCode("DUMMY_ROLE")).thenReturn(role(2L, "DUMMY-其它角色", "DUMMY_ROLE"));
        assertBusinessError(() -> roleService.validateRoleDuplicate("DUMMY-角色", "DUMMY_ROLE", null),
                ErrorCodeConstants.ROLE_CODE_DUPLICATE);
        assertBusinessError(() -> roleService.validateRoleDuplicate("DUMMY-角色", "DUMMY_ROLE", 1L),
                ErrorCodeConstants.ROLE_CODE_DUPLICATE);

        roleService.validateRoleDuplicate("DUMMY-角色", "DUMMY_ROLE", 2L);
    }

    /** 查询方法必须原样转发到持久层，空编号集合直接返回空列表且不访问持久层。 */
    @Test
    void queryMethodsDelegateToMapper() {
        RolePageReqVO pageReqVO = new RolePageReqVO();
        when(roleMapper.selectPage(pageReqVO)).thenReturn(new PageResult<>(List.of(role(1L, "DUMMY-角色", "C")), 1L));
        assertThat(roleService.getRolePage(pageReqVO).getTotal()).isEqualTo(1L);

        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-角色", "DUMMY_ROLE"));
        assertThat(roleService.getRole(1L).getName()).isEqualTo("DUMMY-角色");
        assertThat(roleService.getRoleFromCache(1L).getName()).isEqualTo("DUMMY-角色");

        when(roleMapper.selectListByStatus(List.of(CommonStatusEnum.ENABLE.getStatus())))
                .thenReturn(List.of(role(1L, "DUMMY-角色", "DUMMY_ROLE")));
        assertThat(roleService.getRoleListByStatus(List.of(CommonStatusEnum.ENABLE.getStatus()))).hasSize(1);

        when(roleMapper.selectList()).thenReturn(List.of(role(1L, "DUMMY-角色", "DUMMY_ROLE")));
        assertThat(roleService.getRoleList()).hasSize(1);

        when(roleMapper.selectByIds(List.of(1L))).thenReturn(List.of(role(1L, "DUMMY-角色", "DUMMY_ROLE")));
        assertThat(roleService.getRoleList(List.of(1L))).hasSize(1);
        assertThat(roleService.getRoleList(Collections.<Long>emptyList())).isEmpty();
        verify(roleMapper, never()).selectByIds(Collections.emptyList());
    }

    /** 按平台类型查询必须在空值时按历史业务平台兜底，避免读到另一个平台的角色。 */
    @Test
    void getRoleListByRoleTypeDefaultsPlatform() {
        when(roleMapper.selectListByRoleType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()))
                .thenReturn(List.of(role(1L, "DUMMY-角色", "DUMMY_ROLE")));
        assertThat(roleService.getRoleListByRoleType(null)).hasSize(1);

        when(roleMapper.selectListByRoleType(AdminPlatformTypeEnum.SUPER_ADMIN.getType()))
                .thenReturn(List.of(role(2L, "DUMMY-超级角色", "DUMMY_SUPER_ROLE")));
        assertThat(roleService.getRoleListByRoleType(AdminPlatformTypeEnum.SUPER_ADMIN.getType())).hasSize(1);
    }

    /** 按编号从缓存批量读取必须保持顺序并过滤查不到的编号；空集合不访问持久层。 */
    @Test
    void getRoleListFromCacheReadsEachIdAndFiltersNull() {
        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-角色一", "DUMMY_ROLE_1"));
        when(roleMapper.selectById(2L)).thenReturn(null);
        when(roleMapper.selectById(3L)).thenReturn(role(3L, "DUMMY-角色三", "DUMMY_ROLE_3"));

        List<RoleDO> result = roleService.getRoleListFromCache(List.of(1L, 2L, 3L));

        assertThat(result).extracting(RoleDO::getId).as("查不到的编号不得以 null 形式进入结果")
                .containsExactly(1L, 3L);
        assertThat(roleService.getRoleListFromCache(Collections.<Long>emptyList())).isEmpty();
    }

    /** 超级管理员判定必须短路返回，并在空集合时直接返回 false。 */
    @Test
    void hasAnySuperAdminShortCircuits() {
        assertThat(roleService.hasAnySuperAdmin(Collections.<Long>emptyList())).isFalse();

        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-超级角色", RoleCodeEnum.SUPER_ADMIN.getCode()));
        assertThat(roleService.hasAnySuperAdmin(List.of(1L, 2L))).isTrue();
        verify(roleMapper, never()).selectById(2L);

        when(roleMapper.selectById(1L)).thenReturn(role(1L, "DUMMY-角色一", "DUMMY_ROLE_1"));
        when(roleMapper.selectById(2L)).thenReturn(role(2L, "DUMMY-角色二", "DUMMY_ROLE_2"));
        assertThat(roleService.hasAnySuperAdmin(List.of(1L, 2L))).isFalse();
    }

    /** 角色列表校验必须对空集合放行，对缺失编号报不存在、对禁用角色报具体名称。 */
    @Test
    void validateRoleListChecksExistenceAndStatus() {
        roleService.validateRoleList(Collections.emptyList());
        verify(roleMapper, never()).selectByIds(anyCollection());

        when(roleMapper.selectByIds(List.of(1L, 2L)))
                .thenReturn(List.of(role(1L, "DUMMY-角色一", "DUMMY_ROLE_1")));
        assertBusinessError(() -> roleService.validateRoleList(List.of(1L, 2L)), ErrorCodeConstants.ROLE_NOT_EXISTS);

        RoleDO disabled = role(1L, "DUMMY-角色一", "DUMMY_ROLE_1");
        disabled.setStatus(CommonStatusEnum.DISABLE.getStatus());
        when(roleMapper.selectByIds(List.of(1L))).thenReturn(List.of(disabled));
        assertThatThrownBy(() -> roleService.validateRoleList(List.of(1L)))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode()).isEqualTo(ErrorCodeConstants.ROLE_IS_DISABLE.getCode());
                    assertThat(exception.getMessage()).contains("DUMMY-角色一");
                });

        when(roleMapper.selectByIds(List.of(1L))).thenReturn(List.of(role(1L, "DUMMY-角色一", "DUMMY_ROLE_1")));
        roleService.validateRoleList(List.of(1L));
    }

    /**
     * 断言业务异常的错误码。
     *
     * @param action 触发业务校验的动作
     * @param expected 期望的业务错误码
     */
    private static void assertBusinessError(ThrowingCallable action, ErrorCode expected) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(expected.getCode()));
    }

    /**
     * 构造角色保存参数。
     *
     * @param id 角色编号，新增时为空
     * @param name 角色名称
     * @param code 角色编码
     * @return 保存参数
     */
    private static RoleSaveReqVO saveReqVO(Long id, String name, String code) {
        RoleSaveReqVO reqVO = new RoleSaveReqVO();
        reqVO.setId(id);
        reqVO.setName(name);
        reqVO.setCode(code);
        reqVO.setSort(1);
        reqVO.setStatus(CommonStatusEnum.ENABLE.getStatus());
        return reqVO;
    }

    /**
     * 构造自定义类型、启用状态的角色。
     *
     * @param id 编号
     * @param name 名称
     * @param code 编码
     * @return 角色
     */
    private static RoleDO role(Long id, String name, String code) {
        RoleDO role = new RoleDO();
        role.setId(id);
        role.setName(name);
        role.setCode(code);
        role.setType(RoleTypeEnum.CUSTOM.getType());
        role.setStatus(CommonStatusEnum.ENABLE.getStatus());
        role.setSort(1);
        return role;
    }

}
