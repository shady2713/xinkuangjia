package com.basicframework.module.system.service.dept;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import com.basicframework.framework.datapermission.core.util.DataPermissionUtils;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptListReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.mysql.dept.DeptMapper;
import com.basicframework.module.system.dal.redis.RedisKeyConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.google.common.annotations.VisibleForTesting;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import jakarta.annotation.Resource;
import java.util.*;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * 部门 Service 实现类
 *
 * @author 李杰
 */
@Service
@Validated
@Slf4j
public class DeptServiceImpl implements DeptService {

    @Resource
    private DeptMapper deptMapper;

    @Resource
    private ObjectProvider<AdminUserService> adminUserServiceProvider;

    @Resource
    private ObjectProvider<PermissionService> permissionServiceProvider;

    /**
     * 创建部门。
     *
     * @param createReqVO createReqVO 参数
     * @return 操作结果
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.DEPT_CHILDREN_ID_LIST,
            allEntries = true) // allEntries 清空所有缓存，因为操作一个部门，涉及到多个缓存
    public Long createDept(DeptSaveReqVO createReqVO) {
        if (createReqVO.getParentId() == null) {
            createReqVO.setParentId(DeptDO.PARENT_ID_ROOT);
        }
        // 非全量数据权限操作员不允许在根层级（parentId=0）脱离组织树新建顶层部门。
        validateRootDeptCreationAuthority(createReqVO.getParentId());
        // 校验父部门的有效性
        validateParentDept(null, createReqVO.getParentId());
        // 校验部门名的唯一性
        validateDeptNameUnique(null, createReqVO.getParentId(), createReqVO.getName());

        // 插入部门；优先继承父部门平台归属，根部门则跟随当前登录管理员平台类型（无上下文时默认 super_admin）。
        DeptDO dept = BeanUtils.toBean(createReqVO, DeptDO.class);
        dept.setRoleType(resolveDeptRoleType(createReqVO.getParentId()));
        deptMapper.insert(dept);
        return dept.getId();
    }

    /**
     * 解析新建部门所属的后台平台类型，确保 {@code system_dept.role_type} 非空且与组织树平台一致。
     *
     * @param parentId 父部门编号
     * @return 规范化后的平台类型标识
     */
    private String resolveDeptRoleType(Long parentId) {
        if (parentId != null && !DeptDO.PARENT_ID_ROOT.equals(parentId)) {
            DeptDO parentDept = deptMapper.selectById(parentId);
            if (parentDept != null && StrUtil.isNotBlank(parentDept.getRoleType())) {
                return parentDept.getRoleType();
            }
        }
        AdminUserService userService = adminUserServiceProvider != null ? adminUserServiceProvider.getIfAvailable() : null;
        if (userService != null) {
            String loginType = userService.getLoginUserTypeOrDefault();
            if (StrUtil.isNotBlank(loginType)) {
                return loginType;
            }
        }
        return AdminPlatformTypeEnum.SUPER_ADMIN.getType();
    }

