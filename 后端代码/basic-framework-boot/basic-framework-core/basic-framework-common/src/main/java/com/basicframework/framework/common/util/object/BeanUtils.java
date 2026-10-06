package com.basicframework.framework.common.util.object;

import cn.hutool.core.bean.BeanUtil;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.collection.CollectionUtils;

import java.util.List;
import java.util.function.Consumer;

/**
 * Bean 工具类
 *
 * 1. 默认使用 {@link cn.hutool.core.bean.BeanUtil} 作为实现类，虽然不同 bean 工具的性能有差别，但是对绝大多数同学的项目，不用在意这点性能
 * 2. 针对复杂的对象转换，优先按业务边界拆分专用转换方法，避免通用工具类承载过多规则
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public class BeanUtils {

    /**
     * 将对象转换为指定类型。
     *
     * @param source 源对象
     * @param targetClass 目标类型
     * @return 目标类型对象
     */
    public static <T> T toBean(Object source, Class<T> targetClass) {
        return BeanUtil.toBean(source, targetClass);
    }

    /**
     * 将对象转换为指定类型，并在返回前执行自定义处理。
     *
     * @param source 源对象
     * @param targetClass 目标类型
     * @param peek 转换后处理逻辑
     * @return 目标类型对象
     */
    public static <T> T toBean(Object source, Class<T> targetClass, Consumer<T> peek) {
        T target = toBean(source, targetClass);
        if (target != null) {
            peek.accept(target);
        }
        return target;
    }

    /**
     * 将对象列表转换为指定元素类型列表。
     *
     * @param source 源对象列表
     * @param targetType 目标元素类型
     * @return 目标类型列表；源列表为 null 时返回 null
     */
    public static <S, T> List<T> toBean(List<S> source, Class<T> targetType) {
        if (source == null) {
            return null;
        }
        return CollectionUtils.convertList(source, s -> toBean(s, targetType));
    }

    /**
     * 将对象列表转换为指定元素类型列表，并对每个转换结果执行自定义处理。
     *
     * @param source 源对象列表
     * @param targetType 目标元素类型
     * @param peek 单个转换结果处理逻辑
     * @return 目标类型列表；源列表为 null 时返回 null
     */
    public static <S, T> List<T> toBean(List<S> source, Class<T> targetType, Consumer<T> peek) {
        List<T> list = toBean(source, targetType);
        if (list != null) {
            list.forEach(peek);
        }
        return list;
    }

    /**
     * 将分页结果中的列表元素转换为指定类型。
     *
     * @param source 源分页结果
     * @param targetType 目标元素类型
     * @return 转换后的分页结果；源分页结果为 null 时返回 null
     */
    public static <S, T> PageResult<T> toBean(PageResult<S> source, Class<T> targetType) {
        return toBean(source, targetType, null);
    }

    /**
     * 将分页结果中的列表元素转换为指定类型，并对每个转换结果执行自定义处理。
     *
     * @param source 源分页结果
     * @param targetType 目标元素类型
     * @param peek 单个转换结果处理逻辑
     * @return 转换后的分页结果；源分页结果为 null 时返回 null
     */
    public static <S, T> PageResult<T> toBean(PageResult<S> source, Class<T> targetType, Consumer<T> peek) {
        if (source == null) {
            return null;
        }
        List<T> list = toBean(source.getList(), targetType);
        if (peek != null) {
            list.forEach(peek);
        }
        return new PageResult<>(list, source.getTotal());
    }

    /**
     * 拷贝对象属性，源对象或目标对象为空时不处理。
     *
     * @param source 源对象
     * @param target 目标对象
     */
    public static void copyProperties(Object source, Object target) {
        if (source == null || target == null) {
            return;
        }
        BeanUtil.copyProperties(source, target, false);
    }

}
