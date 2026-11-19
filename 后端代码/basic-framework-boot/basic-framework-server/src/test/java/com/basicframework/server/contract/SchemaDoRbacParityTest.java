package com.basicframework.server.contract;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.enums.ServiceErrorCodeRange;
import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import com.basicframework.framework.mybatis.core.dataobject.UniqueBaseDO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Schema-DO-RBAC-ErrorCode 三位一体契约校验门禁。
 *
 * <p>在不依赖外部 MySQL 实例的前提下，直接解析 {@code 数据库文件/basic_framework.sql} 并结合反射校验：
 * 1. 所有 {@code @TableName} 持久化 DO 的表名、列名与 SQL 基线 100% 一致，且 {@link UniqueBaseDO} 子类的唯一索引必须包含 {@code deleted_tag}；
 * 2. 所有控制器 {@code @PreAuthorize} 声明的权限码均已在 {@code system_menu} 定义并绑定超级管理员角色；
 * 3. 所有业务模块错误码唯一且严格落在 {@link ServiceErrorCodeRange} 声明的模块区间内。</p>
 *
 * @author shady2713
 */
class SchemaDoRbacParityTest {

    private static final Pattern CREATE_TABLE_PATTERN = Pattern.compile(
            "CREATE\\s+TABLE\\s+`([^`]+)`\\s*\\((.*?)\\)\\s*ENGINE\\s*=",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE);

    private static final Pattern COLUMN_LINE_PATTERN = Pattern.compile("^\\s*`([^`]+)`\\s+([a-zA-Z]+).*");