    /**
     * 更新部门。
     *
     * @param updateReqVO updateReqVO 参数
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.DEPT_CHILDREN_ID_LIST,
            allEntries = true) // allEntries 清空所有缓存，因为操作一个部门，涉及到多个缓存
    public void updateDept(DeptSaveReqVO updateReqVO) {
        if (updateReqVO.getId() == null) {
            throw exception(DEPT_NOT_FOUND);
        }
        if (updateReqVO.getParentId() == null) {
            updateReqVO.setParentId(DeptDO.PARENT_ID_ROOT);
        }
        // 校验自己存在并归属当前平台
        DeptDO existing = validateDeptExists(updateReqVO.getId());
        validateDeptPlatform(existing);
        // 禁止无全量数据权限的操作员将子部门提升为顶级根部门。
        if (DeptDO.PARENT_ID_ROOT.equals(updateReqVO.getParentId())
                && (existing == null || !DeptDO.PARENT_ID_ROOT.equals(existing.getParentId()))) {
            validateRootDeptCreationAuthority(updateReqVO.getParentId());
        }
        // 校验父部门的有效性
        validateParentDept(updateReqVO.getId(), updateReqVO.getParentId());
        // 校验部门名的唯一性
        validateDeptNameUnique(updateReqVO.getId(), updateReqVO.getParentId(), updateReqVO.getName());

        // 更新部门（禁止篡改平台归属 roleType）
        DeptDO updateObj = BeanUtils.toBean(updateReqVO, DeptDO.class);
        updateObj.setRoleType(existing != null ? existing.getRoleType() : null);
        deptMapper.updateById(updateObj);
    }

    /**
     * 删除部门。
     *
     * @param id 主键编号
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.DEPT_CHILDREN_ID_LIST,
            allEntries = true) // allEntries 清空所有缓存，因为操作一个部门，涉及到多个缓存
    public void deleteDept(Long id) {
        if (id == null) {
            throw exception(DEPT_NOT_FOUND);
        }
        // 校验是否存在并归属当前平台
        DeptDO existing = validateDeptExists(id);
        validateDeptPlatform(existing);
        // 忽略数据权限统计真实子部门与活跃用户，防止 DEPT_CUSTOM 操作员因看不见子部门/用户而误删父部门产生孤儿数据。
        Long childCount = DataPermissionUtils.executeIgnore(() -> deptMapper.selectCountByParentId(id));
        if (childCount != null && childCount > 0) {
            throw exception(DEPT_EXITS_CHILDREN);
        }
        validateNoActiveUsersInDepts(Collections.singletonList(id));
        // 删除部门
        deptMapper.deleteById(id);
    }

    /**
     * 删除部门List。
     *
     * @param ids ids 编号集合
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.DEPT_CHILDREN_ID_LIST,
            allEntries = true) // allEntries 清空所有缓存，因为操作一个部门，涉及到多个缓存
    public void deleteDeptList(List<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return;
        }
        // 校验部门存在并归属当前平台
        for (Long id : ids) {
            validateDeptPlatform(validateDeptExists(id));
        }
        // 忽略数据权限校验是否有未包含在本次删除清单中的子部门，以及是否仍有活跃用户归属。
        for (Long id : ids) {
            Long childCount = DataPermissionUtils.executeIgnore(() -> deptMapper.selectCount(new LambdaQueryWrapperX<DeptDO>()
                    .eq(DeptDO::getParentId, id)
                    .notIn(DeptDO::getId, ids)));
            if (childCount != null && childCount > 0) {
                throw exception(DEPT_EXITS_CHILDREN);
            }
        }
        validateNoActiveUsersInDepts(ids);

        // 批量删除部门
        deptMapper.deleteByIds(ids);
    }

    /**
     * 校验部门下不存在活跃用户，避免删除部门后用户成为孤儿部门归属。
     *
     * @param deptIds 待删除部门编号集合
     */
    private void validateNoActiveUsersInDepts(Collection<Long> deptIds) {
        AdminUserService userService = adminUserServiceProvider != null ? adminUserServiceProvider.getIfAvailable() : null;
        if (userService == null || CollUtil.isEmpty(deptIds)) {
            return;
        }
        boolean hasUsers = Boolean.TRUE.equals(DataPermissionUtils.executeIgnore(
                () -> CollUtil.isNotEmpty(userService.getUserListByDeptIds(deptIds))));
        if (hasUsers) {
            throw exception(DEPT_EXISTS_USER);
        }
    }

    /**
     * 校验仅拥有全量数据权限的操作员可创建顶级根部门。
     *
     * @param parentId 父部门编号
     */
    private void validateRootDeptCreationAuthority(Long parentId) {
        if (!DeptDO.PARENT_ID_ROOT.equals(parentId)) {
            return;
        }
        Long operatorId = SecurityFrameworkUtils.getLoginUserId();
        if (operatorId == null) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        PermissionService permissionService = permissionServiceProvider != null
                ? permissionServiceProvider.getIfAvailable() : null;
        if (permissionService == null) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        var dataPerm = permissionService.getDeptDataPermission(operatorId);
        if (dataPerm != null && !Boolean.TRUE.equals(dataPerm.getAll())) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
    }

    /**
     * 校验目标部门与当前登录管理员归属同一管理平台。
     *
     * @param dept 目标部门
     */
    private void validateDeptPlatform(DeptDO dept) {
        if (dept == null || StrUtil.isBlank(dept.getRoleType())) {
            return;
        }
        Long operatorId = SecurityFrameworkUtils.getLoginUserId();
        if (operatorId == null) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        AdminUserService userService = adminUserServiceProvider != null ? adminUserServiceProvider.getIfAvailable() : null;
        if (userService == null) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        String loginType = userService.getLoginUserTypeOrDefault();
        if (!AdminPlatformTypeEnum.isSame(dept.getRoleType(), loginType)) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
    }

    /**
     * 校验 validateDeptExists 对应的输入与业务约束。
     *
     * @param id 部门编号
     * @return 匹配的部门记录，编号为空时返回 null
     */
    @VisibleForTesting
    DeptDO validateDeptExists(Long id) {
        if (id == null) {
            return null;
        }
        DeptDO dept = deptMapper.selectById(id);
        if (dept == null) {
            throw exception(DEPT_NOT_FOUND);
        }
        return dept;
    }

    /**
     * 校验 validateParentDept 对应的输入与业务约束。
     */
    @VisibleForTesting
    void validateParentDept(Long id, Long parentId) {
        if (parentId == null || DeptDO.PARENT_ID_ROOT.equals(parentId)) {
            return;
        }
        // 1. 不能设置自己为父部门
        if (Objects.equals(id, parentId)) {
            throw exception(DEPT_PARENT_ERROR);
        }
        // 2. 父部门不存在或跨平台
        DeptDO parentDept = deptMapper.selectById(parentId);
        if (parentDept == null) {
            throw exception(DEPT_PARENT_NOT_EXITS);
        }
        validateDeptPlatform(parentDept);
        // 3. 忽略数据权限递归校验真实祖先链，避免 DEPT_CUSTOM 隐藏中间节点绕过环路检测。
        if (id == null) { // id 为空，说明新增，不需要考虑环路
            return;
        }
        final DeptDO initialParent = parentDept;
        DataPermissionUtils.executeIgnore(() -> {
            DeptDO current = initialParent;
            Set<Long> visited = new HashSet<>();
            visited.add(current.getId());
            for (int i = 0; i < Short.MAX_VALUE; i++) {
                Long nextParentId = current.getParentId();
                if (Objects.equals(id, nextParentId)) {
                    throw exception(DEPT_PARENT_IS_CHILD);
                }
                if (nextParentId == null || DeptDO.PARENT_ID_ROOT.equals(nextParentId) || !visited.add(nextParentId)) {
                    break;
                }
                current = deptMapper.selectById(nextParentId);
                if (current == null) {
                    break;
                }
            }
        });
    }

