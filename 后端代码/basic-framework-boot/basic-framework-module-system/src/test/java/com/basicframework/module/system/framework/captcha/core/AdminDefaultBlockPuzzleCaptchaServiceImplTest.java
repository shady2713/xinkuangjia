package com.basicframework.module.system.framework.captcha.core;

import com.anji.captcha.model.common.RepCodeEnum;
import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.util.ImageUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Font;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.spy;

/**
 * 验证管理平台滑块验证码的底图加载、水印绘制与生成结果契约。
 *
 * <p>该实现与业务平台分开加载 aj-captcha 依赖自带的默认图库，避免两个平台争用同一份全局图片
 * 缓存。生成结果必须是可解码的底图与拼图块，否则前端滑块无法渲染；水印未配置时不得改动底图
 * 像素，配置后必须真实绘制到图上。用例直接消费依赖包内的真实默认图库，不做图片替身。</p>
 *
 * @author shady2713
 */
class AdminDefaultBlockPuzzleCaptchaServiceImplTest {

    /** 被测验证码实现。 */
    private AdminDefaultBlockPuzzleCaptchaServiceImpl captchaService;
    /** 用例开始前的静态水印文本，结束后原样恢复。 */
    private String previousWaterMark;

    /** 为每个用例创建独立实例并记录静态水印文本。 */
    @BeforeEach
    void setUp() {
        captchaService = new AdminDefaultBlockPuzzleCaptchaServiceImpl();
        previousWaterMark = (String) ReflectionTestUtils.getField(captchaService, "waterMark");
    }

