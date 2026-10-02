package com.basicframework.module.infra.framework.file.core.utils;

import cn.hutool.core.util.StrUtil;

/**
 * 对象存储文件元数据和路径校验工具。
 *
 * <p>统一管理管理端和模块内部调用的路径边界，避免各入口重复实现安全校验。</p>
 *
 * @author 李杰
 */
public final class FilePathUtils {

    /** 文件名最大字符数，与 infra_file.name 字段一致。 */
    public static final int MAX_FILE_NAME_LENGTH = 256;
    /** 完整对象路径最大字符数，与 infra_file.path 字段一致。 */
    public static final int MAX_OBJECT_PATH_LENGTH = 512;
    /** 业务目录最终会写入对象路径，因此输入上限沿用 path 字段容量。 */
    public static final int MAX_DIRECTORY_LENGTH = MAX_OBJECT_PATH_LENGTH;
    /** 文件访问地址最大字符数，与 infra_file.url 字段一致。 */
    public static final int MAX_FILE_URL_LENGTH = 1024;
    /** MIME 类型最大字符数，与 infra_file.type 字段一致。 */
    public static final int MAX_MIME_TYPE_LENGTH = 128;

    /**
     * 禁止实例化纯静态工具类。
     */
    private FilePathUtils() {
    }

    /**
     * 从浏览器或调用方提供的名称中提取最后一级文件名。
     *
     * @param fileName 原始文件名，可能包含客户端本地路径
     * @return 去除目录部分并清理首尾空白后的文件名；输入为空时返回原值
     */
    public static String normalizeFileName(String fileName) {
        if (StrUtil.isEmpty(fileName)) {
            return fileName;
        }
        int lastSeparatorIndex = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
        return fileName.substring(lastSeparatorIndex + 1).trim();
    }

    /**
     * 校验文件名不包含路径分隔符、控制字符或相对目录语义。
     *
     * @param fileName 文件名
     * @return 文件名可安全用作对象 Key 的最后一级时返回 true
     */
    public static boolean isFileNameValid(String fileName) {
        return StrUtil.isNotBlank(fileName)
                && fileName.length() <= MAX_FILE_NAME_LENGTH
                && !".".equals(fileName)
                && !"..".equals(fileName)
                && !StrUtil.containsAny(fileName, "/", "\\")
                && !containsControlCharacter(fileName);
    }

    /**
     * 校验可选业务目录只能使用规范的相对对象路径。
     *
     * @param directory 业务目录；为空表示不追加业务目录
     * @return 目录为空或格式安全时返回 true
     */
    public static boolean isDirectoryValid(String directory) {
        if (StrUtil.isEmpty(directory)) {
            return true;
        }
        return directory.length() <= MAX_DIRECTORY_LENGTH
                && !StrUtil.startWithAny(directory, "/", "\\")
                && !StrUtil.endWithAny(directory, "/", "\\")
                && !StrUtil.containsAny(directory, "\\", "//")
                && !containsRelativeSegment(directory)
                && !containsControlCharacter(directory);
    }

    /**
     * 校验完整对象路径，供预签名上传后的文件登记使用。
     *
     * @param path 对象路径
     * @return 路径为受限相对路径且包含文件名时返回 true
     */
    public static boolean isObjectPathValid(String path) {
        if (StrUtil.isBlank(path) || path.length() > MAX_OBJECT_PATH_LENGTH) {
            return false;
        }
        return !StrUtil.startWithAny(path, "/", "\\")
                && !StrUtil.endWithAny(path, "/", "\\")
                && !StrUtil.containsAny(path, "\\", "//")
                && !containsRelativeSegment(path)
                && !containsControlCharacter(path);
    }

    /**
     * 校验文件访问地址满足数据库非空和长度约束。
     *
     * @param url 文件访问地址
     * @return URL 可安全写入文件表时返回 true
     */
    public static boolean isFileUrlValid(String url) {
        return StrUtil.isNotBlank(url)
                && url.length() <= MAX_FILE_URL_LENGTH
                && !containsControlCharacter(url);
    }

    /**
     * 校验可选 MIME 类型满足数据库字段长度约束。
     *
     * @param mimeType MIME 类型；为空表示不记录
     * @return MIME 类型为空或可安全写入文件表时返回 true
     */
    public static boolean isMimeTypeValid(String mimeType) {
        return StrUtil.isEmpty(mimeType)
                || mimeType.length() <= MAX_MIME_TYPE_LENGTH
                && !containsControlCharacter(mimeType);
    }

    /**
     * 判断路径是否包含当前目录或父目录片段。
     *
     * @param path 待检查路径
     * @return 包含单独的点号目录片段时返回 true
     */
    private static boolean containsRelativeSegment(String path) {
        for (String segment : path.split("/", -1)) {
            if (".".equals(segment) || "..".equals(segment)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 判断文本是否包含不可见控制字符。
     *
     * @param value 待检查文本
     * @return 包含控制字符时返回 true
     */
    private static boolean containsControlCharacter(String value) {
        return value.chars().anyMatch(Character::isISOControl);
    }
}