    private static final Pattern UNIQUE_INDEX_PATTERN = Pattern.compile(
            "UNIQUE\\s+(?:INDEX|KEY)\\s+`[^`]+`\\s*\\(([^)]+)\\)",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern MENU_INSERT_PATTERN = Pattern.compile(
            "INSERT\\s+INTO\\s+`system_menu`\\s+VALUES\\s*\\((\\d+),\\s*'[^']*',\\s*'([^']*)',\\s*\\d+,\\s*'([^']*)'");

    private static final Pattern ROLE_MENU_INSERT_PATTERN = Pattern.compile(
            "INSERT\\s+INTO\\s+`system_role_menu`\\s+VALUES\\s*\\(\\d+,\\s*1,\\s*(\\d+),");

    private static final Pattern PERMISSION_FUNC_PATTERN = Pattern.compile(
            "@ss\\.has(?:Any)?Permissions?\\(([^)]*)\\)");

    private static final Pattern SINGLE_QUOTED_PATTERN = Pattern.compile("'([^']+)'");

    /** 仅存一次性密码学随机令牌、删除后永不复用旧值的表，豁免 deleted_tag 要求。 */
    private static final Set<String> IMMUTABLE_TOKEN_UNIQUE_TABLES = Set.of(
            "system_oauth2_access_token",
            "system_oauth2_refresh_token");

    /** 校验全部持久化 DO 类与 basic_framework.sql 的表结构及软删除唯一索引严格对齐。 */
    @Test
    void dataObjectsMatchBaselineSqlColumnsAndUniqueIndexes() throws Exception {
        String sql = Files.readString(resolveBaselineSqlPath(), StandardCharsets.UTF_8);
        Map<String, SqlTableMeta> sqlTables = parseSqlTables(sql);
        assertFalse(sqlTables.isEmpty(), "未能从 basic_framework.sql 解析出任何表结构");

        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(TableName.class));
        Set<BeanDefinition> candidates = scanner.findCandidateComponents("com.basicframework.module");
        assertFalse(candidates.isEmpty(), "未扫描到任何 @TableName DO 类");

        List<String> mismatches = new ArrayList<>();
        for (BeanDefinition bd : candidates) {
            Class<?> doClass = Class.forName(bd.getBeanClassName());
            if (doClass.getPackageName().contains(".footgun")) {
                continue;
            }
            TableName tableNameAnn = doClass.getAnnotation(TableName.class);
            String tableName = tableNameAnn.value().trim().toLowerCase(Locale.ROOT);
            SqlTableMeta tableMeta = sqlTables.get(tableName);
            if (tableMeta == null) {
                mismatches.add(doClass.getSimpleName() + " 映射的表不存在于 basic_framework.sql: " + tableName);
                continue;
            }
            Set<String> doColumns = extractPersistentColumns(doClass);
            if (!tableMeta.columns.equals(doColumns)) {
                Set<String> missingInDo = new TreeSet<>(tableMeta.columns);
                missingInDo.removeAll(doColumns);
                Set<String> extraInDo = new TreeSet<>(doColumns);
                extraInDo.removeAll(tableMeta.columns);
                mismatches.add(String.format(
                        "表 `%s` (%s) 字段失步 -> SQL有但DO缺: %s, DO有但SQL缺: %s",
                        tableName, doClass.getSimpleName(), missingInDo, extraInDo));
            }
            if (UniqueBaseDO.class.isAssignableFrom(doClass)) {
                if (tableMeta.uniqueIndexColumnSets.isEmpty()) {
                    mismatches.add(doClass.getSimpleName() + " 继承了 UniqueBaseDO，但表 `" + tableName + "` 未声明任何 UNIQUE INDEX");
                }
                for (Set<String> ukCols : tableMeta.uniqueIndexColumnSets) {
                    if (!ukCols.contains("deleted_tag")) {
                        mismatches.add("表 `" + tableName + "` 的唯一索引未包含 deleted_tag 列: " + ukCols);
                    }
                }
            } else if (BaseDO.class.isAssignableFrom(doClass)
                    && !tableMeta.uniqueIndexColumnSets.isEmpty()
                    && !IMMUTABLE_TOKEN_UNIQUE_TABLES.contains(tableName)) {
                // 反向门禁：任何可软删除的 BaseDO 表只要声明了业务 UNIQUE INDEX，就必须继承 UniqueBaseDO 并包含 deleted_tag。
                mismatches.add(doClass.getSimpleName() + " 对应软删除表 `" + tableName
                        + "` 含唯一索引 " + tableMeta.uniqueIndexColumnSets + "，必须继承 UniqueBaseDO 并加入 deleted_tag");
            }
        }
        assertTrue(mismatches.isEmpty(), String.join("\n", mismatches));
    }

    /** 校验所有控制器 @PreAuthorize 权限标识均已在 system_menu 注册并授予超级管理员角色。 */
    @Test
    void allControllerPermissionsExistInBaselineMenuAndSuperAdminRole() throws Exception {
        String sql = Files.readString(resolveBaselineSqlPath(), StandardCharsets.UTF_8);
        Set<Long> superAdminRoleMenuIds = new LinkedHashSet<>();
        Matcher rmMatcher = ROLE_MENU_INSERT_PATTERN.matcher(sql);
        while (rmMatcher.find()) {
            superAdminRoleMenuIds.add(Long.parseLong(rmMatcher.group(1)));
        }

        Map<String, List<Long>> permToMenuIds = new HashMap<>();
        Matcher menuMatcher = MENU_INSERT_PATTERN.matcher(sql);
        while (menuMatcher.find()) {
            long menuId = Long.parseLong(menuMatcher.group(1));
            String perm = menuMatcher.group(2);
            String menuType = menuMatcher.group(3);
            if (!perm.isEmpty() && "super_admin".equals(menuType)) {
                permToMenuIds.computeIfAbsent(perm, k -> new ArrayList<>()).add(menuId);
            }
        }

        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        Set<String> missingInMenu = new TreeSet<>();
        Set<String> unboundToSuperAdmin = new TreeSet<>();

        for (BeanDefinition bd : scanner.findCandidateComponents("com.basicframework.module")) {
            Class<?> controllerClass = Class.forName(bd.getBeanClassName());
            if (controllerClass.getPackageName().contains(".footgun")) {
                continue;
            }
            for (Method method : controllerClass.getDeclaredMethods()) {
                PreAuthorize preAuth = method.getAnnotation(PreAuthorize.class);
                if (preAuth == null) {
                    continue;
                }
                Matcher funcMatcher = PERMISSION_FUNC_PATTERN.matcher(preAuth.value());
                while (funcMatcher.find()) {
                    Matcher quoteMatcher = SINGLE_QUOTED_PATTERN.matcher(funcMatcher.group(1));
                    while (quoteMatcher.find()) {
                        String perm = quoteMatcher.group(1);
                        List<Long> menuIds = permToMenuIds.get(perm);
                        if (menuIds == null || menuIds.isEmpty()) {
                            missingInMenu.add(perm + " (" + controllerClass.getSimpleName() + "#" + method.getName() + ")");
                        } else if (menuIds.stream().noneMatch(superAdminRoleMenuIds::contains)) {
                            unboundToSuperAdmin.add(perm + " -> menuIds=" + menuIds);
                        }
                    }
                }
            }
        }
        assertTrue(missingInMenu.isEmpty(), "控制器使用了未在 system_menu 注册的权限码: " + missingInMenu);
        assertTrue(unboundToSuperAdmin.isEmpty(), "权限菜单未绑定至超级管理员角色(role_id=1): " + unboundToSuperAdmin);
    }

