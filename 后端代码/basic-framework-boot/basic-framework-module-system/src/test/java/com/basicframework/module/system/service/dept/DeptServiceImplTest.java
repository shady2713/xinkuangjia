package com.basicframework.module.system.service.dept;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptListReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.dept.DeptMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.user.AdminUserService;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证部门服务的平台隔离、层级校验、删除保护与子级遍历契约。
 *
 * <p>部门数据同时服务两个管理平台：查询必须按当前平台过滤，否则会读到另一个平台的部门；
 * 创建与更新必须校验父部门有效、名称唯一并阻止把子部门设为父部门，否则会形成环路；
 * 删除必须拦住仍有子部门的节点，否则会留下悬空父子关系；子级遍历必须能在历史环路数据上
 * 有限结束且不重复返回同一部门。</p>
 *
 * <p>持久层按进程外边界替换为替身，服务内的校验、异常与遍历逻辑全部真实执行；
 * 异常断言核对真实业务错误码，遍历断言核对返回顺序与去重结果。</p>
 *
 * @author shady2713
 */
class DeptServiceImplTest {

    /** 当前登录用户所属平台类型。 */
    private static final String PLATFORM = AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();

    /** 被测服务。 */
    private DeptServiceImpl deptService;
    /** 部门持久层替身。 */
    private DeptMapper deptMapper;
    /** 用户服务替身，服务经延迟提供者获取以确定当前平台与校验负责人。 */
    private AdminUserService userService;

