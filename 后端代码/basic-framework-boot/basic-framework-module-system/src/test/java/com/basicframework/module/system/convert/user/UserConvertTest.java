package com.basicframework.module.system.convert.user;

import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证用户模型转换的真实字段映射与部门缺失语义。
 *
 * <p>转换结果直接进入管理端列表与个人中心：列表页需要“部门名”而不是部门编号；
 * 用户所属部门已被删除时，部门映射里查不到该编号，此时必须把部门编号一并清空，
 * 否则页面会显示一个指向不存在部门的编号，点击后跳转到空白页。批量入口还要容忍
 * 部门映射整体缺失，不能让一个空 Map 变成空指针。</p>
 *
 * <p>个人中心入口需要同时带出角色、部门与岗位的简化模型，用于一次性渲染资料页。</p>
 *
 * @author shady2713
 */
class UserConvertTest {

    /** 被测转换器，由 MapStruct 生成实现，这里通过接口常量获取真实实例。 */
    private final UserConvert convert = UserConvert.INSTANCE;

    /** 列表转换：命中部门时补部门名，未命中时同时清空部门编号。 */
    @Test
    void convertListFillsDeptNameAndClearsUnknownDeptId() {
        AdminUserDO known = user(1L, "张三", 10L);
        AdminUserDO unknown = user(2L, "李四", 99L);
        Map<Long, DeptDO> deptMap = Map.of(10L, dept(10L, "研发部"));

        List<UserRespVO> result = convert.convertList(List.of(known, unknown), deptMap);

        assertThat(result).hasSize(2);
        assertThat(result.get(0).getDeptName()).isEqualTo("研发部");
        assertThat(result.get(0).getDeptId()).isEqualTo(10L);
        assertThat(result.get(1).getDeptName()).isNull();
        assertThat(result.get(1).getDeptId()).as("部门已不存在时必须清空编号，避免页面指向空白部门").isNull();
    }

    /** 单条转换同样遵守“部门缺失清空编号”的约定，并保留用户基础字段。 */
    @Test
    void convertSingleKeepsBaseFieldsAndDeptSemantics() {
        AdminUserDO source = user(3L, "王五", 20L);
        source.setUsername("wangwu");
        source.setMobile("13800000000");

        UserRespVO withDept = convert.convert(source, dept(20L, "财务部"));
        assertThat(withDept.getUsername()).isEqualTo("wangwu");
        assertThat(withDept.getMobile()).isEqualTo("13800000000");
        assertThat(withDept.getDeptName()).isEqualTo("财务部");
        assertThat(withDept.getDeptId()).isEqualTo(20L);

        UserRespVO withoutDept = convert.convert(source, null);
        assertThat(withoutDept.getDeptId()).isNull();
        assertThat(withoutDept.getDeptName()).isNull();
    }

    /** 简单列表转换：部门映射缺省或被删时不报错，命中时补部门名。 */
    @Test
    void convertSimpleListToleratesMissingDeptMapAndDeletedDept() {
        AdminUserDO known = user(1L, "张三", 10L);
        AdminUserDO withoutDept = user(2L, "李四", null);
        AdminUserDO deletedDept = user(3L, "王五", 99L);
        List<AdminUserDO> users = List.of(known, withoutDept, deletedDept);

        List<UserSimpleRespVO> mapped = convert.convertSimpleList(users, Map.of(10L, dept(10L, "研发部")));
        assertThat(mapped).extracting(UserSimpleRespVO::getDeptName).containsExactly("研发部", null, null);
        assertThat(mapped.get(1).getDeptId()).as("无部门用户保留空编号").isNull();

        List<UserSimpleRespVO> withoutMap = convert.convertSimpleList(users, null);
        assertThat(withoutMap).as("部门映射整体缺失时不得抛异常").hasSize(3);
        assertThat(withoutMap).extracting(UserSimpleRespVO::getDeptName).containsOnlyNulls();

        List<UserSimpleRespVO> emptyMap = convert.convertSimpleList(users, new HashMap<>());
        assertThat(emptyMap).hasSize(3);
    }

    /** 个人中心转换：基础字段、角色、部门与岗位同时映射。 */
    @Test
    void convertProfileMapsRolesDeptAndPosts() {
        AdminUserDO source = user(4L, "赵六", 30L);
        source.setUsername("zhaoliu");
        RoleDO role = new RoleDO();
        role.setId(1L);
        role.setName("业务管理员");
        PostDO post = new PostDO();
        post.setId(2L);
        post.setName("研发岗");

        UserProfileRespVO result = convert.convert(source, List.of(role), dept(30L, "研发部"), List.of(post));

        assertThat(result.getNickname()).isEqualTo("赵六");
        assertThat(result.getRoles()).hasSize(1);
        assertThat(result.getRoles().get(0).getName()).isEqualTo("业务管理员");
        assertThat(result.getDept()).isNotNull();
        assertThat(result.getDept().getName()).isEqualTo("研发部");
        assertThat(result.getPosts()).hasSize(1);
        assertThat(result.getPosts().get(0).getName()).isEqualTo("研发岗");
    }

    /**
     * 构造用户记录。
     *
     * @param id 用户编号
     * @param nickname 昵称
     * @param deptId 部门编号，可为 null
     * @return 用户记录
     */
    private static AdminUserDO user(Long id, String nickname, Long deptId) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setNickname(nickname);
        user.setDeptId(deptId);
        user.setStatus(0);
        return user;
    }

    /**
     * 构造部门记录。
     *
     * @param id 部门编号
     * @param name 部门名称
     * @return 部门记录
     */
    private static DeptDO dept(Long id, String name) {
        DeptDO dept = new DeptDO();
        dept.setId(id);
        dept.setName(name);
        return dept;
    }

}