    /**
     * 校验 validateDeptNameUnique 对应的输入与业务约束。
     */
    @VisibleForTesting
    void validateDeptNameUnique(Long id, Long parentId, String name) {
        DeptDO dept = deptMapper.selectByParentIdAndName(parentId, name);
        if (dept == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的部门
        if (id == null) {
            throw exception(DEPT_NAME_DUPLICATE);
        }
        if (ObjectUtil.notEqual(dept.getId(), id)) {
            throw exception(DEPT_NAME_DUPLICATE);
        }
    }

    /**
     * 获取部门。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    public DeptDO getDept(Long id) {
        DeptDO dept = deptMapper.selectById(id);
        validateDeptPlatform(dept);
        return dept;
    }

    /**
     * 获取部门List。
     *
     * @param ids ids 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public List<DeptDO> getDeptList(Collection<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return Collections.emptyList();
        }
        return deptMapper.selectByIds(ids);
    }

    /**
     * 获取部门List。
     *
     * @param reqVO 请求参数
     * @return 查询或转换后的结果
     */
    @Override
    public List<DeptDO> getDeptList(DeptListReqVO reqVO) {
        List<DeptDO> list = deptMapper.selectList(reqVO);
        Long operatorId = SecurityFrameworkUtils.getLoginUserId();
        AdminUserService userService = adminUserServiceProvider != null ? adminUserServiceProvider.getIfAvailable() : null;
        if (operatorId != null && userService != null) {
            String loginType = userService.getLoginUserTypeOrDefault();
            list = new ArrayList<>(list.stream()
                    .filter(dept -> StrUtil.isBlank(dept.getRoleType())
                            || AdminPlatformTypeEnum.isSame(dept.getRoleType(), loginType))
                    .toList());
        }
        list.sort(Comparator.comparing(DeptDO::getSort));
        return list;
    }

    /**
     * 获取子级部门List。
     *
     * @param ids ids 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public List<DeptDO> getChildDeptList(Collection<Long> ids) {
        List<DeptDO> children = new LinkedList<>();
        // 遍历每一层
        Collection<Long> parentIds = ids;
        for (int i = 0; i < Short.MAX_VALUE; i++) { // 使用 Short.MAX_VALUE 避免 bug 场景下，存在死循环
            // 查询当前层，所有的子部门
            List<DeptDO> depts = deptMapper.selectListByParentId(parentIds);
            // 1. 如果没有子部门，则结束遍历
            if (CollUtil.isEmpty(depts)) {
                break;
            }
            // 2. 如果有子部门，继续遍历
            children.addAll(depts);
            parentIds = convertSet(depts, DeptDO::getId);
        }
        return children;
    }

    /**
     * 获取部门ListByLeader用户Id。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    public List<DeptDO> getDeptListByLeaderUserId(Long id) {
        return deptMapper.selectListByLeaderUserId(id);
    }

    /**
     * 获取子级部门IdListFromCache。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    @DataPermission(enable = false) // 禁用数据权限，避免建立不正确的缓存
    @Cacheable(cacheNames = RedisKeyConstants.DEPT_CHILDREN_ID_LIST, key = "#id")
    public Set<Long> getChildDeptIdListFromCache(Long id) {
        List<DeptDO> children = getChildDeptList(id);
        return convertSet(children, DeptDO::getId);
    }

    /**
     * 校验部门List。
     *
     * @param ids ids 编号集合
     */
    @Override
    public void validateDeptList(Collection<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return;
        }
        // 获得科室信息
        Map<Long, DeptDO> deptMap = getDeptMap(ids);
        // 校验存在性、平台归属与启用状态
        ids.forEach(id -> {
            DeptDO dept = deptMap.get(id);
            if (dept == null) {
                throw exception(DEPT_NOT_FOUND);
            }
            validateDeptPlatform(dept);
            if (!CommonStatusEnum.ENABLE.getStatus().equals(dept.getStatus())) {
                throw exception(DEPT_NOT_ENABLE, dept.getName());
            }
        });
    }

    /**
     * 获取部门By名称。
     *
     * @param name name 参数
     * @return 查询或转换后的结果
     */
    @Override
    public DeptDO getDeptByName(String name) {
        if (StrUtil.isBlank(name)) {
            return null;
        }
        return deptMapper.selectFirstOne(DeptDO::getName, name);
    }

}
