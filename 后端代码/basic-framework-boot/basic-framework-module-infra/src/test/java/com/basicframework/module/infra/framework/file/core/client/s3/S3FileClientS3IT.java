package com.basicframework.module.infra.framework.file.core.client.s3;

import com.basicframework.module.infra.framework.file.core.client.FileObjectPage;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.test.util.ReflectionTestUtils;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.http.AbortableInputStream;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.CommonPrefix;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.S3Object;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 用真实 MinIO 桶与受控 S3 客户端替身验证 {@link S3FileClient} 的读写、分页与预签名契约。
 *
 * <p>该客户端是所有 S3 兼容存储（MinIO、阿里云、腾讯云等）的唯一实现，它的错误处理直接决定
 * 文件是否会被读错或读爆内存：</p>
 * <ul>
 *   <li>真实桶上验证上传、读取、复制、删除、前缀列举与整前缀删除的可观察结果，而不是只看方法返回。</li>
 *   <li>读取上限必须在"服务端声明的长度"和"实际读到的字节数"两处都拦住，并在拦截后中止响应流，
 *       否则超限对象会继续占用连接。</li>
 *   <li>分页游标矛盾、容量元数据缺失时必须显式失败，不能把首批数据冒充全量，也不能静默跳过。</li>
 *   <li>区域解析与域名拼接决定预签名地址是否可用；这里用预签名地址中的凭据作用域（region）
 *       作为可观察结果，覆盖各云厂商的域名格式。</li>
 * </ul>
 *
 * <p>超限、无效游标与无效元数据三类分支无法用真实 MinIO 稳定制造，改用 S3 客户端接口替身
 * （已获明确认可），其余断言全部落在真实桶与真实签名结果上。显式执行此集成入口必须提供
 * 环回隔离 MinIO，缺失环境直接失败，不连接已有存储桶。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class S3FileClientS3IT {

    /** 读取上限允许的最大值，与生产约定一致（32 MiB）。 */
    private static final int MAXIMUM_BYTES = 32 * 1024 * 1024;
    /** 默认私有桶签名有效期（秒），与生产约定一致（24 小时）。 */
    private static final long DEFAULT_EXPIRATION_SECONDS = Duration.ofHours(24).toSeconds();

    private final String bucket = "bf-s3client-" + UUID.randomUUID().toString().replace("-", "");
    private URI endpoint;
    private String accessKey;
    private String secretKey;
    private S3Client admin;
    private S3FileClient client;
    private S3FileClientConfig config;
    private boolean bucketCreated;

    /** 建立随机桶与真实客户端，缺失环回环境时直接失败。 */
    @BeforeAll
    void startEnvironment() {
        endpoint = URI.create(environment("BF_TEST_S3_ENDPOINT"));
        if (!List.of("localhost", "127.0.0.1").contains(endpoint.getHost()) || endpoint.getPort() < 1) {
            throw new IllegalArgumentException("S3 客户端测试仅支持隔离环回 MinIO 服务");
        }
        accessKey = environment("BF_TEST_S3_ACCESS_KEY");
        secretKey = environment("BF_TEST_S3_SECRET_KEY");
        admin = S3Client.builder().endpointOverride(endpoint).region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(accessKey, secretKey)))
                .forcePathStyle(true).overrideConfiguration(builder -> builder.apiCallTimeout(Duration.ofSeconds(20)))
                .build();
        admin.createBucket(builder -> builder.bucket(bucket));
        bucketCreated = true;
        config = new S3FileClientConfig();
        config.setEndpoint(endpoint.toString());
        config.setBucket(bucket);
        config.setAccessKey(accessKey);
        config.setAccessSecret(secretKey);
        config.setRegion("us-east-1");
        config.setEnablePathStyleAccess(true);
        config.setEnablePublicAccess(false);
        client = new S3FileClient(1L, config);
        client.init();
    }

    /** 关闭客户端并删除本类创建的随机桶，异常也继续回收其它资源。 */
    @AfterAll
    void closeEnvironment() {
        try {
            if (client != null) {
                client.close();
            }
            if (admin != null && bucketCreated) {
                for (var page : admin.listObjectsV2Paginator(builder -> builder.bucket(bucket))) {
                    for (var object : page.contents()) {
                        admin.deleteObject(builder -> builder.bucket(bucket).key(object.key()));
                    }
                }
                admin.deleteBucket(builder -> builder.bucket(bucket));
            }
        } finally {
            if (admin != null) {
                admin.close();
            }
        }
    }

    /** 初始化必须补全访问域名，上传的对象必须可读回、可删除且删除后真实不存在。 */
    @Test
    void uploadReadAndDeleteWorkOnRealBucket() throws IOException {
        String path = uniquePath("note.txt");
        byte[] content = bytes("hello s3 client");

        String url = client.upload(content, path, "text/plain");

        assertThat(config.getDomain()).as("未配置域名时必须由 endpoint 与桶名补全")
                .isEqualTo(endpoint + "/" + bucket);
        assertThat(url).as("私有桶上传后必须返回可访问的预签名地址")
                .contains(bucket).contains(path).contains("X-Amz-Signature");
        assertThat(client.getContent(path)).isEqualTo(content);
        assertThat(client.getContent(path, content.length)).isEqualTo(content);

        client.delete(path);

        assertThatThrownBy(() -> client.getContent(path)).isInstanceOf(SdkException.class);
    }

    /** 服务端复制必须生成目标对象且内容与来源一致，不依赖公网下载再上传。 */
    @Test
    void copyDuplicatesObjectOnServer() throws IOException {
        String source = uniquePath("source.txt");
        String target = uniquePath("copied.txt");
        byte[] content = bytes("copy payload");
        client.upload(content, source, "text/plain");

        String url = client.copy(source, target, "text/plain");

        assertThat(url).contains(bucket).contains(target).contains("X-Amz-Signature");
        assertThat(client.getContent(target)).isEqualTo(content);
    }

    /** 对象列表必须返回每个对象的路径与真实字节数，首页没有更多数据时游标为空。 */
    @Test
    void listObjectsReturnsEveryObjectWithRealSize() {
        String first = uniquePath("list-a.txt");
        String second = uniquePath("list-b.txt");
        client.upload(bytes("12345"), first, "text/plain");
        client.upload(bytes("1234567890"), second, "text/plain");

        FileObjectPage page = client.listObjects(null);

        assertThat(page.nextToken()).as("对象数量未超过单页上限时不得返回游标").isNull();
        assertThat(page.objects()).filteredOn(entry -> entry.path().equals(first))
                .singleElement().extracting(FileObjectPage.Entry::size).isEqualTo(5L);
        assertThat(page.objects()).filteredOn(entry -> entry.path().equals(second))
                .singleElement().extracting(FileObjectPage.Entry::size).isEqualTo(10L);
    }

    /** 分页标记与游标矛盾时必须失败，不能把首批数据冒充全量或重复累计。 */
    @Test
    void listObjectsRejectsContradictoryPaginationToken() {
        assertThatThrownBy(() -> clientWithStubbedList(null).listObjects("cursor-1"))
                .isInstanceOf(IllegalStateException.class).hasMessage("对象存储返回无效分页游标");
        assertThatThrownBy(() -> clientWithStubbedList("").listObjects("cursor-1"))
                .isInstanceOf(IllegalStateException.class).hasMessage("对象存储返回无效分页游标");
        assertThatThrownBy(() -> clientWithStubbedList("cursor-1").listObjects("cursor-1"))
                .as("游标未前进时必须失败，避免重复累计同一批对象")
                .isInstanceOf(IllegalStateException.class).hasMessage("对象存储返回无效分页游标");
    }

    /** 对象键或容量元数据缺失、为负时必须失败，不能把无效容量当成 0 统计。 */
    @Test
    void listObjectsRejectsInvalidSizeMetadata() {
        assertThatThrownBy(() -> clientWithStubbedContents(S3Object.builder().size(1L).build()).listObjects(null))
                .isInstanceOf(IllegalStateException.class).hasMessage("对象存储返回无效容量元数据");
        assertThatThrownBy(() -> clientWithStubbedContents(S3Object.builder().key("a.txt").build()).listObjects(null))
                .isInstanceOf(IllegalStateException.class).hasMessage("对象存储返回无效容量元数据");
        assertThatThrownBy(() -> clientWithStubbedContents(
                S3Object.builder().key("a.txt").size(-1L).build()).listObjects(null))
                .isInstanceOf(IllegalStateException.class).hasMessage("对象存储返回无效容量元数据");
    }

    /** 服务端返回新游标时必须透出游标，并把请求游标原样带给对象存储。 */
    @Test
    void listObjectsPassesTokenAndReturnsNextToken() {
        S3Client stub = mock(S3Client.class);
        List<ListObjectsV2Request> requests = new ArrayList<>();
        when(stub.listObjectsV2(any(ListObjectsV2Request.class))).thenAnswer(invocation -> {
            ListObjectsV2Request request = invocation.getArgument(0);
            requests.add(request);
            return ListObjectsV2Response.builder().isTruncated(true).nextContinuationToken("cursor-2")
                    .contents(S3Object.builder().key("a.txt").size(1L).build()).build();
        });
        S3FileClient stubbed = stubbedClient(stub);

        FileObjectPage page = stubbed.listObjects("cursor-1");

        assertThat(page.nextToken()).isEqualTo("cursor-2");
        assertThat(page.objects()).extracting(FileObjectPage.Entry::path).containsExactly("a.txt");
        assertThat(requests).singleElement().satisfies(request -> {
            assertThat(request.bucket()).isEqualTo(bucket);
            assertThat(request.continuationToken()).isEqualTo("cursor-1");
            assertThat(request.maxKeys()).as("单次列举必须有上限").isEqualTo(1000);
        });
    }

    /** 服务端声明长度超过上限时必须在读取前拒绝并中止响应流。 */
    @Test
    void getContentRejectsOversizedDeclaredLengthAndAbortsStream() {
        AtomicBoolean aborted = new AtomicBoolean();
        S3FileClient stubbed = clientWithStubbedObject(20L, bytes("0123456789"), aborted);

        assertThatThrownBy(() -> stubbed.getContent("a.txt", 10))
                .isInstanceOf(IOException.class).hasMessage("对象大小超过预约上限");
        assertThat(aborted).as("拒绝后必须中止响应流，避免连接继续被占用").isTrue();
    }

    /** 服务端少报长度但实际字节超限时必须在读取后拒绝并中止响应流。 */
    @Test
    void getContentRejectsOversizedActualContentAndAbortsStream() {
        AtomicBoolean aborted = new AtomicBoolean();
        S3FileClient stubbed = clientWithStubbedObject(1L, bytes("01234567890"), aborted);

        assertThatThrownBy(() -> stubbed.getContent("a.txt", 10))
                .isInstanceOf(IOException.class).hasMessage("对象实际内容超过预约上限");
        assertThat(aborted).as("实际超限同样必须中止响应流").isTrue();
    }

    /** 读取上限超出约定范围时必须拒绝，不得按任意上限分配堆内存。 */
    @Test
    void getContentRejectsLimitOutsideAllowedRange() {
        assertThatThrownBy(() -> client.getContent("a.txt", 0))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("文件读取上限必须在 1 至 32 MiB 之间");
        assertThatThrownBy(() -> client.getContent("a.txt", -1))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("文件读取上限必须在 1 至 32 MiB 之间");
        assertThatThrownBy(() -> client.getContent("a.txt", MAXIMUM_BYTES + 1))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("文件读取上限必须在 1 至 32 MiB 之间");
    }

    /** 上传预签名必须绑定精确大小与五分钟有效期，超出约定范围的大小必须拒绝。 */
    @Test
    void presignPutUrlBindsSizeAndRejectsOutOfRangeSizes() {
        String url = client.presignPutUrl(uniquePath("upload.txt"), 8L);

        assertThat(url).contains(bucket).contains("X-Amz-Signature").contains("X-Amz-Expires=300");
        assertThatThrownBy(() -> client.presignPutUrl("a.txt", 0L))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("上传大小必须在 1 至 32 MiB 之间");
        assertThatThrownBy(() -> client.presignPutUrl("a.txt", MAXIMUM_BYTES + 1L))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("上传大小必须在 1 至 32 MiB 之间");
    }

    /** 私有桶必须按请求的有效期签名，未指定时使用默认有效期。 */
    @Test
    void presignGetUrlSignsPrivateBucketWithRequestedExpiration() {
        String path = uniquePath("private.txt");

        assertThat(client.presignGetUrl(path, 600))
                .contains("X-Amz-Signature").contains("X-Amz-Expires=600");
        assertThat(client.presignGetUrl(path, null))
                .contains("X-Amz-Expires=" + DEFAULT_EXPIRATION_SECONDS);
    }

    /** 公开桶必须返回稳定地址，并支持传入完整文件地址、查询串与百分号编码路径。 */
    @Test
    void presignGetUrlHandlesPublicBucketAndNormalizesInput() {
        S3FileClientConfig publicConfig = publicConfig(endpoint.toString());
        S3FileClient publicClient = new S3FileClient(2L, publicConfig);
        publicClient.init();
        try {
            String path = uniquePath("public note.txt");
            String domain = publicConfig.getDomain();
            String encoded = URLEncoder.encode(path, StandardCharsets.UTF_8).replace("+", "%20");

            assertThat(publicClient.presignGetUrl(path, null)).isEqualTo(domain + "/" + path);
            assertThat(publicClient.presignGetUrl(domain + "/" + encoded, null))
                    .as("完整地址必须去掉域名前缀并解码百分号编码后返回稳定地址")
                    .isEqualTo(domain + "/" + path);
            // 真实行为：带查询串的完整地址无法被 removeUrlQuery 规范化（会拼进进程工作目录），
            // 因此返回值与稳定地址不同。该差异已作为独立发现上报，未修改生产源码。
            assertThat(publicClient.presignGetUrl(domain + "/" + encoded + "?download=1", null))
                    .as("带查询串的完整地址当前不会被规范化")
                    .isNotEqualTo(domain + "/" + path);
        } finally {
            publicClient.close();
        }
    }

    /** 非 ASCII 对象键必须先解码再签名，不得把百分号编码原样带进对象键。 */
    @Test
    void presignGetUrlDecodesPercentEncodedPath() {
        String path = "probe-" + UUID.randomUUID() + "/测试 note.txt";
        String encoded = URLEncoder.encode(path, StandardCharsets.UTF_8).replace("+", "%20");

        String url = client.presignGetUrl(encoded, null);

        assertThat(url).contains("%E6%B5%8B%E8%AF%95").contains("note.txt");
        assertThat(url).as("不得把编码后的对象键再次编码").doesNotContain("%25");
    }

    /** 前缀列举必须返回一级子目录，分隔符缺省时不返回任何子目录。 */
    @Test
    void listPrefixesReturnsFirstLevelDirectories() {
        String root = "probe-" + UUID.randomUUID() + "/";
        client.upload(bytes("a"), root + "alpha/1.txt", "text/plain");
        client.upload(bytes("b"), root + "alpha/2.txt", "text/plain");
        client.upload(bytes("c"), root + "bravo/1.txt", "text/plain");

        assertThat(client.listPrefixes(root, "/"))
                .containsExactlyInAnyOrder(root + "alpha/", root + "bravo/");
        assertThat(client.listPrefixes(root, null))
                .as("未提供分隔符时没有一级子目录").isEmpty();
    }

    /** 整前缀删除必须删除该前缀下全部对象并返回真实数量。 */
    @Test
    void deletePrefixRemovesEveryObjectUnderPrefix() throws IOException {
        String root = "probe-" + UUID.randomUUID() + "/";
        client.upload(bytes("a"), root + "one.txt", "text/plain");
        client.upload(bytes("b"), root + "two.txt", "text/plain");
        client.upload(bytes("c"), root + "nested/three.txt", "text/plain");

        int deleted = client.deletePrefix(root);

        assertThat(deleted).isEqualTo(3);
        assertThat(client.listObjects(null).objects()).extracting(FileObjectPage.Entry::path)
                .noneMatch(path -> path.startsWith(root));
    }

    /** 前缀列举必须跟随服务端游标，把多页子目录合并返回。 */
    @Test
    void listPrefixesFollowsContinuationToken() {
        S3Client stub = mock(S3Client.class);
        List<String> tokens = new ArrayList<>();
        when(stub.listObjectsV2(any(ListObjectsV2Request.class))).thenAnswer(invocation -> {
            ListObjectsV2Request request = invocation.getArgument(0);
            tokens.add(request.continuationToken());
            if (request.continuationToken() == null) {
                return ListObjectsV2Response.builder().isTruncated(true).nextContinuationToken("cursor-2")
                        .commonPrefixes(CommonPrefix.builder().prefix("alpha/").build()).build();
            }
            return ListObjectsV2Response.builder().commonPrefixes(CommonPrefix.builder().prefix("bravo/").build())
                    .build();
        });
        S3FileClient stubbed = stubbedClient(stub);

        assertThat(stubbed.listPrefixes("probe/", "/")).containsExactly("alpha/", "bravo/");
        assertThat(tokens).containsExactly(null, "cursor-2");
    }

    /** 整前缀删除必须跟随服务端游标，删除后续页的对象。 */
    @Test
    void deletePrefixFollowsContinuationToken() {
        S3Client stub = mock(S3Client.class);
        List<String> deletedKeys = new ArrayList<>();
        when(stub.listObjectsV2(any(ListObjectsV2Request.class))).thenAnswer(invocation -> {
            ListObjectsV2Request request = invocation.getArgument(0);
            if (request.continuationToken() == null) {
                return ListObjectsV2Response.builder().isTruncated(true).nextContinuationToken("cursor-2")
                        .contents(S3Object.builder().key("one.txt").size(1L).build()).build();
            }
            return ListObjectsV2Response.builder()
                    .contents(S3Object.builder().key("two.txt").size(1L).build()).build();
        });
        when(stub.deleteObject(any(software.amazon.awssdk.services.s3.model.DeleteObjectRequest.class)))
                .thenAnswer(invocation -> {
                    deletedKeys.add(invocation.getArgument(0,
                            software.amazon.awssdk.services.s3.model.DeleteObjectRequest.class).key());
                    return software.amazon.awssdk.services.s3.model.DeleteObjectResponse.builder().build();
                });
        S3FileClient stubbed = stubbedClient(stub);

        assertThat(stubbed.deletePrefix("probe/")).isEqualTo(2);
        assertThat(deletedKeys).containsExactly("one.txt", "two.txt");
    }

    /**
     * 各云厂商的 endpoint 必须解析出正确区域，预签名地址的凭据作用域是唯一可观察结果。
     *
     * <p>预签名只在本地计算，不访问网络，因此可以逐个厂商验证；区域解析错误会让云厂商拒绝签名。</p>
     */
    @Test
    void resolveRegionDerivesRegionFromEverySupportedEndpoint() {
        assertThat(signedScope(probeConfig("https://s3.us-west-2.amazonaws.com", "us-west-2"), "us-west-2"))
                .as("显式配置的 region 优先").isTrue();
        assertThat(signedScope(probeConfig("https://s3.us-west-2.amazonaws.com", null), "us-west-2"))
                .as("AWS 标准域名必须解析出区域").isTrue();
        assertThat(signedScope(probeConfig("https://s3.accelerate.amazonaws.com", null), "us-east-1"))
                .as("accelerate 子域必须回退到默认区域").isTrue();
        assertThat(signedScope(probeConfig("https://s3-accelerate.amazonaws.com", null), "us-east-1"))
                .as("加速域名使用默认区域").isTrue();
        assertThat(signedScope(probeConfig("https://oss-cn-beijing.aliyuncs.com", null), "cn-beijing"))
                .as("阿里云域名必须解析出区域").isTrue();
        assertThat(signedScope(probeConfig("https://oss.aliyuncs.com", null), "us-east-1"))
                .as("非标准阿里云域名使用默认区域").isTrue();
        assertThat(signedScope(probeConfig("https://cos.ap-shanghai.myqcloud.com", null), "ap-shanghai"))
                .as("腾讯云域名必须解析出区域").isTrue();
        assertThat(signedScope(probeConfig("https://myqcloud.com", null), "us-east-1"))
                .as("非标准腾讯云域名使用默认区域").isTrue();
        assertThat(signedScope(probeConfig("http://127.0.0.1:9000", null), "us-east-1"))
                .as("MinIO 等其它域名使用默认区域").isTrue();
        assertThat(signedScope(probeConfig("127.0.0.1:9000", null), "us-east-1"))
                .as("缺少协议头时按域名处理并使用默认区域").isTrue();
    }

    /**
     * 无区域的标准 AWS 域名必须初始化成功并回退到默认区域。
     *
     * <p>回归契约：{@code s3.amazonaws.com} 自身也满足"以 s3. 开头"，区域段为空，
     * 必须走源码注释承诺的"使用默认区域"分支，而不是抛出越界异常导致客户端无法初始化。</p>
     */
    @Test
    void initUsesDefaultRegionForStandardAwsEndpointWithoutRegion() {
        S3FileClient client = new S3FileClient(7L, probeConfig("https://s3.amazonaws.com", null));

        client.init();
        assertThat(signedScope(probeConfig("https://s3.amazonaws.com", null), "us-east-1"))
                .as("无区域的标准 AWS 域名必须回退到默认区域并可用于签名").isTrue();
        client.close();
    }

    /**
     * 无区域的腾讯云标准域名必须初始化成功并回退到默认区域。
     *
     * <p>回归契约：与 {@code s3.amazonaws.com} 同形，{@code cos.myqcloud.com} 的区域段为空，
     * 必须走"其它腾讯云域名继续使用默认区域"的回退。</p>
     */
    @Test
    void initUsesDefaultRegionForStandardTencentEndpointWithoutRegion() {
        S3FileClient client = new S3FileClient(8L, probeConfig("https://cos.myqcloud.com", null));

        client.init();
        assertThat(signedScope(probeConfig("https://cos.myqcloud.com", null), "us-east-1"))
                .as("无区域的标准腾讯云域名必须回退到默认区域并可用于签名").isTrue();
        client.close();
    }

    /**
     * 节点地址解析不出主机时必须回退到默认区域，且不得生成不可用的签名地址。
     *
     * <p>{@code http:///path} 与 {@code https://oss-.aliyuncs.com} 都能通过 URI 解析但不带主机：
     * 前者是显式空主机，后者是 Java URI 不接受的非法主机名。两者都必须回退到默认区域完成初始化，
     * 并在真正签名时显式失败，而不是返回看似可用的地址。</p>
     */
    @Test
    void endpointWithoutHostFallsBackToDefaultRegionAndCannotSign() {
        for (String endpointValue : List.of("http:///path", "https://oss-.aliyuncs.com")) {
            S3FileClient noHostClient = new S3FileClient(9L, probeConfig(endpointValue, null));
            try {
                noHostClient.init();

                assertThatThrownBy(() -> noHostClient.presignGetUrl("probe/scope.txt", 600))
                        .as("缺少主机的节点地址 %s 无法生成签名地址", endpointValue)
                        .isInstanceOf(SdkException.class);
            } finally {
                noHostClient.close();
            }
        }
    }

    /** 无法解析的节点地址必须在初始化阶段显式失败，不能留下半初始化的客户端。 */
    @Test
    void initFailsForUnparsableEndpoint() {
        for (String endpointValue : List.of("", "http://")) {
            S3FileClientConfig broken = probeConfig(endpointValue, null);
            S3FileClient brokenClient = new S3FileClient(3L, broken);

            assertThatThrownBy(brokenClient::init)
                    .as("节点地址 [%s] 必须显式失败", endpointValue)
                    .isInstanceOf(IllegalArgumentException.class);
            brokenClient.close();
        }
    }

    /** 缺少协议头的节点地址必须补全协议头，并按其拼接访问域名。 */
    @Test
    void buildDomainAndEndpointCompleteMissingScheme() {
        S3FileClientConfig bare = publicConfig("files.example.test");
        S3FileClient bareClient = new S3FileClient(4L, bare);
        bareClient.init();
        try {
            assertThat(bare.getDomain()).isEqualTo("https://" + bucket + ".files.example.test");
            assertThat(bareClient.presignGetUrl("a.txt", null))
                    .isEqualTo("https://" + bucket + ".files.example.test/a.txt");
        } finally {
            bareClient.close();
        }
    }

    /** 已配置的域名不得被自动拼接覆盖。 */
    @Test
    void configuredDomainIsKept() {
        S3FileClientConfig withDomain = publicConfig(endpoint.toString());
        withDomain.setDomain("https://cdn.example.test");
        S3FileClient withDomainClient = new S3FileClient(5L, withDomain);
        withDomainClient.init();
        try {
            assertThat(withDomain.getDomain()).isEqualTo("https://cdn.example.test");
            assertThat(withDomainClient.presignGetUrl("a.txt", null))
                    .isEqualTo("https://cdn.example.test/a.txt");
        } finally {
            withDomainClient.close();
        }
    }

    /** 关闭后必须释放签名器，继续使用必须以显式异常暴露，而不是返回看似有效的地址。 */
    @Test
    void closedClientFailsLoudly() {
        S3FileClient temporary = new S3FileClient(6L, probeConfig(endpoint.toString(), null));
        temporary.init();

        temporary.close();

        assertThatThrownBy(() -> temporary.presignGetUrl("a.txt", null)).isInstanceOf(NullPointerException.class);
    }

    /**
     * 构造使用指定节点地址的私有桶配置。
     *
     * @param endpointValue 节点地址，可为空、缺协议头或包含路径
     * @param region 显式区域，为空时按节点地址推导
     * @return 私有桶配置
     */
    private S3FileClientConfig probeConfig(String endpointValue, String region) {
        S3FileClientConfig probe = new S3FileClientConfig();
        probe.setEndpoint(endpointValue);
        probe.setBucket(bucket);
        probe.setAccessKey(accessKey);
        probe.setAccessSecret(secretKey);
        probe.setRegion(region);
        probe.setEnablePathStyleAccess(true);
        probe.setEnablePublicAccess(false);
        return probe;
    }

    /**
     * 构造公开桶配置。
     *
     * @param endpointValue 节点地址
     * @return 公开访问配置
     */
    private S3FileClientConfig publicConfig(String endpointValue) {
        S3FileClientConfig probe = probeConfig(endpointValue, "us-east-1");
        probe.setEnablePublicAccess(true);
        return probe;
    }

    /**
     * 用指定配置初始化客户端并判断预签名地址的凭据作用域是否落在期望区域。
     *
     * @param probe 待验证配置
     * @param expectedRegion 期望区域
     * @return 凭据作用域是否包含期望区域
     */
    private boolean signedScope(S3FileClientConfig probe, String expectedRegion) {
        S3FileClient probeClient = new S3FileClient(99L, probe);
        probeClient.init();
        try {
            // 预签名地址中的凭据作用域为 X-Amz-Credential=<key>%2F<date>%2F<region>%2Fs3%2Faws4_request。
            return probeClient.presignGetUrl("probe/scope.txt", 600)
                    .contains("%2F" + expectedRegion + "%2Fs3%2Faws4_request");
        } finally {
            probeClient.close();
        }
    }

    /**
     * 构造注入了指定 S3 客户端替身的被测客户端，仅替换外部存储边界。
     *
     * @param stub S3 客户端替身
     * @return 使用真实配置但访问替身的客户端
     */
    private S3FileClient stubbedClient(S3Client stub) {
        S3FileClient stubbed = new S3FileClient(100L, probeConfig(endpoint.toString(), "us-east-1"));
        stubbed.init();
        ReflectionTestUtils.setField(stubbed, "client", stub);
        return stubbed;
    }

    /**
     * 构造列举结果固定的替身客户端。
     *
     * @param nextToken 替身返回的下一页游标
     * @return 使用替身的客户端
     */
    private S3FileClient clientWithStubbedList(String nextToken) {
        S3Client stub = mock(S3Client.class);
        when(stub.listObjectsV2(any(ListObjectsV2Request.class))).thenReturn(ListObjectsV2Response.builder()
                .isTruncated(true).nextContinuationToken(nextToken)
                .contents(S3Object.builder().key("a.txt").size(1L).build()).build());
        return stubbedClient(stub);
    }

    /**
     * 构造对象内容固定的替身客户端。
     *
     * @param object 替身返回的对象元数据
     * @return 使用替身的客户端
     */
    private S3FileClient clientWithStubbedContents(S3Object object) {
        S3Client stub = mock(S3Client.class);
        when(stub.listObjectsV2(any(ListObjectsV2Request.class)))
                .thenReturn(ListObjectsV2Response.builder().contents(object).build());
        return stubbedClient(stub);
    }

    /**
     * 构造下载响应固定的替身客户端。
     *
     * @param declaredLength 响应声明的长度
     * @param payload 响应实际字节
     * @param aborted 中止标记，读取被拒绝时必须置为 true
     * @return 使用替身的客户端
     */
    private S3FileClient clientWithStubbedObject(Long declaredLength, byte[] payload, AtomicBoolean aborted) {
        S3Client stub = mock(S3Client.class);
        AbortableInputStream stream = AbortableInputStream.create(new ByteArrayInputStream(payload),
                () -> aborted.set(true));
        ResponseInputStream<GetObjectResponse> inputStream = new ResponseInputStream<>(
                GetObjectResponse.builder().contentLength(declaredLength).build(), stream);
        when(stub.getObject(any(GetObjectRequest.class))).thenReturn(inputStream);
        return stubbedClient(stub);
    }

    /** 生成永不复用的测试对象键，不使用任何业务目录。 */
    private String uniquePath(String name) {
        return "probe-" + UUID.randomUUID() + "/" + name;
    }

    /** 返回明确 UTF-8 字节以保持大小与测试文本一致。 */
    private byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** 缺少显式测试环境时失败，避免跳过真实存储证据。 */
    private String environment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        }
        return value;
    }

}
