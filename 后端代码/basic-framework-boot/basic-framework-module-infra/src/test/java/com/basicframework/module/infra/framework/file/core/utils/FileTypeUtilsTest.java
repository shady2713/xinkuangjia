package com.basicframework.module.infra.framework.file.core.utils;

import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.poifs.filesystem.POIFSFileSystem;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证文件类型识别、上传白名单与响应写出工具的真实行为。
 *
 * <p>该工具类是上传入口与下载出口的最后一道类型判定：白名单写松会让改后缀的可执行内容
 * 进入对象存储，写严会拦掉正常业务文件；响应头写错会让图片被强制下载或让视频无法分段播放。
 * 因此这里用真实文件内容（真实 PDF、文本、ZIP、PNG、OLE2、OOXML 文档）驱动 Tika 识别，锁定契约：</p>
 * <ul>
 *   <li>内容识别与按文件名识别各自可用；无法识别时返回通用类型而不是抛错；</li>
 *   <li>MIME 到后缀的映射可取，未知 MIME 返回 null 而不是编造后缀；</li>
 *   <li>白名单同时校验后缀与真实内容，改后缀、无后缀、不在白名单的后缀都必须拒绝；</li>
 *   <li>图片走 inline、其它类型走 attachment，视频额外带分段下载头。</li>
 * </ul>
 *
 * @author shady2713
 */
class FileTypeUtilsTest {

    /** 真实 PDF 内容，足以被 Tika 识别为 application/pdf。 */
    private static final byte[] PDF = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
            .getBytes(StandardCharsets.UTF_8);

    /** 纯文本内容。 */
    private static final byte[] TEXT = "DUMMY-CONTENT 文本内容".getBytes(StandardCharsets.UTF_8);

    /** 可被识别为 SVG 的标记内容，用于验证图片白名单拒绝非栅格图片。 */
    private static final byte[] SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>".getBytes(StandardCharsets.UTF_8);

    /** MP4 文件头（ftyp box），Tika 按内容识别为视频。 */
    private static final byte[] MP4_HEADER = new byte[]{0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm',
            0, 0, 2, 0, 'i', 's', 'o', 'm', 'i', 's', 'o', '2'};

    /** 真实 PNG 图片。 */
    private static final byte[] PNG = png();

    /** 按内容识别 MIME，内容不可识别时返回通用二进制类型。 */
    @Test
    void getMineTypeByContentDetectsKnownFormat() {
        assertThat(FileTypeUtils.getMineType(PDF)).isEqualTo("application/pdf");
        assertThat(FileTypeUtils.getMineType(TEXT)).isEqualTo("text/plain");
        assertThat(FileTypeUtils.getMineType(new byte[]{0x01, 0x02, 0x03, 0x04}))
                .as("不可识别的内容返回通用二进制类型").isEqualTo("application/octet-stream");
    }

    /** 按文件名识别扩展名对应的 MIME，用于只拿到文件名的场景。 */
    @Test
    void getMineTypeByNameUsesExtension() {
        assertThat(FileTypeUtils.getMineType("report.pdf")).isEqualTo("application/pdf");
        assertThat(FileTypeUtils.getMineType("archive.zip")).isEqualTo("application/zip");
    }

    /** MIME 到后缀的映射可取，未知 MIME 必须返回 null 而不是编造后缀。 */
    @Test
    void getExtensionMapsKnownMimeAndRejectsUnknown() {
        assertThat(FileTypeUtils.getExtension("application/pdf")).isEqualTo(".pdf");
        assertThat(FileTypeUtils.getExtension("application/vnd.ms-excel")).contains(".xls");
        assertThat(FileTypeUtils.getExtension("DUMMY-NOT-A-MIME")).as("未知 MIME 必须返回 null").isNull();
    }

