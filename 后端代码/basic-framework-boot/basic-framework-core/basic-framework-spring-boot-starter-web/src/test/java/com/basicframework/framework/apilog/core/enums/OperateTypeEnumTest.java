package com.basicframework.framework.apilog.core.enums;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 锁定操作日志类型编码与顺序。
 *
 * <p>操作类型写入操作日志表并用于前端筛选与统计，编码属稳定契约；{@code OTHER} 固定为 0，
 * 是无法归类时的兜底取值，不能因为新增操作类型而被占用或改写。新增、修改、删除、导入、
 * 导出依次为 2 至 6，与查询 1 一起构成现有数据口径。</p>
 *
 * @author shady2713
 */
class OperateTypeEnumTest {

    /** 各操作类型的编码与声明顺序必须稳定，兜底项固定为 0。 */
    @Test
    void constantsCarryStableTypeCodes() {
        assertThat(OperateTypeEnum.values()).containsExactly(OperateTypeEnum.GET, OperateTypeEnum.CREATE,
                OperateTypeEnum.UPDATE, OperateTypeEnum.DELETE, OperateTypeEnum.EXPORT,
                OperateTypeEnum.IMPORT, OperateTypeEnum.OTHER);
        assertThat(OperateTypeEnum.GET.getType()).isEqualTo(1);
        assertThat(OperateTypeEnum.CREATE.getType()).isEqualTo(2);
        assertThat(OperateTypeEnum.UPDATE.getType()).isEqualTo(3);
        assertThat(OperateTypeEnum.DELETE.getType()).isEqualTo(4);
        assertThat(OperateTypeEnum.EXPORT.getType()).isEqualTo(5);
        assertThat(OperateTypeEnum.IMPORT.getType()).isEqualTo(6);
        assertThat(OperateTypeEnum.OTHER.getType()).as("无法归类时使用兜底编码 0").isEqualTo(0);
    }

    /** 除兜底项外，各操作类型编码必须互不相同，避免日志统计把两类操作合并。 */
    @Test
    void typeCodesAreUnique() {
        assertThat(OperateTypeEnum.values()).extracting(OperateTypeEnum::getType).doesNotHaveDuplicates();
    }
}
