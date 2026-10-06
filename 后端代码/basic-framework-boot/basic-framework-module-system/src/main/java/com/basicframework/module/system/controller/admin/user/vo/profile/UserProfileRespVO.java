package com.basicframework.module.system.controller.admin.user.vo.profile;

import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSimpleRespVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostSimpleRespVO;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleSimpleRespVO;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * UserProfileRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/user/vo/profile/UserProfileRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 6 行，移除或改写上游 5 行；补充注释 16 行，上游注释 3 行未保留。
 * 来源验收：尚未验收
 */
@Data
@Schema(description = "管理后台 - 用户个人中心信息 Response VO")
public class UserProfileRespVO {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    private Long id;

    /**
     * 用户账号。
     */
    @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "admin")
    private String username;

    /**
     * 用户昵称。
     */
    @Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")
    private String nickname;

    /**
     * 用户邮箱。
     */
    @Schema(description = "用户邮箱", example = "admin@example.com")
    private String email;

    /**
     * 手机号码。
     */
    @Schema(description = "手机号码", example = "")
    private String mobile;

    /**
     * 用户性别，参见 SexEnum 枚举类。
     */
    @Schema(description = "用户性别，参见 SexEnum 枚举类", example = "1")
    private Integer sex;

    /**
     * 用户头像。
     */
    @Schema(description = "用户头像", example = "https://www.example.com/xxx.png")
    private String avatar;

    /**
     * 最后登录 IP。
     */
    @SuppressWarnings("PMD.AvoidUsingHardCodedIP") // 文档示例用于说明 IP 格式，并非服务端连接地址。
    @Schema(description = "最后登录 IP", requiredMode = Schema.RequiredMode.REQUIRED, example = "192.168.1.1")
    private String loginIp;

    /**
     * 最后登录时间。
     */
    @Schema(description = "最后登录时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    private LocalDateTime loginDate;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    private LocalDateTime createTime;

    /**
     * 所属角色。
     */
    private List<RoleSimpleRespVO> roles;
    /**
     * 所在部门。
     */
    private DeptSimpleRespVO dept;
    /**
     * 所属岗位数组。
     */
    private List<PostSimpleRespVO> posts;

}
