package com.basicframework.framework.mybatis.core.type;

import cn.hutool.core.collection.CollUtil;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;
import org.apache.ibatis.type.TypeHandler;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

/**
 * List<Long> 的类型转换器实现类，对应数据库的 varchar 类型
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@MappedJdbcTypes(JdbcType.VARCHAR)
@MappedTypes(List.class)
public class LongListTypeHandler implements TypeHandler<List<Long>> {

    private static final String COMMA = ",";

    /**
     * 将 Java 参数转换后写入预编译语句。
     *
     * @param ps ps 参数
     * @param i i 参数
     * @param strings strings 数据集合
     * @param jdbcType jdbcType 参数
     * @throws SQLException 底层处理失败时抛出
     */
    @Override
    public void setParameter(PreparedStatement ps, int i, List<Long> strings, JdbcType jdbcType) throws SQLException {
        // 设置占位符
        ps.setString(i, CollUtil.join(strings, COMMA));
    }

    /**
     * 获取结果。
     *
     * @param rs rs 数据集合
     * @param columnName 数据库列名
     * @return 查询或转换后的结果
     * @throws SQLException 底层处理失败时抛出
     */
    @Override
    public List<Long> getResult(ResultSet rs, String columnName) throws SQLException {
        String value = rs.getString(columnName);
        return getResult(value);
    }

    /**
     * 获取结果。
     *
     * @param rs rs 数据集合
     * @param columnIndex 数据库列序号
     * @return 查询或转换后的结果
     * @throws SQLException 底层处理失败时抛出
     */
    @Override
    public List<Long> getResult(ResultSet rs, int columnIndex) throws SQLException {
        String value = rs.getString(columnIndex);
        return getResult(value);
    }

    /**
     * 获取结果。
     *
     * @param cs cs 参数
     * @param columnIndex 数据库列序号
     * @return 查询或转换后的结果
     * @throws SQLException 底层处理失败时抛出
     */
    @Override
    public List<Long> getResult(CallableStatement cs, int columnIndex) throws SQLException {
        String value = cs.getString(columnIndex);
        return getResult(value);
    }

    /**
     * 获取结果。
     */
    private List<Long> getResult(String value) {
        if (value == null) {
            return null;
        }
        return CollectionTypeHandlerUtils.parseLongList(value, COMMA);
    }
}
