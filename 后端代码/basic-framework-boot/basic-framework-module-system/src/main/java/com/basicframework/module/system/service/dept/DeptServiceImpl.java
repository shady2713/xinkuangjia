package com.basicframework.module.system.service.dept;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import com.basicframework.framework.datapermission.core.util.DataPermissionUtils;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptListReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.mysql.dept.DeptMapper;
import com.basicframework.module.system.dal.redis.RedisKeyConstants;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.user.AdminUserService;
import com.google.common.annotations.VisibleForTesting;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.annotation.Transactional;
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
    private ObjectProvider<AdminUserService> userServiceProvider;

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
        // 校验父部门的有效性
        validateParentDept(null, createReqVO.getParentId());
        // 校验部门名的唯一性
        validateDeptNameUnique(null, createReqVO.getParentId(), createReqVO.getName());
        validateLeaderUser(createReqVO.getLeaderUserId());

        // 插入部门
        DeptDO dept = BeanUtils.toBean(createReqVO, DeptDO.class);
        dept.setRoleType(currentPlatform());
        deptMapper.insert(dept);
        return dept.getId();
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
        if (updateReqVO.getParentId() == null) {
            updateReqVO.setParentId(DeptDO.PARENT_ID_ROOT);
        }
        // 校验自己存在
        validateDeptExists(updateReqVO.getId());
        // 校验父部门的有效性
        validateParentDept(updateReqVO.getId(), updateReqVO.getParentId());
        // 校验部门名的唯一性
        validateDeptNameUnique(updateReqVO.getId(), updateReqVO.getParentId(), updateReqVO.getName());
        validateLeaderUser(updateReqVO.getLeaderUserId());

        // 更新部门
        DeptDO updateObj = BeanUtils.toBean(updateReqVO, DeptDO.class);
        updateObj.setRoleType(currentPlatform());
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
        // 校验是否存在
        validateDeptExists(id);
        // 校验是否有子部门
        if (DataPermissionUtils.executeIgnore(() -> deptMapper.selectCountByParentId(id)) > 0) {
            throw exception(DEPT_EXITS_CHILDREN);
        }
        // 删除部门
        deptMapper.deleteById(id);
    }

    /**
     * 删除部门List。
     *
     * @param ids ids 编号集合
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @CacheEvict(cacheNames = RedisKeyConstants.DEPT_CHILDREN_ID_LIST,
            allEntries = true) // allEntries 清空所有缓存，因为操作一个部门，涉及到多个缓存
    public void deleteDeptList(List<Long> ids) {
        // 校验部门存在
        ids.forEach(this::validateDeptExists);
        // 校验是否有子部门（排除本次也要删除的部门）
        for (Long id : ids) {
            if (DataPermissionUtils.executeIgnore(() -> deptMapper.selectCount(new LambdaQueryWrapperX<DeptDO>()
                    .eq(DeptDO::getParentId, id)
                    .notIn(DeptDO::getId, ids))) > 0) {
                throw exception(DEPT_EXITS_CHILDREN);
            }
        }

        // 批量删除部门
        deptMapper.deleteByIds(ids);
    }

    /**
     * 校验 validateDeptExists 对应的输入与业务约束。
     */
    @VisibleForTesting
    void validateDeptExists(Long id) {
        if (id == null) {
            return;
        }
        DeptDO dept = getDept(id);
        if (dept == null) {
            throw exception(DEPT_NOT_FOUND);
        }
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
        // 2. 父部门不存在
        DeptDO parentDept = getDept(parentId);
        if (parentDept == null) {
            throw exception(DEPT_PARENT_NOT_EXITS);
        }
        // 3. 递归校验父部门，如果父部门是自己的子部门，则报错，避免形成环路
        if (id == null) { // id 为空，说明新增，不需要考虑环路
            return;
        }
        for (int i = 0; i < Short.MAX_VALUE; i++) {
            // 3.1 校验环路
            parentId = parentDept.getParentId();
            if (Objects.equals(id, parentId)) {
                throw exception(DEPT_PARENT_IS_CHILD);
            }
            // 3.2 继续递归下一级父部门
            if (parentId == null || DeptDO.PARENT_ID_ROOT.equals(parentId)) {
                break;
            }
            parentDept = getDept(parentId);
            if (parentDept == null) {
                break;
            }
        }
    }

    /**
     * 校验 validateDeptNameUnique 对应的输入与业务约束。
     */
    @VisibleForTesting
    void validateDeptNameUnique(Long id, Long parentId, String name) {
        DeptDO dept = DataPermissionUtils.executeIgnore(
                () -> deptMapper.selectByParentIdAndName(parentId, name, currentPlatform()));
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
        return dept != null && AdminPlatformTypeEnum.isSame(dept.getRoleType(), currentPlatform()) ? dept : null;
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
        return deptMapper.selectListByIdsAndRoleType(ids, currentPlatform());
    }

    /**
     * 获取部门List。
     *
     * @param reqVO 请求参数
     * @return 查询或转换后的结果
     */
    @Override
    public List<DeptDO> getDeptList(DeptListReqVO reqVO) {
        List<DeptDO> list = deptMapper.selectList(reqVO, currentPlatform());
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
        List<DeptDO> roots = getDeptList(ids);
        if (roots.isEmpty()) {
            return Collections.emptyList();
        }
        return findChildren(convertSet(roots, DeptDO::getId), currentPlatform());
    }

    /** 沿指定平台的父子边遍历，已访问节点不重复扩展，历史环路也能有限结束。 */
    private List<DeptDO> findChildren(Collection<Long> ids, String roleType) {
        List<DeptDO> children = new LinkedList<>();
        Set<Long> visited = new HashSet<>(ids);
        // 遍历每一层
        Collection<Long> parentIds = ids;
        for (int i = 0; i < Short.MAX_VALUE; i++) { // 使用 Short.MAX_VALUE 避免 bug 场景下，存在死循环
            // 查询当前层，所有的子部门
            List<DeptDO> depts = deptMapper.selectListByParentId(parentIds, roleType).stream()
                    .filter(dept -> visited.add(dept.getId())).toList();
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
        return deptMapper.selectListByLeaderUserId(id, currentPlatform());
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
        // 缓存按根编号共享，必须由根本身的平台确定内容，不能受首个调用者的平台污染。
        DeptDO root = deptMapper.selectById(id);
        if (root == null) {
            return Collections.emptySet();
        }
        List<DeptDO> children = findChildren(Collections.singleton(id), root.getRoleType());
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
        // 校验
        ids.forEach(id -> {
            DeptDO dept = deptMap.get(id);
            if (dept == null) {
                throw exception(DEPT_NOT_FOUND);
            }
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
        return deptMapper.selectByNameAndRoleType(name, currentPlatform());
    }

    /** 使用已认证账号的平台，匿名内部调用沿用框架的业务平台默认，不消费请求 DTO 字段。 */
    private String currentPlatform() {
        return userServiceProvider.getObject().getLoginUserTypeOrDefault();
    }

    /** 部门负责人必须可见、启用且同属当前平台；空负责人表示不指定。 */
    private void validateLeaderUser(Long userId) {
        if (userId == null) {
            return;
        }
        AdminUserDO user = userServiceProvider.getObject().getUser(userId, currentPlatform());
        if (user == null) {
            throw exception(USER_NOT_EXISTS);
        }
        if (!CommonStatusEnum.ENABLE.getStatus().equals(user.getStatus())) {
            throw exception(USER_IS_DISABLE, user.getNickname());
        }
    }

}
