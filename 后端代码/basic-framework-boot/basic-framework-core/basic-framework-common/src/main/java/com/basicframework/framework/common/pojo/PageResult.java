package com.basicframework.framework.common.pojo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * 分页查询结果。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-common/src/main/java/cn/iocoder/yudao/framework/common/pojo/PageResult.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 28 行。
 *
 * @param <T> 数据项类型
 * 来源验收：尚未验收
 */
@Schema(description = "分页结果")
@Data
public final class PageResult<T> implements Serializable {

    @Schema(description = "总量", requiredMode = Schema.RequiredMode.REQUIRED)
    private Long total;

    @Schema(description = "数据", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<T> list;

    /**
     * 创建空分页结果。
     */
    public PageResult() {
        // 保留无参构造：分页结果需要支持 JSON 反序列化与空对象构造。
    }

    /**
     * 根据列表和总量创建分页结果。
     *
     * @param list 数据列表
     * @param total 总量
     */
    public PageResult(List<T> list, Long total) {
        this.list = list;
        this.total = total;
    }

    /**
     * 根据总量创建空列表分页结果。
     *
     * @param total 总量
     */
    public PageResult(Long total) {
        this.list = new ArrayList<>();
        this.total = total;
    }

    /**
     * 构建总数为 0 的空分页结果。
     *
     * @param <T> 数据项类型
     * @return 空分页结果
     */
    public static <T> PageResult<T> empty() {
        return new PageResult<>(0L);
    }

    /**
     * 构建指定总数、空数据列表的分页结果。
     *
     * @param total 总数
     * @param <T> 数据项类型
     * @return 空分页结果
     */
    public static <T> PageResult<T> empty(Long total) {
        return new PageResult<>(total);
    }

}
