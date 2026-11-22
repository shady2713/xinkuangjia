package com.basicframework.module.system.controller.admin.user.vo.user;

import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.validation.EmailEx;
import com.basicframework.framework.common.validation.InEnum;
import com.basicframework.framework.common.validation.Mobile;
import com.basicframework.framework.common.validation.Username;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 管理后台用户创建或修改请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 用户创建/修改 Request VO")
@Data
public class UserSaveReqVO {

    @Schema(description = "用户编号", example = "1024")
    private Long id;

    @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "basicframework")
    @NotBlank(message = "用户账号不能为空")
    @Username
    private String username;

    @Schema(description = "所属后台类型，后端按当前登录用户自动填充", hidden = true)
    private String userType;

    @Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "basicframework")
    @NotBlank(message = "用户昵称不能为空")
    @Size(max = 30, message = "用户昵称长度不能超过 30 个字符")
    private String nickname;

    @Schema(description = "备注", example = "我是一个用户")
    @Size(max = 500, message = "备注长度不能超过 500 个字符")
    private String remark;

    @Schema(description = "部门编号", example = "1")
    private Long deptId;

    @Schema(description = "用户邮箱", example = "basicframework@example.com")
    @EmailEx
    @Size(max = 50, message = "邮箱长度不能超过 50 个字符")
    private String email;

    @Schema(description = "手机号", example = "")
    @Mobile
    private String mobile;

    @Schema(description = "用户性别，参见 SexEnum 枚举类", example = "1")
    private Integer sex;

    @Schema(description = "用户头像", example = "https://www.example.com/xxx.png")
    @Size(max = 512, message = "用户头像地址长度不能超过 512 个字符")
    private String avatar;

    @Schema(description = "SM2 密码密文（C1C3C2）", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    private String password;

    @Schema(description = "用户状态，参见 CommonStatusEnum 枚举类", example = "0")
    @InEnum(value = CommonStatusEnum.class, message = "修改状态必须是 {value}")
    private Integer status;

    @AssertTrue(message = "新增用户时密码不能为空")
    @JsonIgnore
    public boolean isPasswordValid() {
        return id != null || ObjectUtil.isAllNotEmpty(password);
    }

}
