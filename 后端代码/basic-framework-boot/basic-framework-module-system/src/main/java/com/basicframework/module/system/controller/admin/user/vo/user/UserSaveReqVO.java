package com.basicframework.module.system.controller.admin.user.vo.user;

import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.validation.EmailEx;
import com.basicframework.framework.common.validation.Mobile;
import com.basicframework.framework.common.validation.Username;
import com.basicframework.module.system.framework.operatelog.core.DeptParseFunction;
import com.basicframework.module.system.framework.operatelog.core.PostParseFunction;
import com.basicframework.module.system.framework.operatelog.core.SexParseFunction;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mzt.logapi.starter.annotation.DiffLogField;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.Set;

/**
 * 管理后台用户创建或修改请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 用户创建/修改 Request VO")
@Data
public class UserSaveReqVO {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", example = "1024")
    private Long id;

    /**
     * 用户账号。
     */
    @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "basicframework")
    @NotBlank(message = "用户账号不能为空")
    @Username
    @DiffLogField(name = "用户账号")
    private String username;

    /**
     * 所属后台类型，后端按当前登录用户自动填充。
     */
    @Schema(description = "所属后台类型，后端按当前登录用户自动填充", hidden = true)
    private String userType;

    /**
     * 用户昵称。
     */
    @Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "basicframework")
    @Size(max = 30, message = "用户昵称长度不能超过 30 个字符")
    @DiffLogField(name = "用户昵称")
    private String nickname;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "我是一个用户")
    @Size(max = 500, message = "备注长度不能超过 500 个字符")
    @DiffLogField(name = "备注")
    private String remark;

    /**
     * 部门编号。
     */
    @Schema(description = "部门编号", example = "1")
    @DiffLogField(name = "部门", function = DeptParseFunction.NAME)
    private Long deptId;

    /**
     * 岗位编号数组。
     */
    @Schema(description = "岗位编号数组", example = "1")
    @DiffLogField(name = "岗位", function = PostParseFunction.NAME)
    private Set<Long> postIds;

    /**
     * 用户邮箱。
     */
    @Schema(description = "用户邮箱", example = "basicframework@example.com")
    @EmailEx
    @Size(max = 50, message = "邮箱长度不能超过 50 个字符")
    @DiffLogField(name = "用户邮箱")
    private String email;

    /**
     * 手机号。
     */
    @Schema(description = "手机号", example = "")
    @Mobile
    @DiffLogField(name = "手机号")
    private String mobile;

    /**
     * 用户性别，参见 SexEnum 枚举类。
     */
    @Schema(description = "用户性别，参见 SexEnum 枚举类", example = "1")
    @DiffLogField(name = "用户性别", function = SexParseFunction.NAME)
    private Integer sex;

    /**
     * 用户头像。
     */
    @Schema(description = "用户头像", example = "https://www.example.com/xxx.png")
    @Size(max = 512, message = "用户头像地址长度不能超过 512 个字符")
    @DiffLogField(name = "用户头像")
    private String avatar;

    /**
     * 前端完成复杂度校验后提交的密码 MD5 摘要，服务层使用 BCrypt 存储。
     */
    @Schema(description = "密码", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    // 接口接收 MD5 摘要，不对摘要执行原密码的长度和复杂度校验。
    private String password;

    /**
     * 用户状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "用户状态，参见 CommonStatusEnum 枚举类", example = "0")
    @DiffLogField(name = "用户状态")
    private Integer status;

    /**
     * 校验创建用户时必须提供密码；修改其他资料时允许不传密码。
     *
     * @return 创建时密码非空，或当前请求为修改操作
     */
    @AssertTrue(message = "新增用户时密码不能为空")
    @JsonIgnore
    public boolean isPasswordValid() {
        return id != null || ObjectUtil.isAllNotEmpty(password);
    }

}
