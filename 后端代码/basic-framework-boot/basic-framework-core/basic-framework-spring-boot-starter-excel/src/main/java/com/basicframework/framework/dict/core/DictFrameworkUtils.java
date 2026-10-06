package com.basicframework.framework.dict.core;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.common.util.cache.CacheUtils;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import lombok.SneakyThrows;
import lombok.extern.slf4j.Slf4j;

import java.time.Duration;
import java.util.List;

import static com.basicframework.framework.common.util.collection.CollectionUtils.convertList;

/**
 * 字典工具类，提供字典值与字典标签的双向解析能力。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Slf4j
public class DictFrameworkUtils {

    private static DictDataCommonApi dictDataApi;

    /**
     * 按 dictType 缓存字典数据，并复用公共有界执行器异步刷新，避免为单个缓存创建无界线程池。
     */
    private static final LoadingCache<String, List<DictDataRespDTO>> GET_DICT_DATA_CACHE =
            CacheUtils.buildAsyncReloadingCache(Duration.ofMinutes(1L),
                    new CacheLoader<String, List<DictDataRespDTO>>() {

                        /**
                         * 从字典公共 API 加载指定类型的数据，刷新失败时由 Guava 保留旧缓存值。
                         */
                        @Override
                        public List<DictDataRespDTO> load(String dictType) {
                            return dictDataApi.getDictDataList(dictType);
                        }

                    });

    /**
     * 初始化字典数据接口。
     *
     * @param dictDataApi 字典数据接口
     */
    public static void init(DictDataCommonApi dictDataApi) {
        DictFrameworkUtils.dictDataApi = dictDataApi;
        log.info("[init][初始化 DictFrameworkUtils 成功]");
    }

    /**
     * 清空字典数据缓存。
     */
    public static void clearCache() {
        GET_DICT_DATA_CACHE.invalidateAll();
    }

    /**
     * 将整型字典值解析为字典标签。
     *
     * @param dictType 字典类型
     * @param value 字典值
     * @return 字典标签；未匹配时返回 null
     */
    @SneakyThrows
    public static String parseDictDataLabel(String dictType, Integer value) {
        if (value == null) {
            return null;
        }
        return parseDictDataLabel(dictType, String.valueOf(value));
    }

    /**
     * 将字符串字典值解析为字典标签。
     *
     * @param dictType 字典类型
     * @param value 字典值
     * @return 字典标签；未匹配时返回 null
     */
    @SneakyThrows
    public static String parseDictDataLabel(String dictType, String value) {
        List<DictDataRespDTO> dictDatas = GET_DICT_DATA_CACHE.get(dictType);
        DictDataRespDTO dictData = CollUtil.findOne(dictDatas, data -> ObjectUtil.equal(data.getValue(), value));
        return dictData != null ? dictData.getLabel() : null;
    }

    /**
     * 获取指定字典类型下的全部字典标签。
     *
     * @param dictType 字典类型
     * @return 字典标签列表
     */
    @SneakyThrows
    public static List<String> getDictDataLabelList(String dictType) {
        List<DictDataRespDTO> dictDatas = GET_DICT_DATA_CACHE.get(dictType);
        return convertList(dictDatas, DictDataRespDTO::getLabel);
    }

    /**
     * 将字典标签解析为字典值。
     *
     * @param dictType 字典类型
     * @param label 字典标签
     * @return 字典值；未匹配时返回 null
     */
    @SneakyThrows
    public static String parseDictDataValue(String dictType, String label) {
        List<DictDataRespDTO> dictDatas = GET_DICT_DATA_CACHE.get(dictType);
        DictDataRespDTO dictData = CollUtil.findOne(dictDatas, data -> ObjectUtil.equal(data.getLabel(), label));
        return dictData != null ? dictData.getValue() : null;
    }

    /**
     * 获取指定字典类型下的全部字典值。
     *
     * @param dictType 字典类型
     * @return 字典值列表
     */
    @SneakyThrows
    public static List<String> getDictDataValueList(String dictType) {
        List<DictDataRespDTO> dictDatas = GET_DICT_DATA_CACHE.get(dictType);
        return convertList(dictDatas, DictDataRespDTO::getValue);
    }
}
