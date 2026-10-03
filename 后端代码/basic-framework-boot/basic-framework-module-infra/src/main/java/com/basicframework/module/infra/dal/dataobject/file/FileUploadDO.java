package com.basicframework.module.infra.dal.dataobject.file;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 上传预约与补偿记录；终态记录保留用于幂等和后续清理，不使用业务逻辑删除。
 *
 * @author shady2713
 */
@TableName("infra_file_upload")
@Data
public class FileUploadDO {

    /** 内部自增记录编号，不作为客户端身份凭证。 */
    @TableId(type = IdType.AUTO)
    private Long id;
    /** 服务端身份域与用户编号；无用户的内部 API 使用独立系统预算。 */
    private String ownerKey;
    /** 服务端分配的最终对象键，具有唯一约束且永不复用。 */
    private String path;
    /** 直传暂存对象键；后端上传为空。 */
    private String stagingPath;
    /** 规范化的原文件名，实际类型仍由内容判定。 */
    private String name;
    /** 预约的精确字节数，完成时必须与实际读取一致。 */
    private Long size;
    /** PENDING、COMPLETE 或 CANCELLED；取消后不得重新登记。 */
    private String status;
    /** 完成登记的文件编号；只允许和 COMPLETE 状态一起提交。 */
    private Long fileId;
    /** 预约截止时间，统一使用 UTC；过期预约由清理器取消。 */
    private LocalDateTime expiresAt;
    /** 下一次补偿扫描时间，UTC；完成的后端上传无需清理，为空。 */
    private LocalDateTime nextCleanupAt;
}