    /** 校验所有业务模块 ErrorCodeConstants 编码全局唯一且严格位于各自模块分配区间内。 */
    @Test
    void errorCodesAreUniqueAndWithinAssignedModuleRanges() throws Exception {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter((metadataReader, metadataReaderFactory) ->
                metadataReader.getClassMetadata().getClassName().endsWith(".ErrorCodeConstants"));
        Map<Integer, String> seenCodes = new HashMap<>();
        List<String> violations = new ArrayList<>();
        // 支持同一业务模块下存在多个 ErrorCodeConstants 类，避免按模块名覆盖导致漏检。
        List<Map.Entry<String, Class<?>>> constantClasses = new ArrayList<>();
        Set<String> discoveredModules = new LinkedHashSet<>();
        Pattern modulePattern = Pattern.compile("^com\\.basicframework\\.module\\.([a-z0-9_]+)\\..*\\.ErrorCodeConstants$");
        for (BeanDefinition candidate : scanner.findCandidateComponents("com.basicframework.module")) {
            String className = candidate.getBeanClassName();
            Matcher matcher = modulePattern.matcher(className);
            if (matcher.matches()) {
                discoveredModules.add(matcher.group(1));
                constantClasses.add(Map.entry(matcher.group(1), Class.forName(className)));
            }
        }
        assertTrue(ServiceErrorCodeRange.MODULE_RANGES.keySet().containsAll(discoveredModules),
                "存在未在 ServiceErrorCodeRange.MODULE_RANGES 登记号段的模块: " + discoveredModules);

        for (Map.Entry<String, Class<?>> entry : constantClasses) {
            String moduleName = entry.getKey();
            Class<?> clazz = entry.getValue();
            int[] range = ServiceErrorCodeRange.MODULE_RANGES.get(moduleName);
            assertNotNull(range);
            for (Field field : clazz.getDeclaredFields()) {
                if (!Modifier.isStatic(field.getModifiers()) || !ErrorCode.class.isAssignableFrom(field.getType())) {
                    continue;
                }
                ErrorCode errorCode = (ErrorCode) field.get(null);
                int code = errorCode.getCode();
                String label = moduleName + ":" + field.getName() + "(" + code + ")";
                if (code < range[0] || code >= range[1]) {
                    violations.add(label + " 越出模块号段 [" + range[0] + ", " + range[1] + ")");
                }
                String previous = seenCodes.putIfAbsent(code, label);
                if (previous != null) {
                    violations.add("错误码重复: " + previous + " 与 " + label);
                }
            }
        }
        assertTrue(violations.isEmpty(), String.join("\n", violations));
    }

