package com.basicframework.module.system.controller.admin.dept;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostPageReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostRespVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostSaveReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.service.dept.PostService;
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

import static com.basicframework.framework.apilog.core.enums.OperateTypeEnum.EXPORT;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_EXPORT_SIZE_EXCEEDED;

/**
 * PostController HTTP 接口，负责请求校验和响应组装。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dept/PostController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 9 行，移除或改写上游 4 行；import 新增 5 行、移除 6 行；补充注释 65 行，上游注释 1 行未保留。
 */
@Tag(name = "管理后台 - 岗位")
@RestController
@RequestMapping("/system/post")
@Validated
public class PostController {

    /** 单次 Excel 导出上限，避免无边界加载全部岗位。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    @Resource
    private PostService postService;

    /**
     * 创建岗位。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param createReqVO 请求参数
     * @return 创建结果
     */
    @PostMapping("/create")
    @Operation(summary = "创建岗位")
    @PreAuthorize("@ss.hasPermission('system:post:create')")
    public CommonResult<Long> createPost(@Valid @RequestBody PostSaveReqVO createReqVO) {
        Long postId = postService.createPost(createReqVO);
        return success(postId);
    }

    /**
     * 更新岗位。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param updateReqVO 请求参数
     * @return 操作结果
     */
    @PutMapping("/update")
    @Operation(summary = "修改岗位")
    @PreAuthorize("@ss.hasPermission('system:post:update')")
    public CommonResult<Boolean> updatePost(@Valid @RequestBody PostSaveReqVO updateReqVO) {
        postService.updatePost(updateReqVO);
        return success(true);
    }

    /**
     * 删除岗位。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param id 主键编号
     * @return 操作结果
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除岗位")
    @PreAuthorize("@ss.hasPermission('system:post:delete')")
    public CommonResult<Boolean> deletePost(@RequestParam("id") Long id) {
        postService.deletePost(id);
        return success(true);
    }

    /**
     * 删除岗位列表。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param ids 编号集合
     * @return 操作结果
     */
    @DeleteMapping("delete-list")
    @Operation(summary = "批量删除岗位")
    @PreAuthorize("@ss.hasPermission('system:post:delete')")
    public CommonResult<Boolean> deletePostList(@RequestParam("ids") List<Long> ids) {
        postService.deletePostList(ids);
        return success(true);
    }

    /**
     * 获取岗位。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    @GetMapping(value = "/get")
    @Operation(summary = "获得岗位信息")
    @Parameter(name = "id", description = "岗位编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:post:query')")
    public CommonResult<PostRespVO> getPost(@RequestParam("id") Long id) {
        PostDO post = postService.getPost(id);
        return success(BeanUtils.toBean(post, PostRespVO.class));
    }

    /**
     * 获取精简数据岗位列表。
     *
     * @return 查询结果
     */
    @GetMapping(value = {"/list-all-simple", "simple-list"})
    @Operation(summary = "获取岗位全列表", description = "包含所有状态的岗位，主要用于前端的下拉选项")
    public CommonResult<List<PostSimpleRespVO>> getSimplePostList() {
        // 获得岗位列表，包含所有状态
        List<PostDO> list = postService.getPostList(null, null);
        // 排序后，返回给前端
        list.sort(Comparator.comparing(PostDO::getSort));
        return success(BeanUtils.toBean(list, PostSimpleRespVO.class));
    }

    /**
     * 获取岗位分页数据。
     *
     * @param pageReqVO 请求参数
     * @return 查询结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得岗位分页列表")
    @PreAuthorize("@ss.hasPermission('system:post:query')")
    public CommonResult<PageResult<PostRespVO>> getPostPage(@Validated PostPageReqVO pageReqVO) {
        PageResult<PostDO> pageResult = postService.getPostPage(pageReqVO);
        return success(BeanUtils.toBean(pageResult, PostRespVO.class));
    }

    /**
     * 导出指定数据。
     *
     * <p>单次最多导出 10,000 条；超过上限时拒绝生成文件，调用方需要缩小筛选范围。</p>
     *
     * @param response HTTP 响应
     * @param reqVO 请求参数
     * @throws IOException 执行失败时抛出
     */
    @GetMapping("/export-excel")
    @Operation(summary = "岗位管理")
    @PreAuthorize("@ss.hasPermission('system:post:export')")
    @ApiAccessLog(operateType = EXPORT)
    public void export(HttpServletResponse response, @Validated PostPageReqVO reqVO) throws IOException {
        reqVO.setPageNo(1);
        reqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<PostDO> page = postService.getPostPage(reqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(SYSTEM_EXPORT_SIZE_EXCEEDED);
        }
        List<PostDO> list = page.getList();
        // 输出
        ExcelUtils.write(response, "岗位数据.xls", "岗位列表", PostRespVO.class,
                BeanUtils.toBean(list, PostRespVO.class));
    }

}
