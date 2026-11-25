package com.basicframework.server.contract;

import cn.hutool.core.util.StrUtil;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.DefaultParameterNameDiscoverer;
import org.springframework.core.ParameterNameDiscoverer;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.lang.reflect.WildcardType;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 前后端 OpenAPI 3.0.3 单一事实源契约快照生成与防漂移门禁。
 *
 * <p>直接基于控制器路由注解、Swagger 元数据与项目 Jackson 序列化约定（{@code LocalDateTime -> epoch-ms number}）
 * 生成确定性 {@code openapi.json}，不依赖数据库或外部中间件即可在 300ms 内完成核验。
 * 当后端接口路径、参数或 VO 字段变更而未同步执行 {@code -Dopenapi.update=true} 与 {@code pnpm api:gen} 时，测试立即失败。</p>
 *
 * @author shady
 */
class OpenApiContractSnapshotTest {

    private static final ParameterNameDiscoverer PARAM_DISCOVERER = new DefaultParameterNameDiscoverer();

    /** 校验已提交的前端契约快照与当前后端控制器及 VO 模型零漂移。 */
    @Test
    void openApiContractSnapshotIsUpToDate() throws Exception {
        String expectedJson = buildDeterministicOpenApiJson();
        Path snapshotPath = resolveOpenApiSnapshotPath();
        if (Boolean.getBoolean("openapi.update") || !Files.exists(snapshotPath)) {
            if (Boolean.getBoolean("openapi.update")) {
                Files.createDirectories(snapshotPath.getParent());
                Files.writeString(snapshotPath, expectedJson, StandardCharsets.UTF_8);
            }
        }
        assertTrue(Files.isRegularFile(snapshotPath),
                "缺少 OpenAPI 契约快照文件，请在 后端代码/basic-framework-boot 执行: "
                        + "mvn -pl basic-framework-server -am test -Dtest=OpenApiContractSnapshotTest -Dsurefire.failIfNoSpecifiedTests=false -Dopenapi.update=true");
        String committedJson = Files.readString(snapshotPath, StandardCharsets.UTF_8).replace("\r\n", "\n");
        assertEquals(expectedJson, committedJson,
                "后端接口或 VO 已变更但 OpenAPI 契约快照未同步！请依次执行:\n"
                        + "1) cd 后端代码/basic-framework-boot && mvn -pl basic-framework-server -am test -Dtest=OpenApiContractSnapshotTest -Dsurefire.failIfNoSpecifiedTests=false -Dopenapi.update=true\n"
                        + "2) cd 前端代码/basic-framework-admin && pnpm api:gen");
    }

