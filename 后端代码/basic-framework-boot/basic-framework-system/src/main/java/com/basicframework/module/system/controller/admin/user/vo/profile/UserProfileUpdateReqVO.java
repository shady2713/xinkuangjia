package com.basicframework.module.system.controller.admin.user.vo.profile;

import com.basicframework.framework.common.validation.EmailEx;
import com.basicframework.framework.common.validation.Mobile;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.Data;
import org.hibernate.validator.constraints.URL;

/**
 * 管理后台用户个人资料更新请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 用户个人信息更新 Request VO")
@Data
public class UserProfileUpdateReqVO {

    /**
     * 用户昵称。
     */
    @Schema(description = "用户昵称", example = "basicframework")
    @Size(max = 30, message = "用户昵称长度不能超过 30 个字符")
    private String nickname;

    /**
     * 用户邮箱。
     */
    @Schema(description = "用户邮箱", example = "basicframework@example.com")
    @EmailEx
    @Size(max = 50, message = "邮箱长度不能超过 50 个字符")
    private String email;

    /**
     * 手机号。
     */
    @Schema(description = "手机号", example = "")
    @Mobile
    private String mobile;

    /**
     * 用户性别，参见 SexEnum 枚举类。
     */
    @Schema(description = "用户性别，参见 SexEnum 枚举类", example = "1")
    private Integer sex;

    /**
     * 角色头像。
     */
    @Schema(description = "角色头像", example = "https://www.example.com/1.png")
    @URL(message = "头像地址格式不正确")
    @Size(max = 512, message = "头像地址长度不能超过 512 个字符")
    private String avatar;

}
