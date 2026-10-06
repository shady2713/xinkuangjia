package com.basicframework.module.system.controller.admin.user;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.framework.apilog.core.enums.OperateTypeEnum;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportExcelVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserPageReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSimpleRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserUpdateStatusReqVO;
import com.basicframework.module.system.convert.user.UserConvert;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.SexEnum;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.basicframework.module.system.service.permission.PermissionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Parameters;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertList;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;

/**
 * 管理后台用户接口，负责用户维护、导入导出及 HTTP 协议适配。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/user/UserController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 39 行，上游代码 47 行在本地被移除或改写，例如 private static final int MAX_EXPORT_SIZE = 10_000;；private PermissionService permissionService;；本地补充注释 95 行，上游注释 2 行未保留。
 */
@Tag(name = "管理后台 - 用户")
@RestController
@RequestMapping("/system/user")
@Validated
public class UserController {

    /** 单次 Excel 导出上限，避免无边界加载用户及其部门关联数据。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    @Resource
    private AdminUserService userService;
    @Resource
    private PermissionService permissionService;
    @Resource
    private DeptService deptService;
    @Resource
    private PostService postService;

    /**
     * 创建用户。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param reqVO 请求参数
     * @return 创建结果
     */
    @PostMapping("/create")
    @Operation(summary = "新增用户")
    @PreAuthorize("@ss.hasPermission('system:user:create')")
    public CommonResult<Long> createUser(@Valid @RequestBody UserSaveReqVO reqVO) {
        Long id = userService.createUser(reqVO, getLoginUserType());
        return success(id);
    }

    /**
     * 更新用户。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param reqVO 请求参数
     * @return 操作结果
     */
    @PutMapping("update")
    @Operation(summary = "修改用户")
    @PreAuthorize("@ss.hasPermission('system:user:update')")
    public CommonResult<Boolean> updateUser(@Valid @RequestBody UserSaveReqVO reqVO) {
        userService.updateUser(reqVO, getLoginUserType());
        return success(true);
    }

    /**
     * 删除用户。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param id 主键编号
     * @return 操作结果
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除用户")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:user:delete')")
    public CommonResult<Boolean> deleteUser(@RequestParam("id") Long id) {
        userService.deleteUser(id, getLoginUserType());
        return success(true);
    }

    /**
     * 删除用户列表。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param ids 编号集合
     * @return 操作结果
     */
    @DeleteMapping("/delete-list")
    @Parameter(name = "ids", description = "编号列表", required = true)
    @Operation(summary = "批量删除用户")
    @PreAuthorize("@ss.hasPermission('system:user:delete')")
    public CommonResult<Boolean> deleteUserList(@RequestParam("ids") List<Long> ids) {
        userService.deleteUserList(ids, getLoginUserType());
        return success(true);
    }

    /**
     * 更新用户密码。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param reqVO 请求参数
     * @return 操作结果
     */
    @PutMapping("/update-password")
    @Operation(summary = "重置用户密码")
    @PreAuthorize("@ss.hasPermission('system:user:update-password')")
    public CommonResult<Boolean> updateUserPassword(@Valid @RequestBody UserUpdatePasswordReqVO reqVO) {
        userService.updateUserPassword(reqVO.getId(), reqVO.getPassword(), getLoginUserType());
        return success(true);
    }

    /**
     * 更新用户状态。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param reqVO 请求参数
     * @return 操作结果
     */
    @PutMapping("/update-status")
    @Operation(summary = "修改用户状态")
    @PreAuthorize("@ss.hasPermission('system:user:update')")
    public CommonResult<Boolean> updateUserStatus(@Valid @RequestBody UserUpdateStatusReqVO reqVO) {
        userService.updateUserStatus(reqVO.getId(), reqVO.getStatus(), getLoginUserType());
        return success(true);
    }

    /**
     * 获取用户分页数据。
     *
     * @param pageReqVO 请求参数
     * @return 查询结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得用户分页列表")
    @PreAuthorize("@ss.hasPermission('system:user:query')")
    public CommonResult<PageResult<UserRespVO>> getUserPage(@Valid UserPageReqVO pageReqVO) {
        pageReqVO.setUserType(getLoginUserType());
        // 获得用户分页列表
        PageResult<AdminUserDO> pageResult = userService.getUserPage(pageReqVO);
        if (CollUtil.isEmpty(pageResult.getList())) {
            return success(new PageResult<>(pageResult.getTotal()));
        }
        // 拼接数据
        Map<Long, DeptDO> deptMap = deptService.getDeptMap(
                convertList(pageResult.getList(), AdminUserDO::getDeptId));
        List<UserRespVO> users = UserConvert.INSTANCE.convertList(pageResult.getList(), deptMap);
        // 仅补齐本次授权分页中的用户，保持用户数据权限和平台边界。
        Map<Long, List<String>> roleNames = permissionService.getUserRoleNames(
                convertList(pageResult.getList(), AdminUserDO::getId), getLoginUserType());
        users.forEach(user -> user.setRoleNames(roleNames.getOrDefault(user.getId(), List.of())));
        return success(new PageResult<>(users, pageResult.getTotal()));
    }

    /**
     * 获取精简数据用户列表。
     *
     * @return 查询结果
     */
    @GetMapping({"/list-all-simple", "/simple-list"})
    @Operation(summary = "获取用户精简信息列表", description = "只包含被开启的用户，主要用于前端的下拉选项")
    public CommonResult<List<UserSimpleRespVO>> getSimpleUserList() {
        String loginUserType = getLoginUserType();
        List<AdminUserDO> list = userService.getUserListByStatusAndType(
                CommonStatusEnum.ENABLE.getStatus(), loginUserType);
        // 拼接数据
        Map<Long, DeptDO> deptMap = deptService.getDeptMap(
                convertList(list, AdminUserDO::getDeptId));
        return success(UserConvert.INSTANCE.convertSimpleList(list, deptMap));
    }

