package com.basicframework.module.infra.framework.file.core.utils;

import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.util.http.HttpUtils;
import jakarta.servlet.http.HttpServletResponse;
import lombok.SneakyThrows;
import lombok.extern.slf4j.Slf4j;
import org.apache.tika.Tika;
import org.apache.tika.mime.MimeTypeException;
import org.apache.tika.mime.MimeTypes;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Set;

/**
 * 文件类型识别、上传白名单和响应输出工具。
 *
 * @author shady
 */
@Slf4j
public final class FileTypeUtils {

    private static final Tika TIKA = new Tika();

    /**
     * 安全光栅图片后缀集合；显式排除 SVG 等可执行脚本的矢量格式。
     */
    private static final Set<String> IMAGE_EXTENSIONS = Set.of("jpg", "jpeg", "png", "gif", "bmp", "webp");

    /**
     * 安全光栅图片 MIME 白名单；严禁放行 {@code image/svg+xml} 以防同源内联存储型 XSS。
     */
    private static final Set<String> RASTER_IMAGE_MIME_TYPES = Set.of(
            "image/jpeg", "image/png", "image/gif", "image/bmp", "image/x-ms-bmp", "image/webp");

    /**
     * 视频后缀集合。
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
     * Office 与压缩包 MIME 兼容集合。
     */
    private static final Set<String> DOC_MIME_TYPES = Set.of("application/msword", "application/x-tika-msoffice");
    private static final Set<String> DOCX_MIME_TYPES = Set.of("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    private static final Set<String> XLS_MIME_TYPES = Set.of("application/vnd.ms-excel", "application/x-tika-msoffice");
    private static final Set<String> XLSX_MIME_TYPES = Set.of("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    private static final Set<String> PPT_MIME_TYPES = Set.of("application/vnd.ms-powerpoint", "application/x-tika-msoffice");
    private static final Set<String> PPTX_MIME_TYPES = Set.of("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    private static final Set<String> ZIP_MIME_TYPES = Set.of("application/zip", "application/x-zip-compressed");

    /**
     * 少数 MP4/M4V 文件在 Tika 下可能识别为 application/mp4。
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
     * @return MIME 类型
     */
    @SneakyThrows
    public static String getMineType(byte[] data) {
        return TIKA.detect(data);
    }

    /**
     * 根据文件名识别 MIME 类型。
     *
     * @param name 文件名
     * @return MIME 类型
     */
    public static String getMineType(String name) {
        return TIKA.detect(name);
    }

    /**
     * 同时结合文件内容和文件名识别 MIME 类型。
     *
     * @param data 文件内容
     * @param name 文件名
     * @return MIME 类型
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
     * 提取并标准化文件后缀，统一转成小写。
     *
     * @param fileName 文件名
     * @return 标准化后的后缀，不包含点号
     */
    public static String getFileExtension(String fileName) {
        return StrUtil.nullToDefault(FileUtil.extName(fileName), "").toLowerCase(Locale.ROOT);
    }

    /**
     * 校验文件名后缀是否落在上传白名单内（供预签名直传前置拦截使用）。
     *
     * @param fileName 文件名
     * @return 后缀合法时返回 true
     */
    public static boolean isAllowedUploadFileName(String fileName) {
        String extension = getFileExtension(fileName);
        return StrUtil.isNotEmpty(extension) && ALLOWED_EXTENSIONS.contains(extension);
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
        if (StrUtil.isEmpty(extension) || !ALLOWED_EXTENSIONS.contains(extension)) {
            return false;
        }
        // 对光栅图片后缀与纯文本后缀优先基于纯字节检测真实内容类型，阻止把 SVG/HTML 改名为 .png/.txt 混入。
        String detectedMime;
        if (IMAGE_EXTENSIONS.contains(extension) || "txt".equals(extension)) {
            String contentOnlyMime = StrUtil.nullToDefault(getMineType(data), "").toLowerCase(Locale.ROOT);
            if ("image/svg+xml".equals(contentOnlyMime)
                    || "text/html".equals(contentOnlyMime)
                    || "application/xhtml+xml".equals(contentOnlyMime)) {
                return false;
            }
            detectedMime = StrUtil.nullToDefault(getMineType(data, fileName), "").toLowerCase(Locale.ROOT);
        } else {
            detectedMime = StrUtil.nullToDefault(getMineType(data, fileName), "").toLowerCase(Locale.ROOT);
        }
        return isExtensionAndMimeMatched(extension, detectedMime);
    }

    /**
     * 校验预签名直传完成后的文件名后缀与声明 MIME 是否严格匹配白名单。
     *
     * @param fileName 原始文件名
     * @param declaredMimeType 声明的 MIME（为空时按文件名推断）
     * @return 后缀与 MIME 均合法时返回 true
     */
    public static boolean isAllowedUploadMetadata(String fileName, String declaredMimeType) {
        String extension = getFileExtension(fileName);
        if (StrUtil.isEmpty(extension) || !ALLOWED_EXTENSIONS.contains(extension)) {
            return false;
        }
        String normalizedMime = normalizeMimeType(
                StrUtil.blankToDefault(declaredMimeType, getMineType(fileName)));
        return isExtensionAndMimeMatched(extension, normalizedMime);
    }

    /**
     * 校验已标准化的小写后缀与 MIME 类型是否一一对应。
     *
     * @param extension 小写无点后缀
     * @param mimeType 去除参数后的小写 MIME
     * @return 匹配时返回 true
     */
    private static boolean isExtensionAndMimeMatched(String extension, String mimeType) {
        String cleanMime = normalizeMimeType(mimeType);
        if (IMAGE_EXTENSIONS.contains(extension)) {
            return isImage(cleanMime);
        }
        if (VIDEO_EXTENSIONS.contains(extension)) {
            return isVideo(cleanMime);
        }
        return switch (extension) {
            case "pdf" -> StrUtil.equals(cleanMime, "application/pdf");
            case "doc" -> DOC_MIME_TYPES.contains(cleanMime);
            case "docx" -> DOCX_MIME_TYPES.contains(cleanMime);
            case "xls" -> XLS_MIME_TYPES.contains(cleanMime);
            case "xlsx" -> XLSX_MIME_TYPES.contains(cleanMime);
            case "ppt" -> PPT_MIME_TYPES.contains(cleanMime);
            case "pptx" -> PPTX_MIME_TYPES.contains(cleanMime);
            // 仅允许纯文本 text/plain，彻底封堵将 HTML 脚本改后缀为 .txt 的同源存储型 XSS。
            case "txt" -> StrUtil.equals(cleanMime, "text/plain");
            case "zip" -> ZIP_MIME_TYPES.contains(cleanMime);
            default -> false;
        };
    }

    /**
     * 去除 MIME 中的字符集等分号参数并转为小写。
     *
     * @param mimeType 原始 MIME
     * @return 纯净小写 MIME
     */
    private static String normalizeMimeType(String mimeType) {
        String raw = StrUtil.nullToDefault(mimeType, "").trim().toLowerCase(Locale.ROOT);
        int semicolonIndex = raw.indexOf(';');
        return semicolonIndex >= 0 ? raw.substring(0, semicolonIndex).trim() : raw;
    }

    /** 流式嗅探魔数时保留的头部最大字节数。 */
    private static final int MIME_HEADER_BYTES = 4096;

    /** 流式分段拷贝使用的缓冲区大小。 */
    private static final int STREAM_BUFFER_BYTES = 8192;

    /** Range 请求头前缀。 */
    private static final String RANGE_BYTES_PREFIX = "bytes=";

    /**
     * 解析安全的下载响应 MIME 类型，强制将 SVG/HTML/XHTML 降级为二进制流以防脚本执行。
     *
     * @param sampleBytes 文件完整内容或头部采样字节
     * @param filename    文件名
     * @return 安全的标准 MIME 类型
     */
    private static String resolveSafeMimeType(byte[] sampleBytes, String filename) {
        String contentOnlyMime = normalizeMimeType(getMineType(sampleBytes));
        if ("image/svg+xml".equals(contentOnlyMime)
                || "text/html".equals(contentOnlyMime)
                || "application/xhtml+xml".equals(contentOnlyMime)) {
            return "application/octet-stream";
        }
        return normalizeMimeType(getMineType(sampleBytes, filename));
    }

    /**
     * 写出统一的下载安全响应头与长度/断点续传支持头。
     *
     * @param response      响应对象
     * @param filename      文件名
     * @param mineType      安全 MIME 类型
     * @param contentLength 本次响应体总字节数，未知时为 {@code null}
     */
    private static void writeCommonHeaders(HttpServletResponse response, String filename,
                                           String mineType, Long contentLength) {
        if ("text/plain".equals(mineType)) {
            response.setContentType("text/plain; charset=utf-8");
        } else {
            response.setContentType(mineType);
        }
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Security-Policy", "sandbox");
        // 仅白名单内的光栅图片允许内联预览，SVG 等脚本载体一律降级为附件下载。
        if (isImage(mineType)) {
            response.setHeader("Content-Disposition", "inline;filename=" + HttpUtils.encodeUtf8(filename));
        } else {
            response.setHeader("Content-Disposition", "attachment;filename=" + HttpUtils.encodeUtf8(filename));
        }
        if (contentLength != null && contentLength >= 0) {
            response.setHeader("Accept-Ranges", "bytes");
            response.setContentLengthLong(contentLength);
        }
    }

    /**
     * 以流式方式写出文件内容，并在已知长度时输出 {@code Content-Length}、{@code Accept-Ranges} 及单段 206/416 响应。
     *
     * @param response      响应对象
     * @param filename      文件名
     * @param inputStream   文件内容流（调用方负责关闭）
     * @param contentLength 文件总字节数，未知时可为 {@code null}
     * @param rangeHeader   请求头 {@code Range}，为空时返回完整流
     * @throws IOException 响应写出失败时抛出
     */
    public static void writeAttachment(HttpServletResponse response, String filename,
                                       InputStream inputStream, Long contentLength,
                                       String rangeHeader) throws IOException {
        BufferedInputStream buffered = new BufferedInputStream(inputStream, STREAM_BUFFER_BYTES);
        buffered.mark(STREAM_BUFFER_BYTES);
        byte[] header = buffered.readNBytes(MIME_HEADER_BYTES);
        buffered.reset();

        String mineType = resolveSafeMimeType(header, filename);
        if (contentLength != null && isSingleBytesRangeRequest(rangeHeader)) {
            if (contentLength <= 0) {
                writeUnsatisfiableRange(response, 0L);
                return;
            }
            long[] range = parseSingleRange(rangeHeader, contentLength);
            if (range == null) {
                writeUnsatisfiableRange(response, contentLength);
                return;
            }
            long start = range[0];
            long end = range[1];
            long partLength = end - start + 1;
            writeCommonHeaders(response, filename, mineType, partLength);
            response.setStatus(HttpServletResponse.SC_PARTIAL_CONTENT);
            response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + contentLength);
            buffered.skipNBytes(start);
            copyFixedLength(buffered, response.getOutputStream(), partLength);
            return;
        }
        writeCommonHeaders(response, filename, mineType, contentLength);
        buffered.transferTo(response.getOutputStream());
    }

    /**
     * 判断请求头是否为单个 {@code bytes=} 范围请求（多段范围按 RFC 9110 回退为整文件响应）。
     *
     * @param rangeHeader 原始 Range 请求头
     * @return 为单段字节范围请求时返回 true
     */
    private static boolean isSingleBytesRangeRequest(String rangeHeader) {
        if (StrUtil.isBlank(rangeHeader) || rangeHeader.contains(",")) {
            return false;
        }
        return rangeHeader.trim().toLowerCase(Locale.ROOT).startsWith(RANGE_BYTES_PREFIX);
    }

    /**
     * 输出 HTTP 416 Range Not Satisfiable 响应及完整长度提示头。
     *
     * @param response      响应对象
     * @param contentLength 资源真实总长度
     */
    private static void writeUnsatisfiableRange(HttpServletResponse response, long contentLength) {
        response.setStatus(HttpServletResponse.SC_REQUESTED_RANGE_NOT_SATISFIABLE);
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Content-Range", "bytes */" + contentLength);
    }

    /**
     * 解析单个 {@code bytes=start-end} / {@code bytes=start-} / {@code bytes=-suffix} 闭区间字节范围。
     *
     * @param rangeHeader 原始 Range 请求头
     * @param totalLength 资源总字节长度（必须大于 0）
     * @return 起止偏移闭区间 {@code [start, end]}；语法非法或越界时返回 {@code null}
     */
    private static long[] parseSingleRange(String rangeHeader, long totalLength) {
        String spec = rangeHeader.trim().substring(RANGE_BYTES_PREFIX.length()).trim();
        int dash = spec.indexOf('-');
        if (dash < 0) {
            return null;
        }
        String startPart = spec.substring(0, dash).trim();
        String endPart = spec.substring(dash + 1).trim();
        if (startPart.isEmpty() && endPart.isEmpty()) {
            return null;
        }
        if (startPart.isEmpty()) {
            long suffixLength = parseNonNegativeLong(endPart);
            if (suffixLength <= 0) {
                return null;
            }
            long start = Math.max(0L, totalLength - suffixLength);
            return new long[]{start, totalLength - 1};
        }
        long start = parseNonNegativeLong(startPart);
        if (start < 0 || start >= totalLength) {
            return null;
        }
        if (endPart.isEmpty()) {
            return new long[]{start, totalLength - 1};
        }
        long parsedEnd = parseNonNegativeLong(endPart);
        if (parsedEnd < start) {
            return null;
        }
        return new long[]{start, Math.min(parsedEnd, totalLength - 1)};
    }

    /**
     * 解析纯 ASCII 非负十进制整数，防止正负号、小数或溢出被放行。
     *
     * @param value 待解析字符串
     * @return 非负长整数；格式非法或溢出时返回 {@code -1L}
     */
    private static long parseNonNegativeLong(String value) {
        if (StrUtil.isEmpty(value)) {
            return -1L;
        }
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            if (ch < '0' || ch > '9') {
                return -1L;
            }
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException ex) {
            return -1L;
        }
    }

    /**
     * 按固定字节上限将输入流分段写入输出流，避免超范围传输或额外分配大数组。
     *
     * @param in          已定位到起始偏移的输入流
     * @param out         响应输出流
     * @param bytesToCopy 期望拷贝的字节数
     * @throws IOException 读写失败时抛出
     */
    private static void copyFixedLength(InputStream in, OutputStream out, long bytesToCopy) throws IOException {
        byte[] buffer = new byte[STREAM_BUFFER_BYTES];
        long remaining = bytesToCopy;
        while (remaining > 0) {
            int maxRead = (int) Math.min(buffer.length, remaining);
            int read = in.read(buffer, 0, maxRead);
            if (read < 0) {
                break;
            }
            out.write(buffer, 0, read);
            remaining -= read;
        }
    }

    /**
     * 判断 MIME 类型是否属于安全光栅图片（不含 SVG）。
     *
     * @param mineType MIME 类型
     * @return 属于安全光栅图片时返回 true
     */
    public static boolean isImage(String mineType) {
        return RASTER_IMAGE_MIME_TYPES.contains(normalizeMimeType(mineType));
    }

    /**
     * 判断 MIME 类型是否属于允许的视频容器。
     *
     * @param mineType MIME 类型
     * @return 是否为视频
     */
    public static boolean isVideo(String mineType) {
        String cleanMime = normalizeMimeType(mineType);
        return StrUtil.startWith(cleanMime, "video/")
                || VIDEO_COMPATIBLE_MIME_TYPES.contains(cleanMime);
    }

}