    /** 解析仓库根目录下的数据库基线 SQL 路径。 */
    private static Path resolveBaselineSqlPath() {
        for (Path current = Path.of("").toAbsolutePath(); current != null; current = current.getParent()) {
            Path candidate = current.resolve("数据库文件").resolve("basic_framework.sql").normalize();
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("找不到 数据库文件/basic_framework.sql");
    }

    /** 解析 SQL 中的 CREATE TABLE 列名集合与唯一索引定义。 */
    private static Map<String, SqlTableMeta> parseSqlTables(String sql) {
        Map<String, SqlTableMeta> tables = new LinkedHashMap<>();
        Matcher tableMatcher = CREATE_TABLE_PATTERN.matcher(sql);
        while (tableMatcher.find()) {
            String tableName = tableMatcher.group(1).toLowerCase(Locale.ROOT);
            String body = tableMatcher.group(2);
            Set<String> columns = new TreeSet<>();
            List<Set<String>> uniqueIndexes = new ArrayList<>();
            for (String line : body.split("\\r?\\n")) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                String upper = trimmed.toUpperCase(Locale.ROOT);
                if (upper.startsWith("UNIQUE ")
                        || (upper.startsWith("CONSTRAINT ") && upper.contains(" UNIQUE"))) {
                    Matcher ukMatcher = UNIQUE_INDEX_PATTERN.matcher(trimmed);
                    if (ukMatcher.find()) {
                        Set<String> ukCols = new TreeSet<>();
                        Matcher colMatcher = Pattern.compile("`([^`]+)`").matcher(ukMatcher.group(1));
                        while (colMatcher.find()) {
                            ukCols.add(colMatcher.group(1).toLowerCase(Locale.ROOT));
                        }
                        uniqueIndexes.add(ukCols);
                    }
                    continue;
                }
                if (upper.startsWith("PRIMARY KEY")
                        || upper.startsWith("INDEX ")
                        || upper.startsWith("KEY ")
                        || upper.startsWith("CONSTRAINT ")
                        || upper.startsWith("FOREIGN KEY")) {
                    continue;
                }
                Matcher colMatcher = COLUMN_LINE_PATTERN.matcher(trimmed);
                if (colMatcher.matches()) {
                    columns.add(colMatcher.group(1).toLowerCase(Locale.ROOT));
                }
            }
            tables.put(tableName, new SqlTableMeta(columns, uniqueIndexes));
        }
        return tables;
    }

    /** 递归提取 DO 类及其继承链上的全部持久化列名。 */
    private static Set<String> extractPersistentColumns(Class<?> doClass) {
        Set<String> columns = new TreeSet<>();
        for (Class<?> current = doClass; current != null && current != Object.class; current = current.getSuperclass()) {
            for (Field field : current.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) || Modifier.isTransient(field.getModifiers())) {
                    continue;
                }
                TableField tf = field.getAnnotation(TableField.class);
                if (tf != null && !tf.exist()) {
                    continue;
                }
                String columnName = null;
                if (tf != null && StrUtil.isNotBlank(tf.value())) {
                    columnName = tf.value();
                } else {
                    TableId tid = field.getAnnotation(TableId.class);
                    if (tid != null && StrUtil.isNotBlank(tid.value())) {
                        columnName = tid.value();
                    }
                }
                if (StrUtil.isBlank(columnName)) {
                    columnName = StrUtil.toUnderlineCase(field.getName());
                }
                columnName = StrUtil.strip(columnName.trim(), "`", "`").toLowerCase(Locale.ROOT);
                columns.add(columnName);
            }
        }
        return columns;
    }

    /**
     * SQL 基线表结构摘要，记录列名集合与全部唯一索引列集合。
     */
    private record SqlTableMeta(Set<String> columns, List<Set<String>> uniqueIndexColumnSets) {
    }

}
