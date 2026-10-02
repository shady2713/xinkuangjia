package com.basicframework.module.infra.framework.file.core.utils;

import cn.hutool.core.io.FileUtil;
import cn.hutool.core.io.IoUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.util.http.HttpUtils;
import jakarta.servlet.http.HttpServletResponse;
import lombok.SneakyThrows;
import lombok.extern.slf4j.Slf4j;
import org.apache.tika.Tika;
import org.apache.tika.mime.MimeTypeException;
import org.apache.tika.mime.MimeTypes;

import java.io.IOException;
import java.util.Locale;
import java.util.Set;

/**
 * 文件类型识别、上传白名单和响应输出工具。
 *
 * @author 李杰
 */
@Slf4j
public final class FileTypeUtils {

    private static final Tika TIKA = new Tika();

    /**
     * 图片后缀集合，图片统一按 image/* 的 MIME 规则校验。
     */
    private static final Set<String> IMAGE_EXTENSIONS = Set.of("jpg", "jpeg", "png", "gif", "bmp", "webp");
    /**
     * 视频后缀集合，视频数据源上传本地文件时需要放行这些常见容器格式。
     */
    private static final Set<String> VIDEO_EXTENSIONS = Set.of("mp4", "m4v", "mov", "avi", "mkv", "webm", "flv");
    /**
     * 当前允许上传的文件后缀白名单。
     */
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            "jpg", "jpeg", "png", "gif", "bmp", "webp",
            "mp4", "m4v", "mov", "avi", "mkv", "webm", "flv",
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "zip");
    /**
     * Office 文件在不同检测器下可能返回多个 MIME，这里统一兼容处理。
     */
    private static final Set<String> DOC_MIME_TYPES = Set.of("application/msword", "application/x-tika-msoffice");
    private static final Set<String> DOCX_MIME_TYPES = Set.of("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    private static final Set<String> XLS_MIME_TYPES = Set.of("application/vnd.ms-excel", "application/x-tika-msoffice");
    private static final Set<String> XLSX_MIME_TYPES = Set.of("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    private static final Set<String> PPT_MIME_TYPES = Set.of("application/vnd.ms-powerpoint", "application/x-tika-msoffice");
    private static final Set<String> PPTX_MIME_TYPES = Set.of("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    private static final Set<String> ZIP_MIME_TYPES = Set.of("application/zip", "application/x-zip-compressed");
    /**
     * 少数 MP4/M4V 文件在 Tika 下可能识别为 application/mp4，不能只按 video/* 判断。
     */
    private static final Set<String> VIDEO_COMPATIBLE_MIME_TYPES = Set.of("application/mp4");

    /**
     * 禁止实例化纯静态工具类。
     */
    private FileTypeUtils() {
    }

    /**
     * 根据文件内容识别 MIME 类型。
     *
     * @param data 文件内容
     * @return MIME 类型，无法识别时通常返回 application/octet-stream
     */
    @SneakyThrows
    public static String getMineType(byte[] data) {
        return TIKA.detect(data);
    }

    /**
     * 根据文件名识别 MIME 类型。
     *
     * @param name 文件名
     * @return MIME 类型，无法识别时通常返回 application/octet-stream
     */
    public static String getMineType(String name) {
        return TIKA.detect(name);
    }

    /**
     * 同时结合文件内容和文件名识别 MIME 类型，通常比单独识别更准确。
     *
     * @param data 文件内容
     * @param name 文件名
     * @return MIME 类型，无法识别时通常返回 application/octet-stream
     */
    public static String getMineType(byte[] data, String name) {
        return TIKA.detect(data, name);
    }

    /**
     * 根据 MIME 类型获取推荐的文件后缀。
     *
     * @param mineType MIME 类型
     * @return 后缀，例如 .pdf；无法识别时返回 null
     */
    public static String getExtension(String mineType) {
        try {
            return MimeTypes.getDefaultMimeTypes().forName(mineType).getExtension();
        } catch (MimeTypeException e) {
            log.warn("[getExtension][获取文件后缀({}) 失败]", mineType, e);
            return null;
        }
    }

    /**
     * 提取并标准化文件后缀，统一转成小写，避免大小写导致白名单判断失效。
     *
     * @param fileName 文件名
     * @return 标准化后的后缀，不包含点号
     */
    public static String getFileExtension(String fileName) {
        return StrUtil.nullToDefault(FileUtil.extName(fileName), "").toLowerCase(Locale.ROOT);
    }

    /**
     * 校验上传文件的后缀和识别出的 MIME 是否都在允许范围内。
     *
     * @param data 文件内容
     * @param fileName 文件名
     * @return 是否允许上传
     */
    public static boolean isAllowedUploadType(byte[] data, String fileName) {
        String extension = getFileExtension(fileName);
        // 先拦截无后缀或不在白名单中的文件，避免继续做无意义的 MIME 检测。
        if (StrUtil.isEmpty(extension) || !ALLOWED_EXTENSIONS.contains(extension)) {
            return false;
        }
        String mineType = StrUtil.nullToDefault(getMineType(data, fileName), "").toLowerCase(Locale.ROOT);
        // 图片统一按 image/* 校验，兼容 jpeg、png 等具体子类型。
        if (IMAGE_EXTENSIONS.contains(extension)) {
            return isImage(mineType);
        }
        // 视频文件仍然要求内容 MIME 与视频容器匹配，避免单纯改后缀绕过白名单。
        if (VIDEO_EXTENSIONS.contains(extension)) {
            return isVideo(mineType);
        }
        return switch (extension) {
            case "pdf" -> StrUtil.equals(mineType, "application/pdf");
            case "doc" -> DOC_MIME_TYPES.contains(mineType);
            case "docx" -> DOCX_MIME_TYPES.contains(mineType);
            case "xls" -> XLS_MIME_TYPES.contains(mineType);
            case "xlsx" -> XLSX_MIME_TYPES.contains(mineType);
            case "ppt" -> PPT_MIME_TYPES.contains(mineType);
            case "pptx" -> PPTX_MIME_TYPES.contains(mineType);
            case "txt" -> StrUtil.startWith(mineType, "text/");
            case "zip" -> ZIP_MIME_TYPES.contains(mineType);
            default -> false;
        };
    }

    /**
     * 将文件内容按附件方式写回响应；图片走 inline，其他文件走 attachment。
     *
     * @param response 响应对象
     * @param filename 文件名
     * @param content 文件内容
     */
    public static void writeAttachment(HttpServletResponse response, String filename, byte[] content) throws IOException {
        String mineType = getMineType(content, filename);
        response.setContentType(mineType);
        // 图片直接预览，其他类型触发浏览器下载。
        if (isImage(mineType)) {
            response.setHeader("Content-Disposition", "inline;filename=" + HttpUtils.encodeUtf8(filename));
        } else {
            response.setHeader("Content-Disposition", "attachment;filename=" + HttpUtils.encodeUtf8(filename));
        }
        // 针对视频设置分段下载头，兼容移动端在线播放。
        if (StrUtil.containsIgnoreCase(mineType, "video")) {
            response.setHeader("Accept-Ranges", "bytes");
            response.setHeader("Content-Length", String.valueOf(content.length));
        }
        // 将附件内容输出到响应流。
        IoUtil.write(response.getOutputStream(), false, content);
    }

    /**
     * 判断 MIME 类型是否属于图片。
     *
     * @param mineType MIME 类型
     * @return 是否为图片
     */
    public static boolean isImage(String mineType) {
        return StrUtil.startWith(mineType, "image/");
    }

    /**
     * 判断 MIME 类型是否属于视频。
     *
     * @param mineType MIME 类型
     * @return 是否为视频
     */
    public static boolean isVideo(String mineType) {
        return StrUtil.startWith(mineType, "video/")
                || VIDEO_COMPATIBLE_MIME_TYPES.contains(mineType);
    }

}