    /** 还原静态水印文本，避免影响同 JVM 内的其他验证码用例。 */
    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(captchaService, "waterMark", previousWaterMark);
    }

    /**
     * 生成验证码必须返回可解码的底图与拼图块，且两者不是同一张图片。
     */
    @Test
    void getReturnsDecodableOriginalAndSlidingBlock() throws Exception {
        ResponseModel response = captchaService.get(new CaptchaVO());

        assertThat(response.isSuccess()).as("默认图库可用时必须生成成功").isTrue();
        CaptchaVO result = (CaptchaVO) response.getRepData();
        assertThat(result.getOriginalImageBase64()).isNotBlank();
        assertThat(result.getJigsawImageBase64()).isNotBlank();
        BufferedImage original = decode(result.getOriginalImageBase64());
        BufferedImage slidingBlock = decode(result.getJigsawImageBase64());
        assertThat(original).as("底图必须可解码").isNotNull();
        assertThat(slidingBlock).as("拼图块必须可解码").isNotNull();
        assertThat(result.getOriginalImageBase64()).as("拼图块不得复用底图内容")
                .isNotEqualTo(result.getJigsawImageBase64());
        assertThat(original.getWidth()).isGreaterThan(slidingBlock.getWidth());
    }

    /**
     * 未配置水印时不得在底图上绘制任何像素。
     */
    @Test
    void drawWaterMarkLeavesImageUntouchedWithoutWaterMark() {
        ReflectionTestUtils.setField(captchaService, "waterMark", "  ");
        BufferedImage image = blackImage();

        ReflectionTestUtils.invokeMethod(captchaService, "drawWaterMark", image);

        assertThat(containsNonBlackPixel(image)).as("无水印时底图必须保持原样").isFalse();
    }

    /**
     * 配置水印后必须把文本真实绘制到底图上，且不抛异常。
     */
    @Test
    void drawWaterMarkPaintsTextWhenConfigured() {
        ReflectionTestUtils.setField(captchaService, "waterMark", "管理平台");
        ReflectionTestUtils.setField(captchaService, "waterMarkFont", new Font(Font.SANS_SERIF, Font.PLAIN, 20));
        BufferedImage image = blackImage();

        ReflectionTestUtils.invokeMethod(captchaService, "drawWaterMark", image);

        assertThat(containsNonBlackPixel(image)).as("配置水印后底图必须出现绘制像素").isTrue();
    }

    /**
     * 生成验证码时同样走水印绘制分支，配置水印后仍能正常出图。
     */
    @Test
    void getSucceedsWithConfiguredWaterMark() {
        ReflectionTestUtils.setField(captchaService, "waterMark", "管理平台");
        ReflectionTestUtils.setField(captchaService, "waterMarkFont", new Font(Font.SANS_SERIF, Font.PLAIN, 20));

        ResponseModel response = captchaService.get(new CaptchaVO());

        assertThat(response.isSuccess()).isTrue();
        assertThat(((CaptchaVO) response.getRepData()).getOriginalImageBase64()).isNotBlank();
    }

    /**
     * 构造纯黑底图，便于检测是否被绘制过。
     *
     * @return 纯黑图片
     */
    private static BufferedImage blackImage() {
        BufferedImage image = new BufferedImage(200, 100, BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics graphics = image.getGraphics();
        graphics.setColor(Color.BLACK);
        graphics.fillRect(0, 0, image.getWidth(), image.getHeight());
        graphics.dispose();
        return image;
    }

    /**
     * 判断图片中是否存在非黑像素。
     *
     * @param image 待检测图片
     * @return 存在非黑像素时返回 true
     */
    private static boolean containsNonBlackPixel(BufferedImage image) {
        for (int x = 0; x < image.getWidth(); x++) {
            for (int y = 0; y < image.getHeight(); y++) {
                if ((image.getRGB(x, y) & 0xFFFFFF) != 0) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 解码 Base64 图片，内容非法时返回 null。
     *
     * @param base64 Base64 图片内容
     * @return 图片对象或 null
     * @throws Exception 解码失败时抛出
     */
    private static BufferedImage decode(String base64) throws Exception {
        assertThat(ImageUtils.getBase64StrToImage(base64)).as("工具解码结果必须与断言一致").isNotNull();
        return ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(base64)));
    }

    /**
     * 可读但不可解码为图片的素材必须被拒绝，而不是当成有效底图参与生成。
     *
     * <p>加载器把「读到字节」和「拿到图片」分开判断：只保留能解码的素材，否则后续裁剪会拿到空图，
     * 让登录关键路径出现难以定位的失败。这里用一条独立的非图片探针资源校验该边界，并保留一条
     * 真实依赖素材的正对照，证明 null 来自图片解码判定而不是资源找不到。</p>
     *
     * <p><b>白盒直调：</b>{@code loadDefaultImage} 是私有静态方法，生产调用点只传依赖包内置的
     * {@code defaultImages/jigsaw/original|slidingBlock/1..6.png}；探针资源使用独立路径，
     * 不遮蔽依赖包素材，也不改变本模块其它用例的类路径解析结果。</p>
     */
    @Test
    void loadDefaultImageRejectsReadableNonImageResource() throws Exception {
        assertThat(loadDefaultImage("captcha-probe-not-an-image.png"))
                .as("读到字节但解不出图片时必须返回 null 并从候选列表剔除").isNull();
        assertThat((String) loadDefaultImage("defaultImages/jigsaw/original/1.png"))
                .as("正对照：依赖包内真实图片必须返回非空 Base64").isNotBlank();
    }

    /**
     * 反射调用私有默认素材加载器，观察它对指定路径的真实返回。
     *
     * @param path 类路径上的资源路径
     * @return 加载成功时的 Base64 文本，不可用时为 null
     * @throws Exception 反射调用失败（含被测方法抛出的异常）时抛出
     */
    private static Object loadDefaultImage(String path) throws Exception {
        Method method = AdminDefaultBlockPuzzleCaptchaServiceImpl.class.getDeclaredMethod("loadDefaultImage", String.class);
        method.setAccessible(true);
        try {
            return method.invoke(null, path);
        } catch (InvocationTargetException exception) {
            throw (Exception) exception.getCause();
        }
    }

    /**
     * 默认底图解码失败时必须返回“底图缺失”业务码，而不是带着空图继续裁剪。
     *
     * <p>依赖包图库在类初始化时一次性加载，正常情况下永远非空；但解码失败（图库损坏、依赖升级换格式）
     * 会让裁剪拿到空图并在后续抛空指针，客户端只能看到 500。这里锁定“解码为空即返回业务错误码”。</p>
     *
     * <p><b>白盒直调：</b>静态素材列表是 {@code static final} 且由真实图库填充，无法替换；
     * 用例改用公开静态解码方法 {@code ImageUtils.getBase64StrToImage} 的替身让解码返回空，
     * 从而在不改动生产代码与依赖素材的前提下触发该分支。</p>
     */
    @Test
    void getReportsBasemapMissingWhenDefaultImageCannotBeDecoded() {
        try (MockedStatic<ImageUtils> mocked = mockStatic(ImageUtils.class)) {
            mocked.when(() -> ImageUtils.getBase64StrToImage(anyString())).thenReturn(null);

            ResponseModel response = captchaService.get(new CaptchaVO());

            assertThat(response.isSuccess()).as("底图解码失败时必须按失败返回").isFalse();
            assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_BASEMAP_NULL.getCode());
            assertThat(response.getRepData()).isNull();
        }
    }

    /**
     * 拼图块解码失败时必须返回“底图缺失”业务码，且不得进入裁剪与出图流程。
     *
     * <p>底图正常而拼图块解码失败是图库部分损坏的典型表现：此时若继续裁剪，
     * 前端拿到的是缺块的验证码，用户永远无法通过校验。这里锁定“第二张图解码为空即失败”。</p>
     *
     * <p><b>白盒直调：</b>同上一用例，用解码方法的替身让第一次调用（底图）返回真实图片、
     * 第二次调用（拼图块）返回空，精确命中拼图块为空的判定分支。</p>
     */
    @Test
    void getReportsBasemapMissingWhenSlidingBlockCannotBeDecoded() {
        try (MockedStatic<ImageUtils> mocked = mockStatic(ImageUtils.class)) {
            BufferedImage decodedOriginal = new BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB);
            mocked.when(() -> ImageUtils.getBase64StrToImage(anyString()))
                    .thenReturn(decodedOriginal).thenReturn(null);

            ResponseModel response = captchaService.get(new CaptchaVO());

            assertThat(response.isSuccess()).as("拼图块解码失败时必须按失败返回").isFalse();
            assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_BASEMAP_NULL.getCode());
        }
    }

    /**
     * 裁剪结果缺少底图或拼图块时必须返回验证码错误码，而不是把残缺结果发给前端。
     *
     * <p>裁剪由依赖包实现，返回 null 或缺少任一 Base64 字段时前端无法渲染滑块；
     * 这属于可预期的业务失败，必须给出明确的错误码而不是让前端解析空对象。</p>
     *
     * <p><b>白盒直调：</b>{@code pictureTemplatesCut} 是父类 public 方法，用例用 {@code spy}
     * 打桩让它返回 null，复用仓库既有的 spy 手法；底图与拼图块仍走真实图库。</p>
     */
    @Test
    void getReportsCaptchaErrorWhenTemplateCutProducesNothing() {
        AdminDefaultBlockPuzzleCaptchaServiceImpl spiedService =
                spy(new AdminDefaultBlockPuzzleCaptchaServiceImpl());
        doReturn(null).when(spiedService).pictureTemplatesCut(any(), any(), anyString());

        ResponseModel response = spiedService.get(new CaptchaVO());

        assertThat(response.isSuccess()).as("裁剪无结果时必须按业务失败返回").isFalse();
        assertThat(response.getRepCode()).isEqualTo(RepCodeEnum.API_CAPTCHA_ERROR.getCode());
        assertThat(response.getRepData()).isNull();
    }

    /**
     * 候选素材为空时必须返回 null，而不是抛出越界异常。
     *
     * <p>{@code randomBase64} 的入参是参数化列表，生产调用点只传类初始化时填充的静态列表，
     * 因此“空列表”在生产路径不可达；但空列表守卫是该方法对入参的完整契约，
     * 一旦被删掉，任何传入空集合的新调用点都会把随机取值变成越界异常。</p>
     *
     * <p><b>白盒直调：</b>方法私有且静态，反射直接传入空列表；同时用单元素列表做正对照，
     * 证明返回 null 来自空集合判定而不是方法被整体替换。</p>
     *
     * @throws Exception 反射查找或调用失败时抛出
     */
    @Test
    void randomBase64ReturnsNullForEmptyCandidates() throws Exception {
        Method method = AdminDefaultBlockPuzzleCaptchaServiceImpl.class.getDeclaredMethod("randomBase64", List.class);
        method.setAccessible(true);

        assertThat(method.invoke(null, List.of())).as("空候选必须返回 null").isNull();
        assertThat(method.invoke(null, List.of("candidate"))).as("正对照：单元素候选必须原样返回")
                .isEqualTo("candidate");
    }

    /**
     * 默认素材路径不存在时必须返回 null 并跳过该素材，而不是让类初始化失败。
     *
     * <p>类初始化按编号 1..6 逐个读取依赖包图库，任一编号缺失都会被过滤掉；
     * 这条守卫决定了“图库少一张图”只会减少可选用素材，而不是让登录页整体不可用。</p>
     *
     * <p><b>白盒直调：</b>{@code loadDefaultImage} 是私有静态方法，生产调用点只传依赖包内置路径，
     * 这里复用例内已有的反射助手，传一条确定不存在的路径。</p>
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void loadDefaultImageReturnsNullForMissingResource() throws Exception {
        assertThat(loadDefaultImage("captcha/does-not-exist-probe.png"))
                .as("资源不存在时必须返回 null").isNull();
    }

    /**
     * 素材读取或解码抛出受检 IOException 时必须返回 null，而不是让类初始化失败。
     *
     * <p>读取发生在 try-with-resources 中：截断图片会让 {@code ImageIO.read} 抛出
     * {@code IIOException}（{@link java.io.IOException} 的子类），关闭流也可能失败；
     * 这条 catch 是“依赖包素材损坏不影响启动”的兜底，删掉会让整个验证码实现无法加载。</p>
     *
     * <p><b>白盒直调：</b>生产调用点只传依赖包内置的完整 PNG，因此用一个独立的截断 PNG 探针
     * （真实 PNG 的前 40 字节）触发该分支。用例先断言探针本身确实会让 {@code ImageIO.read}
     * 抛出 {@link java.io.IOException}，再断言加载器把这次失败降级为 null，
     * 避免“探针其实走了另一个分支”导致用例名不副实。</p>
     *
     * @throws Exception 读取探针或反射调用失败时抛出
     */
    @Test
    void loadDefaultImageReturnsNullWhenProbeImageIsTruncated() throws Exception {
        byte[] probe = readProbe("captcha-probe-truncated.png");
        assertThatThrownBy(() -> ImageIO.read(new ByteArrayInputStream(probe)))
                .as("探针必须是会让解码抛 IOException 的截断 PNG，否则本用例证明不了 catch 分支")
                .isInstanceOf(IOException.class);

        assertThat(loadDefaultImage("captcha-probe-truncated.png"))
                .as("解码抛受检异常时必须返回 null 并跳过该素材").isNull();
    }

    /**
     * 素材加载器必须在每条返回路径上关闭资源，且把读取阶段的受检异常降级为 null。
     *
     * <p>加载器用 try-with-resources 管理依赖包内的素材流：无论正常返回、图片不可解码的提前
     * 返回，还是读取抛受检异常，底层流都必须被关闭；读取异常必须降级成“该素材不可用”，
     * 否则一次素材损坏就会让整个验证码实现的类初始化失败，登录页直接不可用。这里用真实
     * 依赖素材与独立探针资源覆盖正常关闭、提前返回关闭与读取异常三条可观测路径。</p>
     *
     * <p><b>观测限制：</b>本用例只消费类路径上的真实素材与探针资源，覆盖真实资源的正常关闭、
     * 提前返回关闭与读取异常三条路径；受控流注入（含「关闭本身失败」）由下面基于
     * {@code defaultImageResourceOpener} 接缝的用例覆盖，两者互补而不重复。</p>
     *
     * @throws Exception 反射调用或探针读取失败时抛出
     */
    @Test
    void loadDefaultImageClosesStreamAndDegradesReadFailureOnRealResources() throws Exception {
        assertThat((String) loadDefaultImage("defaultImages/jigsaw/original/1.png"))
                .as("正常返回路径：真实素材必须给出非空 Base64").isNotBlank();
        assertThat((String) loadDefaultImage("captcha-probe-not-an-image.png"))
                .as("图片不可解码的提前返回路径：同样必须清理资源并返回 null").isNull();
        assertThat((String) loadDefaultImage("captcha/does-not-exist-probe.png"))
                .as("资源不存在路径：必须返回 null").isNull();
        assertThat((String) loadDefaultImage("captcha-probe-truncated.png"))
                .as("读取抛受检异常路径：必须降级为 null 并关闭资源").isNull();
    }

    /**
     * 资源不存在时加载器必须返回 null，且确实按原始路径向读取接缝索取资源。
     *
     * <p>「资源不存在」的真实形态是 {@code getResourceAsStream} 返回 null。这里用接缝把它变成可控输入，
     * 锁定「取不到资源即降级为 null、不抛异常」的契约，并用路径回执证明加载器把原始路径交给了接缝，
     * 而不是绕开接缝另走一条查找。</p>
     *
     * <p><b>接缝的两条边：</b>本用例走的是关闭守卫的「流为空→跳过关闭」一侧；下面
     * {@link #loadDefaultImageClosesEveryNonNullResourceStream()} 用非空流走「必须关闭」一侧，
     * 两条用例合起来覆盖同一处守卫的两个方向。</p>
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void loadDefaultImageReturnsNullForMissingResourceThroughOpener() throws Exception {
        Function<String, InputStream> previous = AdminDefaultBlockPuzzleCaptchaServiceImpl.defaultImageResourceOpener;
        AtomicReference<String> requestedPath = new AtomicReference<>();
        try {
            AdminDefaultBlockPuzzleCaptchaServiceImpl.defaultImageResourceOpener = path -> {
                requestedPath.set(path);
                return null;
            };

            assertThat(loadDefaultImage("captcha/missing-through-opener.png"))
                    .as("接缝取不到资源时必须返回 null 而不是抛错").isNull();
            assertThat(requestedPath).as("加载器必须把原始路径交给读取接缝")
                    .hasValue("captcha/missing-through-opener.png");
        } finally {
            AdminDefaultBlockPuzzleCaptchaServiceImpl.defaultImageResourceOpener = previous;
        }
    }

    /**
     * 只要接缝给出了非空流，加载器就必须在每条返回路径上关闭它，并把受检异常降级为 null。
     *
     * <p>依赖包素材损坏有两种真实形态：字节读到一半失败、以及关闭流本身失败。两者都发生在
     * try-with-resources 的作用域内，必须同样返回 null 跳过该素材，绝不能让类初始化失败。
     * 这里用受控流把「返回值」与「关闭动作」同时变成可断言对象：素材不可解码、素材可用、
     * 读取失败、关闭失败四条路径都必须关闭底层流。</p>
     *
     * <p><b>白盒直调：</b>{@code loadDefaultImage} 是私有静态方法，用例沿用类内反射助手，
     * 只把流的来源换成受控流，字节内容、路径与日志分类都不变。</p>
     *
     * @throws Exception 反射调用或探针读取失败时抛出
     */
    @Test
    void loadDefaultImageClosesEveryNonNullResourceStream() throws Exception {
        Function<String, InputStream> previous = AdminDefaultBlockPuzzleCaptchaServiceImpl.defaultImageResourceOpener;
        try {
            byte[] notImage = readProbe("captcha-probe-not-an-image.png");
            ControlledInputStream invalidImage = new ControlledInputStream(notImage, false, false);
            AdminDefaultBlockPuzzleCaptchaServiceImpl.defaultImageResourceOpener = path -> invalidImage;
            assertThat(loadDefaultImage("captcha-probe-not-an-image.png"))
                    .as("非空流但素材不可解码时必须返回 null").isNull();
            assertThat(invalidImage.isClosed()).as("素材不可解码的提前返回路径必须关闭流").isTrue();

            byte[] realImage = readProbe("defaultImages/jigsaw/original/1.png");
            ControlledInputStream usable = new ControlledInputStream(realImage, false, false);
            AdminDefaultBlockPuzzleCaptchaServiceImpl.defaultImageResourceOpener = path -> usable;
            assertThat((String) loadDefaultImage("defaultImages/jigsaw/original/1.png"))
                    .as("可用素材必须返回与原始字节一致的 Base64")
                    .isEqualTo(Base64.getEncoder().encodeToString(realImage));
            assertThat(usable.isClosed()).as("正常返回路径必须关闭流").isTrue();

            ControlledInputStream readFailure = new ControlledInputStream(realImage, true, false);
            AdminDefaultBlockPuzzleCaptchaServiceImpl.defaultImageResourceOpener = path -> readFailure;
            assertThat(loadDefaultImage("defaultImages/jigsaw/original/1.png"))
                    .as("读取抛受检 IOException 时必须降级为 null").isNull();
            assertThat(readFailure.isClosed()).as("读取失败的返回路径同样必须关闭流").isTrue();

            ControlledInputStream closeFailure = new ControlledInputStream(realImage, false, true);
            AdminDefaultBlockPuzzleCaptchaServiceImpl.defaultImageResourceOpener = path -> closeFailure;
            assertThat(loadDefaultImage("defaultImages/jigsaw/original/1.png"))
                    .as("关闭本身抛受检 IOException 时也必须降级为 null").isNull();
            assertThat(closeFailure.isClosed()).as("关闭动作必须真的执行过").isTrue();
        } finally {
            AdminDefaultBlockPuzzleCaptchaServiceImpl.defaultImageResourceOpener = previous;
        }

        assertThat((String) loadDefaultImage("defaultImages/jigsaw/original/1.png"))
                .as("恢复默认接缝后，真实依赖素材必须仍可加载").isNotBlank();
    }

    /**
     * 受控默认素材流：记录加载器是否关闭过它，并可让读取或关闭阶段抛出受检 IOException。
     *
     * <p>它只替换流的来源，不改变字节内容，用来把「依赖包素材损坏」的两种真实形态
     * （读取中断、关闭失败）变成可断言结果。字节仍由内置的 {@link ByteArrayInputStream} 提供，
     * 因此正常路径的读取结果与真实素材逐字节一致。</p>
     */
    private static final class ControlledInputStream extends java.io.FilterInputStream {

        /** 加载器是否调用过 {@link #close()}。 */
        private boolean closed;
        /** 读取阶段是否抛出受检 IOException。 */
        private final boolean failOnRead;
        /** 关闭阶段是否抛出受检 IOException。 */
        private final boolean failOnClose;

        /**
         * 以指定字节构造受控流。
         *
         * @param bytes 流的字节内容，与真实素材一致
         * @param failOnRead 读取阶段是否抛出受检 IOException
         * @param failOnClose 关闭阶段是否抛出受检 IOException
         */
        ControlledInputStream(byte[] bytes, boolean failOnRead, boolean failOnClose) {
            super(new ByteArrayInputStream(bytes));
            this.failOnRead = failOnRead;
            this.failOnClose = failOnClose;
        }

        /**
         * 加载器是否关闭过该流。
         *
         * @return 已执行关闭动作时返回 true
         */
        boolean isClosed() {
            return closed;
        }

        /** 记录关闭动作；开关打开时抛出受检异常，模拟关闭失败。 */
        @Override
        public void close() throws IOException {
            closed = true;
            if (failOnClose) {
                throw new IOException("受控关闭失败");
            }
            super.close();
        }

        /** 返回全部字节；开关打开时抛出受检异常，模拟素材读取中断。 */
        @Override
        public byte[] readAllBytes() throws IOException {
            if (failOnRead) {
                throw new IOException("受控读取失败");
            }
            return super.readAllBytes();
        }
    }

    /**
     * 默认素材全部不可用时类初始化必须仍然成立，并由公开入口给出“底图缺失”业务码。
     *
     * <p>静态素材列表在类初始化时按编号 1..6 加载；只要加载器把不可用素材过滤掉而不是抛错，
     * 即使图库整体损坏，类也能完成初始化。这里通过“缺失编号的路径模板”验证过滤行为本身，
     * 并用真实公开入口确认可用素材时仍能出图，避免把类初始化失败的场景误当成可观测结果。</p>
     *
     * <p><b>白盒直调：</b>{@code loadDefaultImages} 是私有静态方法，生产调用点只传依赖包内置
     * 路径模板；传一条确定不存在的模板即可断言“不可用素材被过滤掉、返回空列表”这一契约。</p>
     *
     * @throws Exception 反射查找或调用失败时抛出
     */
    @Test
    void loadDefaultImagesFiltersUnavailableEntriesInsteadOfFailingClassInitialization() throws Exception {
        Method method = AdminDefaultBlockPuzzleCaptchaServiceImpl.class
                .getDeclaredMethod("loadDefaultImages", String.class);
        method.setAccessible(true);

        assertThat((List<?>) method.invoke(null, "captcha/missing-%s.png"))
                .as("全部素材不可用时必须返回空列表而不是抛错").isEmpty();

        assertThat(captchaService.get(new CaptchaVO()).isSuccess())
                .as("正对照：真实图库可用时公开入口必须仍然能出图").isTrue();
    }

    /**
     * 读取类路径探针资源的全部字节。
     *
     * @param path 类路径资源路径
     * @return 资源字节内容
     * @throws Exception 资源不存在或读取失败时抛出
     */
    private static byte[] readProbe(String path) throws Exception {
        try (java.io.InputStream inputStream =
                     AdminDefaultBlockPuzzleCaptchaServiceImplTest.class.getClassLoader().getResourceAsStream(path)) {
            assertThat(inputStream).as("探针资源必须存在：" + path).isNotNull();
            return inputStream.readAllBytes();
        }
    }

    /**
     * 候选素材为空或空白时必须返回 null，可解码素材必须返回真实图片。
     *
     * <p>随机取图只有在候选列表非空时才会走到解码；空候选与空白候选都必须由解码前的空值判定
     * 直接返回 null，否则后续裁剪会拿着 null 图继续执行并以空指针失败。这里用真实私有方法配
     * 边界输入断言，正对照使用真实依赖图库素材，证明 null 来自输入判定而不是解码失败。</p>
     *
     * @throws Exception 反射查找、调用或图片解码失败时抛出
     */
    @Test
    void randomImageReturnsNullForBlankInputAndImageForDecodableBase64() throws Exception {
        Method method = AdminDefaultBlockPuzzleCaptchaServiceImpl.class.getDeclaredMethod("randomImage", List.class);
        method.setAccessible(true);

        assertThat(method.invoke(null, List.of())).as("空候选必须返回 null").isNull();
        assertThat(method.invoke(null, List.of("   "))).as("空白候选必须返回 null").isNull();

        Object realImageBase64 = loadDefaultImage("defaultImages/jigsaw/original/1.png");
        assertThat(realImageBase64).as("正对照素材必须可加载").isNotNull();
        Object image = method.invoke(null, List.of(realImageBase64));
        assertThat(image).as("可解码素材必须返回真实图片").isInstanceOf(BufferedImage.class);
        assertThat(((BufferedImage) image).getWidth()).isPositive();
    }

}