    /**
     * 获取用户。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    @GetMapping("/get")
    @Operation(summary = "获得用户详情")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:user:query')")
    public CommonResult<UserRespVO> getUser(@RequestParam("id") Long id) {
        AdminUserDO user = userService.getUser(id, getLoginUserType());
        if (user == null) {
            return success(null);
        }
        // 拼接数据
        DeptDO dept = deptService.getDept(user.getDeptId());
        UserRespVO userVO = UserConvert.INSTANCE.convert(user, dept);
        // 校验岗位是否有效，过滤已删除的岗位
        if (CollUtil.isNotEmpty(user.getPostIds())) {
            List<PostDO> postList = postService.getPostList(user.getPostIds());
            userVO.setPostIds(convertSet(postList, PostDO::getId));
        }
        return success(userVO);
    }

    /**
     * 导出用户列表。
     *
     * <p>单次最多导出 10,000 条；超过上限时拒绝生成文件，调用方需要缩小筛选范围。</p>
     *
     * @param exportReqVO 请求参数
     * @param response HTTP 响应
     * @throws IOException 执行失败时抛出
     */
    @GetMapping("/export-excel")
    @Operation(summary = "导出用户")
    @PreAuthorize("@ss.hasPermission('system:user:export')")
    @ApiAccessLog(operateType = OperateTypeEnum.EXPORT)
    public void exportUserList(@Validated UserPageReqVO exportReqVO,
                               HttpServletResponse response) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        exportReqVO.setUserType(getLoginUserType());
        PageResult<AdminUserDO> page = userService.getUserPage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(ErrorCodeConstants.USER_EXPORT_SIZE_EXCEEDED);
        }
        List<AdminUserDO> list = page.getList();
        // 输出 Excel
        Map<Long, DeptDO> deptMap = deptService.getDeptMap(
                convertList(list, AdminUserDO::getDeptId));
        ExcelUtils.write(response, "用户数据.xls", "数据", UserRespVO.class,
                UserConvert.INSTANCE.convertList(list, deptMap));
    }

    /**
     * 导入模板。
     *
     * @param response HTTP 响应
     * @throws IOException 执行失败时抛出
     */
    @GetMapping("/get-import-template")
    @Operation(summary = "获得导入用户模板")
    public void importTemplate(HttpServletResponse response) throws IOException {
        // 手动创建导入模板示例数据
        List<UserImportExcelVO> list = Arrays.asList(
                UserImportExcelVO.builder().username("user_a").deptName("研发部门").email("user_a@example.com").mobile("13800138000")
                        .nickname("示例用户A").status(CommonStatusEnum.ENABLE.getStatus()).sex(SexEnum.MALE.getSex()).build(),
                UserImportExcelVO.builder().username("user_b").deptName("运维部门").email("user_b@example.com").mobile("15601701300")
                        .nickname("示例用户B").status(CommonStatusEnum.DISABLE.getStatus()).sex(SexEnum.FEMALE.getSex()).build()
        );
        // 输出
        ExcelUtils.write(response, "用户导入模板.xls", "用户列表", UserImportExcelVO.class, list);
    }

    /**
     * 导入Excel。
     *
     * @param file 文件参数
     * @param updateSupport updateSupport参数
     * @return 方法处理结果
     * @throws Exception 执行失败时抛出
     */
    @PostMapping("/import")
    @Operation(summary = "导入用户")
    @Parameters({
            @Parameter(name = "file", description = "Excel 文件", required = true),
            @Parameter(name = "updateSupport", description = "是否支持更新，默认为 false", example = "true")
    })
    @PreAuthorize("@ss.hasPermission('system:user:import')")
    public CommonResult<UserImportRespVO> importExcel(@RequestParam("file") MultipartFile file,
                                                      @RequestParam(value = "updateSupport", required = false, defaultValue = "false") Boolean updateSupport) throws Exception {
        List<UserImportExcelVO> list = ExcelUtils.read(file, UserImportExcelVO.class);
        return success(userService.importUserList(list, updateSupport));
    }

    /**
     * 获取登录用户类型。
     */
    private String getLoginUserType() {
        return userService.getLoginUserTypeOrDefault();
    }

}