    /** 装配服务与替身，并固定当前平台类型。 */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        deptService = new DeptServiceImpl();
        deptMapper = mock(DeptMapper.class);
        userService = mock(AdminUserService.class);
        ObjectProvider<AdminUserService> userServiceProvider = mock(ObjectProvider.class);
        when(userServiceProvider.getObject()).thenReturn(userService);
        when(userService.getLoginUserTypeOrDefault()).thenReturn(PLATFORM);
        ReflectionTestUtils.setField(deptService, "deptMapper", deptMapper);
        ReflectionTestUtils.setField(deptService, "userServiceProvider", userServiceProvider);
    }

    /** 更新部门必须校验存在性与唯一性，并把当前平台写入更新对象。 */
    @Test
    void updateDeptValidatesAndWritesCurrentPlatform() {
        DeptSaveReqVO reqVO = new DeptSaveReqVO();
        reqVO.setId(1L);
        reqVO.setName("DUMMY-更新后");
        reqVO.setParentId(DeptDO.PARENT_ID_ROOT);
        when(deptMapper.selectById(1L)).thenReturn(dept(1L, "DUMMY-旧名", DeptDO.PARENT_ID_ROOT));
        when(deptMapper.selectByParentIdAndName(DeptDO.PARENT_ID_ROOT, "DUMMY-更新后", PLATFORM)).thenReturn(null);

        deptService.updateDept(reqVO);

        ArgumentCaptor<DeptDO> captor = ArgumentCaptor.forClass(DeptDO.class);
        verify(deptMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1L);
        assertThat(captor.getValue().getRoleType()).as("更新必须归属当前平台").isEqualTo(PLATFORM);
    }

    /** 更新部门未传父部门时必须落到根节点，避免出现无父级的游离节点。 */
    @Test
    void updateDeptDefaultsParentToRoot() {
        DeptSaveReqVO reqVO = new DeptSaveReqVO();
        reqVO.setId(1L);
        reqVO.setName("DUMMY-更新后");
        when(deptMapper.selectById(1L)).thenReturn(dept(1L, "DUMMY-旧名", DeptDO.PARENT_ID_ROOT));
        when(deptMapper.selectByParentIdAndName(DeptDO.PARENT_ID_ROOT, "DUMMY-更新后", PLATFORM)).thenReturn(null);

        deptService.updateDept(reqVO);

        assertThat(reqVO.getParentId()).isEqualTo(DeptDO.PARENT_ID_ROOT);
        verify(deptMapper).selectByParentIdAndName(DeptDO.PARENT_ID_ROOT, "DUMMY-更新后", PLATFORM);
    }

    /** 创建部门未传父部门时必须落到根节点并写入当前平台。 */
    @Test
    void createDeptDefaultsParentToRootAndWritesPlatform() {
        DeptSaveReqVO reqVO = new DeptSaveReqVO();
        reqVO.setName("DUMMY-新部门");
        when(deptMapper.selectByParentIdAndName(DeptDO.PARENT_ID_ROOT, "DUMMY-新部门", PLATFORM)).thenReturn(null);

        deptService.createDept(reqVO);

        assertThat(reqVO.getParentId()).isEqualTo(DeptDO.PARENT_ID_ROOT);
        ArgumentCaptor<DeptDO> captor = ArgumentCaptor.forClass(DeptDO.class);
        verify(deptMapper).insert(captor.capture());
        assertThat(captor.getValue().getRoleType()).isEqualTo(PLATFORM);
    }

    /** 负责人必须是同平台且启用的用户，否则拒绝创建部门。 */
    @Test
    void createDeptRejectsMissingOrDisabledLeader() {
        DeptSaveReqVO missingLeader = new DeptSaveReqVO();
        missingLeader.setName("DUMMY-新部门");
        missingLeader.setLeaderUserId(9L);
        when(deptMapper.selectByParentIdAndName(DeptDO.PARENT_ID_ROOT, "DUMMY-新部门", PLATFORM)).thenReturn(null);
        when(userService.getUser(9L, PLATFORM)).thenReturn(null);

        assertBusinessError(() -> deptService.createDept(missingLeader), ErrorCodeConstants.USER_NOT_EXISTS);

        DeptSaveReqVO disabledLeader = new DeptSaveReqVO();
        disabledLeader.setName("DUMMY-新部门");
        disabledLeader.setLeaderUserId(9L);
        AdminUserDO disabledUser = new AdminUserDO();
        disabledUser.setId(9L);
        disabledUser.setNickname("DUMMY-禁用用户");
        disabledUser.setStatus(CommonStatusEnum.DISABLE.getStatus());
        when(userService.getUser(9L, PLATFORM)).thenReturn(disabledUser);

        assertBusinessError(() -> deptService.createDept(disabledLeader), ErrorCodeConstants.USER_IS_DISABLE);
    }

    /** 负责人有效时必须正常创建部门，不得把启用用户误判为不可用。 */
    @Test
    void createDeptAcceptsEnabledLeader() {
        DeptSaveReqVO reqVO = new DeptSaveReqVO();
        reqVO.setName("DUMMY-新部门");
        reqVO.setLeaderUserId(9L);
        when(deptMapper.selectByParentIdAndName(DeptDO.PARENT_ID_ROOT, "DUMMY-新部门", PLATFORM)).thenReturn(null);
        AdminUserDO enabledUser = new AdminUserDO();
        enabledUser.setId(9L);
        enabledUser.setNickname("DUMMY-启用用户");
        enabledUser.setStatus(CommonStatusEnum.ENABLE.getStatus());
        when(userService.getUser(9L, PLATFORM)).thenReturn(enabledUser);

        deptService.createDept(reqVO);

        ArgumentCaptor<DeptDO> captor = ArgumentCaptor.forClass(DeptDO.class);
        verify(deptMapper).insert(captor.capture());
        assertThat(captor.getValue().getLeaderUserId()).isEqualTo(9L);
    }

    /** 删除部门时必须拦住仍有子部门的节点，并在无子部门时真实删除。 */
    @Test
    void deleteDeptRejectsChildrenAndDeletesLeaf() {
        when(deptMapper.selectById(1L)).thenReturn(dept(1L, "DUMMY-部门", DeptDO.PARENT_ID_ROOT));
        when(deptMapper.selectCountByParentId(1L)).thenReturn(1L);

        assertBusinessError(() -> deptService.deleteDept(1L), ErrorCodeConstants.DEPT_EXITS_CHILDREN);
        verify(deptMapper, never()).deleteById(any());

        when(deptMapper.selectCountByParentId(1L)).thenReturn(0L);
        deptService.deleteDept(1L);
        verify(deptMapper).deleteById(1L);
    }

    /** 批量删除必须逐个校验存在性，并拦住"被本次删除集合之外"的子部门。 */
    @Test
    void deleteDeptListValidatesEachIdAndRejectsExternalChildren() {
        when(deptMapper.selectById(1L)).thenReturn(dept(1L, "DUMMY-部门1", DeptDO.PARENT_ID_ROOT));
        when(deptMapper.selectById(2L)).thenReturn(dept(2L, "DUMMY-部门2", DeptDO.PARENT_ID_ROOT));
        when(deptMapper.selectCount(any())).thenReturn(1L);

        assertBusinessError(() -> deptService.deleteDeptList(List.of(1L, 2L)), ErrorCodeConstants.DEPT_EXITS_CHILDREN);
        verify(deptMapper, never()).deleteByIds(anyCollection());

        when(deptMapper.selectCount(any())).thenReturn(0L);
        deptService.deleteDeptList(List.of(1L, 2L));
        verify(deptMapper).deleteByIds(List.of(1L, 2L));
    }

    /** 批量删除遇到不存在的部门时必须立即失败，不得删除其余部门。 */
    @Test
    void deleteDeptListRejectsMissingDept() {
        when(deptMapper.selectById(1L)).thenReturn(null);

        assertBusinessError(() -> deptService.deleteDeptList(List.of(1L)), ErrorCodeConstants.DEPT_NOT_FOUND);
        verify(deptMapper, never()).deleteByIds(anyCollection());
    }

    /** 存在性校验对空编号直接放行，对不存在编号抛出明确错误。 */
    @Test
    void validateDeptExistsSkipsNullAndRejectsAbsent() {
        deptService.validateDeptExists(null);
        verify(deptMapper, never()).selectById(null);

        when(deptMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> deptService.validateDeptExists(9L), ErrorCodeConstants.DEPT_NOT_FOUND);
    }

    /** 父部门校验必须覆盖根节点放行、自引用、父级缺失、环路与遍历终止四类结果。 */
    @Test
    void validateParentDeptCoversAllRejectionAndTerminationPaths() {
        deptService.validateParentDept(1L, null);
        deptService.validateParentDept(1L, DeptDO.PARENT_ID_ROOT);
        verify(deptMapper, never()).selectById(any());

        assertBusinessError(() -> deptService.validateParentDept(1L, 1L), ErrorCodeConstants.DEPT_PARENT_ERROR);

        when(deptMapper.selectById(100L)).thenReturn(null);
        assertBusinessError(() -> deptService.validateParentDept(1L, 100L), ErrorCodeConstants.DEPT_PARENT_NOT_EXITS);

        when(deptMapper.selectById(100L)).thenReturn(dept(100L, "DUMMY-父部门", null));
        deptService.validateParentDept(null, 100L);

        when(deptMapper.selectById(200L)).thenReturn(dept(200L, "DUMMY-祖父部门", 1L));
        when(deptMapper.selectById(100L)).thenReturn(dept(100L, "DUMMY-父部门", 200L));
        assertBusinessError(() -> deptService.validateParentDept(1L, 100L), ErrorCodeConstants.DEPT_PARENT_IS_CHILD);

        when(deptMapper.selectById(200L)).thenReturn(dept(200L, "DUMMY-祖父部门", DeptDO.PARENT_ID_ROOT));
        deptService.validateParentDept(1L, 100L);

        when(deptMapper.selectById(200L)).thenReturn(null);
        deptService.validateParentDept(1L, 100L);
    }

    /** 名称唯一性校验必须区分新增、改到他人名称与保持自身名称三种结果。 */
    @Test
    void validateDeptNameUniqueDistinguishesCreateUpdateAndSelf() {
        when(deptMapper.selectByParentIdAndName(DeptDO.PARENT_ID_ROOT, "DUMMY-名称", PLATFORM)).thenReturn(null);
        deptService.validateDeptNameUnique(1L, DeptDO.PARENT_ID_ROOT, "DUMMY-名称");

        when(deptMapper.selectByParentIdAndName(DeptDO.PARENT_ID_ROOT, "DUMMY-名称", PLATFORM))
                .thenReturn(dept(2L, "DUMMY-名称", DeptDO.PARENT_ID_ROOT));
        assertBusinessError(() -> deptService.validateDeptNameUnique(null, DeptDO.PARENT_ID_ROOT, "DUMMY-名称"), ErrorCodeConstants.DEPT_NAME_DUPLICATE);
        assertBusinessError(() -> deptService.validateDeptNameUnique(1L, DeptDO.PARENT_ID_ROOT, "DUMMY-名称"), ErrorCodeConstants.DEPT_NAME_DUPLICATE);

        deptService.validateDeptNameUnique(2L, DeptDO.PARENT_ID_ROOT, "DUMMY-名称");
    }

    /** 查询必须按当前平台过滤，空编号集合直接返回空列表。 */
    @Test
    void getDeptListFiltersByPlatformAndShortCircuitsEmptyIds() {
        assertThat(deptService.getDeptList(Collections.emptyList())).isEmpty();
        verify(deptMapper, never()).selectListByIdsAndRoleType(anyCollection(), anyString());

        when(deptMapper.selectListByIdsAndRoleType(List.of(1L), PLATFORM))
                .thenReturn(List.of(dept(1L, "DUMMY-部门", DeptDO.PARENT_ID_ROOT)));
        assertThat(deptService.getDeptList(List.of(1L))).hasSize(1);
    }

    /** 查询条件列表必须按排序值升序返回，保证前端展示顺序稳定。 */
    @Test
    void getDeptListSortsBySortValue() {
        DeptDO second = dept(2L, "DUMMY-部门2", DeptDO.PARENT_ID_ROOT);
        second.setSort(20);
        DeptDO first = dept(1L, "DUMMY-部门1", DeptDO.PARENT_ID_ROOT);
        first.setSort(10);
        DeptListReqVO reqVO = new DeptListReqVO();
        when(deptMapper.selectList(reqVO, PLATFORM)).thenReturn(new java.util.ArrayList<>(List.of(second, first)));

        List<DeptDO> result = deptService.getDeptList(reqVO);

        assertThat(result).extracting(DeptDO::getId).containsExactly(1L, 2L);
    }

    /** 其它平台的部门编号必须查询不到，避免跨平台读取。 */
    @Test
    void getDeptRejectsOtherPlatform() {
        DeptDO otherPlatform = dept(1L, "DUMMY-部门", DeptDO.PARENT_ID_ROOT);
        otherPlatform.setRoleType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(deptMapper.selectById(1L)).thenReturn(otherPlatform);

        assertThat(deptService.getDept(1L)).isNull();
    }

    /** 负责人查询必须按当前平台过滤并原样转发编号。 */
    @Test
    void getDeptListByLeaderUserIdDelegatesWithPlatform() {
        when(deptMapper.selectListByLeaderUserId(9L, PLATFORM))
                .thenReturn(List.of(dept(1L, "DUMMY-部门", DeptDO.PARENT_ID_ROOT)));

        assertThat(deptService.getDeptListByLeaderUserId(9L)).hasSize(1);
        verify(deptMapper).selectListByLeaderUserId(9L, PLATFORM);
    }

    /** 子级遍历必须逐层展开、去重，并在没有下一层时结束。 */
    @Test
    void getChildDeptListWalksLayersWithoutDuplicates() {
        when(deptMapper.selectListByIdsAndRoleType(List.of(1L), PLATFORM))
                .thenReturn(List.of(dept(1L, "DUMMY-根", DeptDO.PARENT_ID_ROOT)));
        when(deptMapper.selectListByParentId(anyCollection(), anyString())).thenAnswer(invocation -> {
            Collection<Long> parentIds = invocation.getArgument(0);
            if (parentIds.contains(1L)) {
                return List.of(dept(2L, "DUMMY-子", 1L), dept(3L, "DUMMY-子2", 1L));
            }
            if (parentIds.contains(2L)) {
                return List.of(dept(4L, "DUMMY-孙", 2L));
            }
            return Collections.emptyList();
        });

        List<DeptDO> children = deptService.getChildDeptList(List.of(1L));

        assertThat(children).extracting(DeptDO::getId).containsExactly(2L, 3L, 4L);
    }

    /** 历史环路数据必须有限结束且不重复返回同一部门。 */
    @Test
    void getChildDeptListTerminatesOnCyclicData() {
        when(deptMapper.selectListByIdsAndRoleType(List.of(1L), PLATFORM))
                .thenReturn(List.of(dept(1L, "DUMMY-根", DeptDO.PARENT_ID_ROOT)));
        when(deptMapper.selectListByParentId(anyCollection(), anyString())).thenAnswer(invocation -> {
            Collection<Long> parentIds = invocation.getArgument(0);
            if (parentIds.contains(1L)) {
                return List.of(dept(2L, "DUMMY-子", 1L));
            }
            if (parentIds.contains(2L)) {
                return List.of(dept(1L, "DUMMY-根", 2L));
            }
            return Collections.emptyList();
        });

        assertThat(deptService.getChildDeptList(List.of(1L))).extracting(DeptDO::getId).containsExactly(2L);
    }

    /** 根部门不存在或编号集合为空时，子级列表必须返回空集合。 */
    @Test
    void getChildDeptListReturnsEmptyWithoutRoots() {
        when(deptMapper.selectListByIdsAndRoleType(List.of(1L), PLATFORM)).thenReturn(Collections.emptyList());

        assertThat(deptService.getChildDeptList(List.of(1L))).isEmpty();
        verify(deptMapper, never()).selectListByParentId(anyCollection(), anyString());
    }

    /** 子部门编号缓存必须按根部门自身的平台遍历，根不存在时返回空集合。 */
    @Test
    void getChildDeptIdListFromCacheUsesRootPlatform() {
        when(deptMapper.selectById(1L)).thenReturn(null);
        assertThat(deptService.getChildDeptIdListFromCache(1L)).isEmpty();

        DeptDO root = dept(1L, "DUMMY-根", DeptDO.PARENT_ID_ROOT);
        root.setRoleType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(deptMapper.selectById(1L)).thenReturn(root);
        when(deptMapper.selectListByParentId(anyCollection(), anyString()))
                .thenReturn(List.of(dept(2L, "DUMMY-子", 1L)));

        Set<Long> result = deptService.getChildDeptIdListFromCache(1L);

        assertThat(result).containsExactly(2L);
        verify(deptMapper).selectListByParentId(Collections.singleton(1L),
                AdminPlatformTypeEnum.SUPER_ADMIN.getType());
    }

    /** 批量校验必须跳过空集合，并对不存在与已禁用部门给出各自的业务错误。 */
    @Test
    void validateDeptListRejectsAbsentAndDisabledDepts() {
        deptService.validateDeptList(Collections.emptyList());
        verify(deptMapper, never()).selectListByIdsAndRoleType(anyCollection(), anyString());

        when(deptMapper.selectListByIdsAndRoleType(List.of(1L, 2L), PLATFORM)).thenReturn(List.of(
                dept(1L, "DUMMY-启用", DeptDO.PARENT_ID_ROOT)));
        assertBusinessError(() -> deptService.validateDeptList(List.of(1L, 2L)), ErrorCodeConstants.DEPT_NOT_FOUND);

        DeptDO disabled = dept(1L, "DUMMY-禁用", DeptDO.PARENT_ID_ROOT);
        disabled.setStatus(CommonStatusEnum.DISABLE.getStatus());
        when(deptMapper.selectListByIdsAndRoleType(List.of(1L), PLATFORM)).thenReturn(List.of(disabled));
        assertBusinessError(() -> deptService.validateDeptList(List.of(1L)), ErrorCodeConstants.DEPT_NOT_ENABLE);
    }

    /** 批量校验全部通过时必须正常返回，不得误报不存在或未启用。 */
    @Test
    void validateDeptListAcceptsEnabledDepts() {
        when(deptMapper.selectListByIdsAndRoleType(List.of(1L, 2L), PLATFORM)).thenReturn(List.of(
                dept(1L, "DUMMY-部门1", DeptDO.PARENT_ID_ROOT), dept(2L, "DUMMY-部门2", DeptDO.PARENT_ID_ROOT)));

        deptService.validateDeptList(List.of(1L, 2L));

        verify(deptMapper).selectListByIdsAndRoleType(List.of(1L, 2L), PLATFORM);
    }

    /** 按名称查询对空白名称直接返回空，正常名称按当前平台查询。 */
    @Test
    void getDeptByNameSkipsBlankAndFiltersByPlatform() {
        assertThat(deptService.getDeptByName(" ")).isNull();
        verify(deptMapper, never()).selectByNameAndRoleType(anyString(), anyString());

        when(deptMapper.selectByNameAndRoleType("DUMMY-部门", PLATFORM))
                .thenReturn(dept(1L, "DUMMY-部门", DeptDO.PARENT_ID_ROOT));
        assertThat(deptService.getDeptByName("DUMMY-部门")).isNotNull();
    }

    /**
     * 断言业务异常的错误码。
     *
     * <p>只匹配异常类型会放过错误码回归，因此按真实业务错误码逐条核对。</p>
     *
     * @param action 触发业务校验的动作
     * @param expected 期望的业务错误码
     */
    private static void assertBusinessError(ThrowingCallable action, ErrorCode expected) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(expected.getCode()));
    }

    /** 构造部门持久对象。 */
    private static DeptDO dept(Long id, String name, Long parentId) {
        DeptDO dept = new DeptDO();
        dept.setId(id);
        dept.setName(name);
        dept.setParentId(parentId);
        dept.setStatus(CommonStatusEnum.ENABLE.getStatus());
        dept.setSort(0);
        return dept;
    }

}