    /** 构建排序稳定、跨平台字节一致的 OpenAPI 3.0.3 JSON 文本。 */
    static String buildDeterministicOpenApiJson() throws Exception {
        Map<String, Object> schemas = new TreeMap<>();
        Map<String, Class<?>> schemaOwners = new LinkedHashMap<>();
        Map<String, Map<String, Object>> paths = new TreeMap<>();

        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        List<Class<?>> controllers = new ArrayList<>();
        for (BeanDefinition bd : scanner.findCandidateComponents("com.basicframework.module")) {
            Class<?> clazz = Class.forName(bd.getBeanClassName());
            if (!clazz.getPackageName().contains(".footgun")) {
                controllers.add(clazz);
            }
        }
        controllers.sort(Comparator.comparing(Class::getName));

        for (Class<?> controller : controllers) {
            String apiPrefix = resolveApiPrefix(controller.getPackageName());
            RequestMapping classMapping = AnnotatedElementUtils.findMergedAnnotation(controller, RequestMapping.class);
            String[] basePaths = (classMapping != null && classMapping.path().length > 0)
                    ? classMapping.path() : new String[]{""};
            Tag tag = controller.getAnnotation(Tag.class);
            String tagName = tag != null ? tag.name() : controller.getSimpleName();

            Method[] methods = controller.getDeclaredMethods();
            Arrays.sort(methods, Comparator.comparing(Method::getName).thenComparing(Method::toGenericString));
            for (Method method : methods) {
                EndpointMapping mapping = extractEndpointMapping(method);
                if (mapping == null) {
                    continue;
                }
                String[] subPaths = mapping.paths.length > 0 ? mapping.paths : new String[]{""};
                for (String basePath : basePaths) {
                    for (String subPath : subPaths) {
                        String fullPath = normalizeUrlPath(apiPrefix, basePath, subPath);
                        Map<String, Object> pathItem = paths.computeIfAbsent(fullPath, k -> new TreeMap<>());
                        for (String httpMethod : mapping.httpMethods) {
                            pathItem.put(httpMethod, buildOperationObject(controller, method, tagName, schemas, schemaOwners));
                        }
                    }
                }
            }
        }

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("openapi", "3.0.3");
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("title", "basic-framework API");
        info.put("version", "1.0.0");
        info.put("description", "Deterministic OpenAPI contract generated from Spring MVC controllers and VOs");
        root.put("info", info);
        root.put("paths", paths);
        root.put("components", Map.of("schemas", schemas));

        ObjectMapper mapper = new ObjectMapper();
        mapper.enable(SerializationFeature.INDENT_OUTPUT);
        mapper.enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);
        return mapper.writeValueAsString(root).replace("\r\n", "\n") + "\n";
    }

    /** 构建单个 Spring MVC 控制器端点对应的 OpenAPI Operation 节点。 */
    private static Map<String, Object> buildOperationObject(Class<?> controller, Method method,
                                                            String tagName, Map<String, Object> schemas,
                                                            Map<String, Class<?>> schemaOwners) {
        Map<String, Object> op = new LinkedHashMap<>();
        op.put("tags", List.of(tagName));
        op.put("operationId", controller.getSimpleName() + "_" + method.getName());
        Operation operationAnn = method.getAnnotation(Operation.class);
        if (operationAnn != null && StrUtil.isNotBlank(operationAnn.summary())) {
            op.put("summary", operationAnn.summary());
        }
        if (method.isAnnotationPresent(PermitAll.class)) {
            op.put("security", List.of());
        }

        String[] discoveredNames = PARAM_DISCOVERER.getParameterNames(method);
        Parameter[] parameters = method.getParameters();
        List<Map<String, Object>> queryOrPathParams = new ArrayList<>();
        Map<String, Object> requestBody = null;

        for (int i = 0; i < parameters.length; i++) {
            Parameter param = parameters[i];
            Class<?> rawType = param.getType();
            if (ServletRequest.class.isAssignableFrom(rawType)
                    || ServletResponse.class.isAssignableFrom(rawType)
                    || InputStream.class.isAssignableFrom(rawType)
                    || OutputStream.class.isAssignableFrom(rawType)) {
                continue;
            }
            String fallbackName = (discoveredNames != null && i < discoveredNames.length && discoveredNames[i] != null)
                    ? discoveredNames[i] : param.getName();
            if (param.isAnnotationPresent(RequestBody.class)) {
                RequestBody rb = param.getAnnotation(RequestBody.class);
                Map<String, Object> bodyObj = new LinkedHashMap<>();
                bodyObj.put("required", rb.required());
                bodyObj.put("content", Map.of(
                        "application/json", Map.of("schema", resolveTypeSchema(param.getParameterizedType(), schemas, schemaOwners))
                ));
                requestBody = bodyObj;
            } else if (param.isAnnotationPresent(PathVariable.class)) {
                PathVariable pv = param.getAnnotation(PathVariable.class);
                String name = StrUtil.blankToDefault(pv.value(), StrUtil.blankToDefault(pv.name(), fallbackName));
                Map<String, Object> pObj = new LinkedHashMap<>();
                pObj.put("name", name);
                pObj.put("in", "path");
                pObj.put("required", pv.required());
                pObj.put("schema", resolveTypeSchema(param.getParameterizedType(), schemas, schemaOwners));
                queryOrPathParams.add(pObj);
            } else if (containsMultipartFile(rawType)) {
                Map<String, Object> bodyObj = new LinkedHashMap<>();
                bodyObj.put("required", true);
                bodyObj.put("content", Map.of(
                        "multipart/form-data", Map.of("schema", resolveTypeSchema(param.getParameterizedType(), schemas, schemaOwners))
                ));
                requestBody = bodyObj;
            } else if (param.isAnnotationPresent(RequestParam.class)) {
                RequestParam rp = param.getAnnotation(RequestParam.class);
                String name = StrUtil.blankToDefault(rp.value(), StrUtil.blankToDefault(rp.name(), fallbackName));
                Map<String, Object> pObj = new LinkedHashMap<>();
                pObj.put("name", name);
                pObj.put("in", "query");
                pObj.put("required", rp.required());
                pObj.put("schema", resolveTypeSchema(param.getParameterizedType(), schemas, schemaOwners));
                queryOrPathParams.add(pObj);
            } else if (!isSimpleScalar(rawType)) {
                // 注册查询 VO Schema 供前端类型复用，同时按 springdoc.default-flat-param-object=true 展平为独立查询参数。
                resolveTypeSchema(param.getParameterizedType(), schemas, schemaOwners);
                appendFlattenedQueryParams(rawType, queryOrPathParams, schemas, schemaOwners);
            } else {
                Map<String, Object> pObj = new LinkedHashMap<>();
                pObj.put("name", fallbackName);
                pObj.put("in", "query");
                pObj.put("required", false);
                pObj.put("schema", resolveTypeSchema(param.getParameterizedType(), schemas, schemaOwners));
                queryOrPathParams.add(pObj);
            }
        }

        if (!queryOrPathParams.isEmpty()) {
            op.put("parameters", queryOrPathParams);
        }
        if (requestBody != null) {
            op.put("requestBody", requestBody);
        }

        Map<String, Object> response200 = new LinkedHashMap<>();
        response200.put("description", "OK");
        if (method.getReturnType() != void.class && method.getReturnType() != Void.class) {
            Type responseType = unwrapResponseEntity(method.getGenericReturnType());
            response200.put("content", Map.of(
                    "application/json", Map.of("schema", resolveTypeSchema(responseType, schemas, schemaOwners))
            ));
        }
        op.put("responses", Map.of("200", response200));
        return op;
    }

    /** 剥离 Spring {@code ResponseEntity<T>} 外壳，暴露真实 JSON 响应体契约类型。 */
    private static Type unwrapResponseEntity(Type returnType) {
        if (returnType instanceof ParameterizedType pt
                && pt.getRawType() instanceof Class<?> raw
                && org.springframework.http.ResponseEntity.class.isAssignableFrom(raw)
                && pt.getActualTypeArguments().length == 1) {
            return pt.getActualTypeArguments()[0];
        }
        return returnType;
    }

    /** 将查询对象 VO 的所有非隐藏字段按字母序展平为 OpenAPI query parameters。 */
    private static void appendFlattenedQueryParams(Class<?> clazz, List<Map<String, Object>> target,
                                                   Map<String, Object> schemas,
                                                   Map<String, Class<?>> schemaOwners) {
        Map<String, Map<String, Object>> flattened = new TreeMap<>();
        List<Class<?>> hierarchy = new ArrayList<>();
        for (Class<?> cur = clazz; cur != null && cur != Object.class; cur = cur.getSuperclass()) {
            hierarchy.add(0, cur);
        }
        for (Class<?> cur : hierarchy) {
            for (Field field : cur.getDeclaredFields()) {
                if (field.isSynthetic()
                        || Modifier.isStatic(field.getModifiers())
                        || Modifier.isTransient(field.getModifiers())
                        || field.isAnnotationPresent(JsonIgnore.class)) {
                    continue;
                }
                Schema fieldSchemaAnn = field.getAnnotation(Schema.class);
                if (fieldSchemaAnn != null && fieldSchemaAnn.hidden()) {
                    continue;
                }
                Map<String, Object> pObj = new LinkedHashMap<>();
                pObj.put("name", field.getName());
                pObj.put("in", "query");
                pObj.put("required", isRequiredField(field, fieldSchemaAnn));
                pObj.put("schema", resolveTypeSchema(field.getGenericType(), schemas, schemaOwners));
                flattened.put(field.getName(), pObj);
            }
        }
        target.addAll(flattened.values());
    }

    /** 递归将 Java 反射类型解析为 OpenAPI Schema 定义或组件引用。 */
    private static Map<String, Object> resolveTypeSchema(Type type, Map<String, Object> schemas,
                                                         Map<String, Class<?>> schemaOwners) {
        if (type instanceof WildcardType wt) {
            Type[] upper = wt.getUpperBounds();
            return upper.length > 0 ? resolveTypeSchema(upper[0], schemas, schemaOwners) : Map.of("type", "object");
        }
        if (type instanceof ParameterizedType pt) {
            Class<?> raw = (Class<?>) pt.getRawType();
            if (org.springframework.http.ResponseEntity.class.isAssignableFrom(raw)
                    && pt.getActualTypeArguments().length == 1) {
                return resolveTypeSchema(pt.getActualTypeArguments()[0], schemas, schemaOwners);
            }
            Type[] args = pt.getActualTypeArguments();
            if (Collection.class.isAssignableFrom(raw)) {
                Map<String, Object> arr = new LinkedHashMap<>();
                arr.put("type", "array");
                arr.put("items", args.length > 0 ? resolveTypeSchema(args[0], schemas, schemaOwners) : Map.of("type", "object"));
                return arr;
            }
            if (Map.class.isAssignableFrom(raw)) {
                Map<String, Object> mapSchema = new LinkedHashMap<>();
                mapSchema.put("type", "object");
                if (args.length > 1) {
                    mapSchema.put("additionalProperties", resolveTypeSchema(args[1], schemas, schemaOwners));
                }
                return mapSchema;
            }
            // CommonResult<T> 或 PageResult<T> 展开为具名泛型组合 Schema
            String schemaName = buildParameterizedSchemaName(raw, args);
            if (!schemas.containsKey(schemaName)) {
                schemas.put(schemaName, Map.of("type", "object"));
                schemas.put(schemaName, introspectBeanSchema(raw, pt, schemas, schemaOwners));
            }
            return Map.of("$ref", "#/components/schemas/" + schemaName);
        }
        if (type instanceof Class<?> clazz) {
            if (clazz.isArray()) {
                if (clazz == byte[].class) {
                    return Map.of("type", "string", "format", "byte");
                }
                return Map.of("type", "array", "items", resolveTypeSchema(clazz.getComponentType(), schemas, schemaOwners));
            }
            Map<String, Object> scalar = scalarSchema(clazz);
            if (scalar != null) {
                return scalar;
            }
            String schemaName = uniqueModelName(clazz);
            Class<?> previousOwner = schemaOwners.putIfAbsent(schemaName, clazz);
            if (previousOwner != null && !previousOwner.equals(clazz)) {
                throw new IllegalStateException(
                        "检测到 OpenAPI Schema 重名冲突 '" + schemaName + "': "
                                + previousOwner.getName() + " 与 " + clazz.getName()
                                + "，请为不同模块的 VO 使用带模块前缀的唯一类名");
            }
            if (!schemas.containsKey(schemaName)) {
                schemas.put(schemaName, Map.of("type", "object"));
                schemas.put(schemaName, introspectBeanSchema(clazz, null, schemas, schemaOwners));
            }
            return Map.of("$ref", "#/components/schemas/" + schemaName);
        }
        return Map.of("type", "object");
    }

    /** 扫描 VO/DTO 类继承链上的持久化/序列化属性并生成对象 Schema。 */
    private static Map<String, Object> introspectBeanSchema(Class<?> clazz, ParameterizedType genericSelf,
                                                            Map<String, Object> schemas,
                                                            Map<String, Class<?>> schemaOwners) {
        Map<String, Type> typeVarMap = new LinkedHashMap<>();
        if (genericSelf != null) {
            var typeParams = clazz.getTypeParameters();
            var actualArgs = genericSelf.getActualTypeArguments();
            for (int i = 0; i < Math.min(typeParams.length, actualArgs.length); i++) {
                typeVarMap.put(typeParams[i].getName(), actualArgs[i]);
            }
        }
        Map<String, Object> properties = new TreeMap<>();
        Set<String> required = new LinkedHashSet<>();

        List<Class<?>> hierarchy = new ArrayList<>();
        for (Class<?> cur = clazz; cur != null && cur != Object.class; cur = cur.getSuperclass()) {
            hierarchy.add(0, cur);
        }
        for (Class<?> cur : hierarchy) {
            for (Field field : cur.getDeclaredFields()) {
                if (field.isSynthetic()
                        || Modifier.isStatic(field.getModifiers())
                        || Modifier.isTransient(field.getModifiers())
                        || field.isAnnotationPresent(JsonIgnore.class)) {
                    continue;
                }
                Schema fieldSchemaAnn = field.getAnnotation(Schema.class);
                if (fieldSchemaAnn != null && fieldSchemaAnn.hidden()) {
                    continue;
                }
                Type fieldType = field.getGenericType();
                if (fieldType instanceof java.lang.reflect.TypeVariable<?> tv && typeVarMap.containsKey(tv.getName())) {
                    fieldType = typeVarMap.get(tv.getName());
                } else if (fieldType instanceof ParameterizedType fpt) {
                    Type[] resolvedArgs = Arrays.stream(fpt.getActualTypeArguments())
                            .map(arg -> (arg instanceof java.lang.reflect.TypeVariable<?> tv && typeVarMap.containsKey(tv.getName()))
                                    ? typeVarMap.get(tv.getName()) : arg)
                            .toArray(Type[]::new);
                    fieldType = new ResolvedParameterizedType((Class<?>) fpt.getRawType(), resolvedArgs);
                }
                Map<String, Object> propSchema = new LinkedHashMap<>(resolveTypeSchema(fieldType, schemas, schemaOwners));
                if (fieldSchemaAnn != null && StrUtil.isNotBlank(fieldSchemaAnn.description()) && !propSchema.containsKey("$ref")) {
                    propSchema.put("description", fieldSchemaAnn.description());
                }
                properties.put(field.getName(), propSchema);
                if (isRequiredField(field, fieldSchemaAnn)) {
                    required.add(field.getName());
                }
            }
        }

        Map<String, Object> beanSchema = new LinkedHashMap<>();
        beanSchema.put("type", "object");
        Schema classSchemaAnn = clazz.getAnnotation(Schema.class);
        if (classSchemaAnn != null && StrUtil.isNotBlank(classSchemaAnn.description())) {
            beanSchema.put("description", classSchemaAnn.description());
        }
        if (!required.isEmpty()) {
            List<String> sortedReq = new ArrayList<>(required);
            sortedReq.sort(String::compareTo);
            beanSchema.put("required", sortedReq);
        }
        beanSchema.put("properties", properties);
        return beanSchema;
    }

    /** 根据基础类型、Bean Validation 注解与 {@link Schema} 元数据判定字段是否必填。 */
    private static boolean isRequiredField(Field field, Schema schemaAnn) {
        if (field.getType().isPrimitive()
                || field.isAnnotationPresent(NotNull.class)
                || field.isAnnotationPresent(NotBlank.class)
                || field.isAnnotationPresent(NotEmpty.class)) {
            return true;
        }
        return schemaAnn != null && schemaAnn.requiredMode() == Schema.RequiredMode.REQUIRED;
    }

    /** 将基础标量、日期时间、上传文件与枚举类型映射为内联 OpenAPI Schema。 */
    private static Map<String, Object> scalarSchema(Class<?> clazz) {
        if (clazz == String.class || CharSequence.class.isAssignableFrom(clazz)) {
            return Map.of("type", "string");
        }
        if (clazz == boolean.class || clazz == Boolean.class) {
            return Map.of("type", "boolean");
        }
        if (clazz == int.class || clazz == Integer.class || clazz == short.class || clazz == Short.class || clazz == byte.class || clazz == Byte.class) {
            return Map.of("type", "integer", "format", "int32");
        }
        if (clazz == long.class || clazz == Long.class) {
            return Map.of("type", "integer", "format", "int64");
        }
        if (clazz == float.class || clazz == Float.class || clazz == double.class || clazz == Double.class || clazz == BigDecimal.class) {
            return Map.of("type", "number");
        }
        // 项目 Jackson 全局配置 write-dates-as-timestamps: true，LocalDateTime 在线传输固定为毫秒时间戳 number。
        if (clazz == LocalDateTime.class) {
            return Map.of("type", "integer", "format", "int64", "x-java-type", "LocalDateTime-epoch-ms");
        }
        if (clazz == LocalDate.class || clazz == LocalTime.class) {
            return Map.of("type", "string");
        }
        if (MultipartFile.class.isAssignableFrom(clazz)) {
            return Map.of("type", "string", "format", "binary");
        }
        if (clazz.isEnum()) {
            List<String> values = Arrays.stream(clazz.getEnumConstants()).map(Object::toString).toList();
            return Map.of("type", "string", "enum", values);
        }
        if (clazz == Object.class) {
            return Map.of("type", "object");
        }
        return null;
    }

    /** 判断参数类型是否可直接作为单值查询参数映射。 */
    private static boolean isSimpleScalar(Class<?> clazz) {
        return clazz.isPrimitive() || scalarSchema(clazz) != null;
    }

    /** 判断参数或请求对象自身或其字段是否包含 {@link MultipartFile} 上传类型。 */
    private static boolean containsMultipartFile(Class<?> clazz) {
        if (MultipartFile.class.isAssignableFrom(clazz)) {
            return true;
        }
        for (Class<?> cur = clazz; cur != null && cur != Object.class; cur = cur.getSuperclass()) {
            for (Field f : cur.getDeclaredFields()) {
                if (!f.isSynthetic() && MultipartFile.class.isAssignableFrom(f.getType())) {
                    return true;
                }
            }
        }
        return false;
    }

    /** 生成包含外部类前缀的无冲突模型名称。 */
    private static String uniqueModelName(Class<?> clazz) {
        Class<?> enclosing = clazz.getEnclosingClass();
        return enclosing != null ? enclosing.getSimpleName() + "_" + clazz.getSimpleName() : clazz.getSimpleName();
    }

    /** 为泛型包装类型（如 {@code CommonResult<PageResult<UserRespVO>>}）生成稳定 Schema 名称。 */
    private static String buildParameterizedSchemaName(Class<?> raw, Type[] args) {
        StringBuilder sb = new StringBuilder(uniqueModelName(raw));
        for (Type arg : args) {
            sb.append('_');
            if (arg instanceof Class<?> c) {
                sb.append(c == Void.class ? "Void" : uniqueModelName(c));
            } else if (arg instanceof ParameterizedType pt) {
                sb.append(buildParameterizedSchemaName((Class<?>) pt.getRawType(), pt.getActualTypeArguments()));
            } else {
                sb.append("Object");
            }
        }
        return sb.toString();
    }

    /** 根据控制器包路径推断统一路由前缀。 */
    private static String resolveApiPrefix(String packageName) {
        if (packageName.contains(".controller.admin")) {
            return "/admin-api";
        }
        if (packageName.contains(".controller.app")) {
            return "/app-api";
        }
        return "";
    }

    /** 拼接并规范化控制器前缀、类路径与方法子路径。 */
    private static String normalizeUrlPath(String prefix, String base, String sub) {
        StringBuilder sb = new StringBuilder();
        for (String part : List.of(prefix, base, sub)) {
            if (StrUtil.isBlank(part)) {
                continue;
            }
            String trimmed = StrUtil.strip(part.trim(), "/", "/");
            if (!trimmed.isEmpty()) {
                sb.append('/').append(trimmed);
            }
        }
        return sb.length() == 0 ? "/" : sb.toString();
    }

    /** 提取控制器方法上的 Spring MVC HTTP 动词与子路径映射。 */
    private static EndpointMapping extractEndpointMapping(Method method) {
        if (method.isAnnotationPresent(GetMapping.class)) {
            GetMapping m = AnnotatedElementUtils.findMergedAnnotation(method, GetMapping.class);
            return new EndpointMapping(new String[]{"get"}, m.path());
        }
        if (method.isAnnotationPresent(PostMapping.class)) {
            PostMapping m = AnnotatedElementUtils.findMergedAnnotation(method, PostMapping.class);
            return new EndpointMapping(new String[]{"post"}, m.path());
        }
        if (method.isAnnotationPresent(PutMapping.class)) {
            PutMapping m = AnnotatedElementUtils.findMergedAnnotation(method, PutMapping.class);
            return new EndpointMapping(new String[]{"put"}, m.path());
        }
        if (method.isAnnotationPresent(DeleteMapping.class)) {
            DeleteMapping m = AnnotatedElementUtils.findMergedAnnotation(method, DeleteMapping.class);
            return new EndpointMapping(new String[]{"delete"}, m.path());
        }
        if (method.isAnnotationPresent(PatchMapping.class)) {
            PatchMapping m = AnnotatedElementUtils.findMergedAnnotation(method, PatchMapping.class);
            return new EndpointMapping(new String[]{"patch"}, m.path());
        }
        if (method.isAnnotationPresent(RequestMapping.class)) {
            RequestMapping m = AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping.class);
            RequestMethod[] rms = m.method().length > 0 ? m.method() : new RequestMethod[]{RequestMethod.GET};
            String[] verbs = Arrays.stream(rms).map(rm -> rm.name().toLowerCase(Locale.ROOT)).sorted().toArray(String[]::new);
            return new EndpointMapping(verbs, m.path());
        }
        return null;
    }

    /** 向上查找仓库前端工程下的 OpenAPI 契约快照路径。 */
    private static Path resolveOpenApiSnapshotPath() {
        for (Path current = Path.of("").toAbsolutePath(); current != null; current = current.getParent()) {
            Path frontendRoot = current.resolve("前端代码/basic-framework-admin/src/api").normalize();
            if (Files.isDirectory(frontendRoot)) {
                return frontendRoot.resolve("generated/openapi.json");
            }
        }
        throw new IllegalStateException("找不到 前端代码/basic-framework-admin/src/api 目录");
    }

    /** 控制器方法映射的 HTTP 动词数组与路径数组。 */
    private record EndpointMapping(String[] httpMethods, String[] paths) {
    }

    /** 将泛型类型变量绑定为具体实际参数后的参数化类型视图。 */
    private record ResolvedParameterizedType(Class<?> raw, Type[] args) implements ParameterizedType {
        /** 返回已替换类型变量后的实际泛型参数数组。 */
        @Override
        public Type[] getActualTypeArguments() {
            return args;
        }

        /** 返回原始宿主类型。 */
        @Override
        public Type getRawType() {
            return raw;
        }

        /** 顶层泛型包装无外部所有者类型，固定返回 {@code null}。 */
        @Override
        public Type getOwnerType() {
            return null;
        }
    }

}
