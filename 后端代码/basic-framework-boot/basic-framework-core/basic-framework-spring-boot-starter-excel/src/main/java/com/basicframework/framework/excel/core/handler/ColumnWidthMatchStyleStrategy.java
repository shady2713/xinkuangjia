package com.basicframework.framework.excel.core.handler;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.map.MapUtil;
import cn.idev.excel.enums.CellDataTypeEnum;
import cn.idev.excel.metadata.Head;
import cn.idev.excel.metadata.data.WriteCellData;
import cn.idev.excel.write.metadata.holder.WriteSheetHolder;
import cn.idev.excel.write.style.column.AbstractColumnWidthStyleStrategy;
import cn.idev.excel.write.style.column.LongestMatchColumnWidthStyleStrategy;
import org.apache.poi.ss.usermodel.Cell;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Excel 自适应列宽处理器
 *
 * 相比 {@link LongestMatchColumnWidthStyleStrategy} 来说，额外处理了 DATE 类型！
 *
 * @see 添加自适应列宽处理器，并替换默认列宽策略
 * @author hmb
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public class ColumnWidthMatchStyleStrategy extends AbstractColumnWidthStyleStrategy {

    private static final int MAX_COLUMN_WIDTH = 255;

    private final Map<Integer, Map<Integer, Integer>> cache = MapUtil.newHashMap(8);

    /**
     * 根据当前单元格内容刷新所在列的最大宽度。
     *
     * @param writeSheetHolder 写入 Sheet 上下文
     * @param cellDataList 单元格写入数据
     * @param cell POI 单元格
     * @param head 表头元数据
     * @param relativeRowIndex 相对行索引
     * @param isHead 是否表头
     */
    @Override
    protected void setColumnWidth(WriteSheetHolder writeSheetHolder, List<WriteCellData<?>> cellDataList, Cell cell,
                                  Head head, Integer relativeRowIndex, Boolean isHead) {
        boolean needSetWidth = Boolean.TRUE.equals(isHead) || CollUtil.isNotEmpty(cellDataList);
        if (!needSetWidth) {
            return;
        }
        Map<Integer, Integer> maxColumnWidthMap = cache.computeIfAbsent(writeSheetHolder.getSheetNo(),
                key -> MapUtil.newHashMap(16));
        Integer columnWidth = dataLength(cellDataList, cell, isHead);
        if (columnWidth < 0) {
            return;
        }
        if (columnWidth > MAX_COLUMN_WIDTH) {
            columnWidth = MAX_COLUMN_WIDTH;
        }
        Integer maxColumnWidth = maxColumnWidthMap.get(cell.getColumnIndex());
        if (maxColumnWidth == null || columnWidth > maxColumnWidth) {
            maxColumnWidthMap.put(cell.getColumnIndex(), columnWidth);
            writeSheetHolder.getSheet().setColumnWidth(cell.getColumnIndex(), columnWidth * 256);
        }
    }

    /**
     * 计算 Excel 单元格内容的展示长度。
     *
     * @param cellDataList cellDataList 数据集合
     * @param cell cell 参数
     * @param isHead isHead 参数
     * @return 方法处理结果
     */
    @SuppressWarnings("EnhancedSwitchMigration")
    private Integer dataLength(List<WriteCellData<?>> cellDataList, Cell cell, Boolean isHead) {
        if (Boolean.TRUE.equals(isHead)) {
            return cell.getStringCellValue().getBytes(StandardCharsets.UTF_8).length;
        }
        WriteCellData<?> cellData = cellDataList.get(0);
        CellDataTypeEnum type = cellData.getType();
        if (type == null) {
            return -1;
        }
        switch (type) {
            case STRING:
                return cellData.getStringValue().getBytes(StandardCharsets.UTF_8).length;
            case BOOLEAN:
                return cellData.getBooleanValue().toString().getBytes(StandardCharsets.UTF_8).length;
            case NUMBER:
                return cellData.getNumberValue().toString().getBytes(StandardCharsets.UTF_8).length;
            case DATE:
                return cellData.getDateValue().toString().getBytes(StandardCharsets.UTF_8).length;
            default:
                return -1;
        }
    }

}
