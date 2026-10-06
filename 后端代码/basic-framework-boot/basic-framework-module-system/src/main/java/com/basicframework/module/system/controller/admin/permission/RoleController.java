package com.basicframework.module.system.controller.admin.permission;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.apilog.core.enums.OperateTypeEnum;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.module.system.controller.admin.permission.vo.role.RolePageReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleRespVO;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleSaveReqVO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.user.AdminUserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.Comparator;
import java.util.List;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_EXPORT_SIZE_EXCEEDED;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED;

/**
 * RoleController HTTP 接口，负责请求校验和响应组装。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/permission/RoleController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 26 行，上游代码 5 行在本地被移除或改写，例如 private static final int MAX_EXPORT_SIZE = 10_000;；private AdminUserService userService;；本地补充注释 69 行。
 */
@Tag(name = "管理后台 - 角色")
@RestController
@RequestMapping("/system/role")
@Validated
public class RoleController {

    /** 单次 Excel 导出上限，避免无边界加载全部角色。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    @Resource
    private RoleService roleService;
    @Resource
    private AdminUserService userService;

    /**
     * 创建角色。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param createReqVO 请求参数
     * @return 创建结果
     */
    @PostMapping("/create")
    @Operation(summary = "创建角色")
    @PreAuthorize("@ss.hasPermission('system:role:create')")
    public CommonResult<Long> createRole(@Valid @RequestBody RoleSaveReqVO createReqVO) {
        createReqVO.setRoleType(getLoginUserType());
        return success(roleService.createRole(createReqVO, null));
    }

    /**
     * 更新角色。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param updateReqVO 请求参数
     * @return 操作结果
     */
    @PutMapping("/update")
    @Operation(summary = "修改角色")
    @PreAuthorize("@ss.hasPermission('system:role:update')")
    public CommonResult<Boolean> updateRole(@Valid @RequestBody RoleSaveReqVO updateReqVO) {
        validateRolePlatform(updateReqVO.getId());
        updateReqVO.setRoleType(getLoginUserType());
        roleService.updateRole(updateReqVO);
        return success(true);
    }

    /**
     * 删除角色。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param id 主键编号
     * @return 操作结果
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除角色")
    @Parameter(name = "id", description = "角色编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:role:delete')")
    public CommonResult<Boolean> deleteRole(@RequestParam("id") Long id) {
        validateRolePlatform(id);
        roleService.deleteRole(id);
        return success(true);
    }

    /**
     * 删除角色列表。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param ids 编号集合
     * @return 操作结果
     */
    @DeleteMapping("/delete-list")
    @Operation(summary = "批量删除角色")
    @Parameter(name = "ids", description = "编号列表", required = true)
    @PreAuthorize("@ss.hasPermission('system:role:delete')")
    public CommonResult<Boolean> deleteRoleList(@RequestParam("ids") List<Long> ids) {
        ids.forEach(this::validateRolePlatform);
        roleService.deleteRoleList(ids);
        return success(true);
    }

    /**
     * 获取角色。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    @GetMapping("/get")
    @Operation(summary = "获得角色信息")
    @PreAuthorize("@ss.hasPermission('system:role:query')")
    public CommonResult<RoleRespVO> getRole(@RequestParam("id") Long id) {
        RoleDO role = roleService.getRole(id);
        validateRolePlatform(role);
        return success(BeanUtils.toBean(role, RoleRespVO.class));
    }

    /**
     * 获取角色分页数据。
     *
     * @param pageReqVO 请求参数
     * @return 查询结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得角色分页")
    @PreAuthorize("@ss.hasPermission('system:role:query')")
    public CommonResult<PageResult<RoleRespVO>> getRolePage(RolePageReqVO pageReqVO) {
        pageReqVO.setRoleType(getLoginUserType());
        PageResult<RoleDO> pageResult = roleService.getRolePage(pageReqVO);
        return success(BeanUtils.toBean(pageResult, RoleRespVO.class));
    }

    /**
     * 获取精简数据角色列表。
     *
     * @return 查询结果
     */
    @GetMapping({"/list-all-simple", "/simple-list"})
    @Operation(summary = "获取角色精简信息列表", description = "包含所有状态的角色，主要用于前端的下拉选项")
    public CommonResult<List<RoleRespVO>> getSimpleRoleList() {
        List<RoleDO> list = roleService.getRoleListByRoleType(getLoginUserType());
        list.sort(Comparator.comparing(RoleDO::getSort));
        return success(BeanUtils.toBean(list, RoleRespVO.class));
    }

    /**
     * 导出指定数据。
     *
     * <p>单次最多导出 10,000 条；超过上限时拒绝生成文件，调用方需要缩小筛选范围。</p>
     *
     * @param response HTTP 响应
     * @param exportReqVO 请求参数
     * @throws IOException 执行失败时抛出
     */
    @GetMapping("/export-excel")
    @Operation(summary = "导出角色 Excel")
    @ApiAccessLog(operateType = OperateTypeEnum.EXPORT)
    @PreAuthorize("@ss.hasPermission('system:role:export')")
    public void export(HttpServletResponse response, @Validated RolePageReqVO exportReqVO) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        exportReqVO.setRoleType(getLoginUserType());
        PageResult<RoleDO> page = roleService.getRolePage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(SYSTEM_EXPORT_SIZE_EXCEEDED);
        }
        List<RoleDO> list = page.getList();
        // 输出
        ExcelUtils.write(response, "角色数据.xls", "数据", RoleRespVO.class,
                BeanUtils.toBean(list, RoleRespVO.class));
    }

    /**
     * 获取登录用户类型。
     */
    private String getLoginUserType() {
        return userService.getLoginUserTypeOrDefault();
    }

    /**
     * 校验 validateRolePlatform 对应的输入与业务约束。
     */
    private void validateRolePlatform(Long roleId) {
        validateRolePlatform(roleService.getRole(roleId));
    }

    /**
     * 校验 validateRolePlatform 对应的输入与业务约束。
     */
    private void validateRolePlatform(RoleDO role) {
        // 角色平台类型是授权隔离边界，当前平台不能操作另一个平台的角色。
        if (role != null && !AdminPlatformTypeEnum.isSame(role.getRoleType(), getLoginUserType())) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
    }

}
