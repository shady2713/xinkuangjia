package com.basicframework.module.infra.enums;

import com.basicframework.framework.common.exception.ErrorCode;

/**
 * Infra 错误码枚举类（1-001-000-000 段）。
 *
 * @author 李杰
 */
public interface ErrorCodeConstants {

    // ========= 文件相关 1-001-003-000 =================
    ErrorCode FILE_PATH_EXISTS = new ErrorCode(1_001_003_000, "文件路径已存在");
    ErrorCode FILE_NOT_EXISTS = new ErrorCode(1_001_003_001, "文件不存在");
    ErrorCode FILE_IS_EMPTY = new ErrorCode(1_001_003_002, "文件为空");
    ErrorCode FILE_TYPE_NOT_ALLOWED = new ErrorCode(1_001_003_003, "不支持的文件类型");
    ErrorCode FILE_PATH_INVALID = new ErrorCode(1_001_003_004, "文件路径不正确");
    ErrorCode FILE_METADATA_INVALID = new ErrorCode(1_001_003_005, "文件元数据超过数据库字段限制");
    ErrorCode FILE_TOO_LARGE = new ErrorCode(1_001_003_006, "上传文件超过大小上限（单文件 50MB）");
    ErrorCode FILE_PRESIGN_TICKET_INVALID = new ErrorCode(1_001_003_007, "上传凭证无效或已过期，请重新获取上传地址");
    ErrorCode FILE_ACCESS_DENIED = new ErrorCode(1_001_003_008, "无权访问该私有文件");
    ErrorCode FILE_PRESIGN_EXPIRATION_INVALID = new ErrorCode(1_001_003_009, "临时访问地址有效期必须在 60 至 3600 秒之间");
    ErrorCode FILE_PRIVATE_SIGNING_UNSUPPORTED = new ErrorCode(1_001_003_010, "Local file storage cannot sign private GET URLs; use /infra/file/private/content");

}