    /** 白名单内的文档、压缩包、图片与视频必须放行，且都基于真实内容判定。 */
    @Test
    void isAllowedUploadTypeAcceptsWhitelistedRealContent() throws Exception {
        assertThat(FileTypeUtils.isAllowedUploadType(PDF, "报告.PDF")).as("后缀大小写不影响白名单").isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(TEXT, "note.txt")).isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(PNG, "photo.png")).isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(MP4_HEADER, "clip.mp4")).isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(zip(), "bundle.zip")).isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(ole2(), "legacy.doc")).as("OLE2 文档必须放行").isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(ole2(), "legacy.xls")).isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(ole2(), "legacy.ppt")).isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(hssf(), "sheet.xls")).as("真实 xls 必须放行").isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(docx(), "doc.docx")).as("真实 docx 必须放行").isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(xlsx(), "sheet.xlsx")).isTrue();
        assertThat(FileTypeUtils.isAllowedUploadType(pptx(), "slides.pptx")).isTrue();
    }

    /** 白名单外的后缀、无后缀与内容不匹配的文件都必须拒绝。 */
    @Test
    void isAllowedUploadTypeRejectsUnlistedOrMismatchedContent() {
        assertThat(FileTypeUtils.isAllowedUploadType(PDF, "payload.exe")).as("不在白名单的后缀必须拒绝").isFalse();
        assertThat(FileTypeUtils.isAllowedUploadType(PDF, "noextension")).as("无后缀必须拒绝").isFalse();
        assertThat(FileTypeUtils.isAllowedUploadType(SVG, "fake.jpg"))
                .as("图片后缀必须匹配栅格图片 MIME，SVG 不得通过").isFalse();
        assertThat(FileTypeUtils.isAllowedUploadType(PDF, "fake.png")).as("PDF 内容改名为图片必须拒绝").isFalse();
        assertThat(FileTypeUtils.isAllowedUploadType(PDF, "fake.docx")).as("内容与文档后缀不匹配必须拒绝").isFalse();
        assertThat(FileTypeUtils.isAllowedUploadType(PDF, "fake.zip")).as("内容与压缩包后缀不匹配必须拒绝").isFalse();
        assertThat(FileTypeUtils.isAllowedUploadType(PDF, "fake.mp4")).as("非视频内容不得按视频放行").isFalse();
    }

    /** 图片内容按 inline 预览写出，响应体与内容类型必须与输入一致。 */
    @Test
    void writeAttachmentWritesImageInline() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        FileTypeUtils.writeAttachment(response, "照片.png", PNG);

        assertThat(response.getContentType()).isEqualTo("image/png");
        assertThat(response.getHeader("Content-Disposition")).startsWith("inline;filename=");
        assertThat(response.getHeader("Accept-Ranges")).as("图片不需要分段下载头").isNull();
        assertThat(response.getContentAsByteArray()).as("响应体必须是原文件内容").isEqualTo(PNG);
    }

    /** 视频内容写出分段下载头，浏览器可拖动进度而不是整段下载。 */
    @Test
    void writeAttachmentAddsRangeHeadersForVideo() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        FileTypeUtils.writeAttachment(response, "clip.mp4", MP4_HEADER);

        assertThat(response.getContentType()).startsWith("video/");
        assertThat(response.getHeader("Content-Disposition")).startsWith("attachment;filename=");
        assertThat(response.getHeader("Accept-Ranges")).isEqualTo("bytes");
        assertThat(response.getHeader("Content-Length")).isEqualTo(String.valueOf(MP4_HEADER.length));
        assertThat(response.getContentAsByteArray()).isEqualTo(MP4_HEADER);
    }

    /** 非图片非视频按附件下载，中文文件名必须能被浏览器正确解码。 */
    @Test
    void writeAttachmentUsesAttachmentForOtherTypes() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        FileTypeUtils.writeAttachment(response, "报告.pdf", PDF);

        assertThat(response.getContentType()).isEqualTo("application/pdf");
        assertThat(response.getHeader("Content-Disposition")).startsWith("attachment;filename=")
                .doesNotContain("报告.pdf");
        assertThat(response.getContentAsByteArray()).isEqualTo(PDF);
    }

    /** 视频判定必须同时接受 video/* 与 Tika 对部分 MP4 返回的 application/mp4。 */
    @Test
    void isVideoAcceptsVideoPrefixAndMp4CompatibilityType() {
        assertThat(FileTypeUtils.isVideo("video/mp4")).isTrue();
        assertThat(FileTypeUtils.isVideo("application/mp4")).as("Tika 对部分 MP4 返回该类型，必须识别为视频").isTrue();
        assertThat(FileTypeUtils.isVideo("image/png")).isFalse();
        assertThat(FileTypeUtils.isVideo("application/octet-stream")).isFalse();
        // 空类型查询在兼容集合上抛 NPE（Set.of 不接受 null 查询）；生产调用方已把 null 归一为空串，
        // 这里按真实行为断言并作为待处理发现记录，不把"返回 false"的假设当成契约。
        assertThatThrownBy(() -> FileTypeUtils.isVideo(null)).isInstanceOf(NullPointerException.class);
    }

    /** 生成真实 PNG 图片字节。 */
    private static byte[] png() {
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            ImageIO.write(new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", output);
            return output.toByteArray();
        } catch (Exception failure) {
            throw new IllegalStateException("构造 PNG 夹具失败", failure);
        }
    }

    /** 生成真实 ZIP 字节。 */
    private static byte[] zip() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            zip.putNextEntry(new ZipEntry("DUMMY.txt"));
            zip.write(TEXT);
            zip.closeEntry();
        }
        return output.toByteArray();
    }

    /** 生成真实 OLE2 复合文档字节（老版本 Office 容器）。 */
    private static byte[] ole2() throws Exception {
        try (POIFSFileSystem fileSystem = new POIFSFileSystem();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            fileSystem.createDocument(new ByteArrayInputStream(TEXT), "DUMMY");
            fileSystem.writeFilesystem(output);
            return output.toByteArray();
        }
    }

    /** 生成真实 xls 字节。 */
    private static byte[] hssf() throws Exception {
        try (HSSFWorkbook workbook = new HSSFWorkbook();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            workbook.createSheet("DUMMY").createRow(0).createCell(0).setCellValue("DUMMY");
            workbook.write(output);
            return output.toByteArray();
        }
    }

    /** 生成真实 docx 字节。 */
    private static byte[] docx() throws Exception {
        try (XWPFDocument document = new XWPFDocument();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            document.createParagraph().createRun().setText("DUMMY");
            document.write(output);
            return output.toByteArray();
        }
    }

    /** 生成真实 xlsx 字节。 */
    private static byte[] xlsx() throws Exception {
        try (XSSFWorkbook workbook = new XSSFWorkbook();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            workbook.createSheet("DUMMY").createRow(0).createCell(0).setCellValue("DUMMY");
            workbook.write(output);
            return output.toByteArray();
        }
    }

    /** 生成真实 pptx 字节。 */
    private static byte[] pptx() throws Exception {
        try (XMLSlideShow slideShow = new XMLSlideShow();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            slideShow.createSlide();
            slideShow.write(output);
            return output.toByteArray();
        }
    }

}
