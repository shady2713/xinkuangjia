-- 目的：让 system_dict_type 的类型编码在软删除后可再次创建，同时保留全部历史行与 Boolean deleted 语义。
-- 适用：system_dict_type 的唯一索引仍为 UNIQUE(type) 的 MySQL 8.x 库；空库新装与已核对的旧库升级都执行本文件。
-- 顺序：核对目标、flyway_schema_history 与备份，完成恢复演练并停写后，由独立 Flyway 运维入口执行。
-- 重放：版本化迁移只执行一次；重复 migrate 不重放本文件，也不改写已登记校验和。
-- 前检：确认 system_dict_type 存在，且没有名为 alive 的列或名为 uk_type_alive 的索引；脚本不读写业务行。
-- 后检：alive 为可空虚拟生成列，uk_type_alive 唯一并覆盖 (type, alive)，历史行数与 type 值必须与执行前逐行一致。
-- 恢复：单条 ALTER 受 MySQL 8 原子 DDL 保护，整体生效或整体不生效；失败按前置备份恢复，不使用 clean 或 repair。

-- 生成列只为唯一约束服务：未删除行为 1，已删除行为 NULL。
-- MySQL 唯一索引不比较 NULL，所以同一编码可以保留任意多条已删除历史行，未删除行仍然只能有一条。
-- 不使用 UNIQUE(type, deleted)：同一编码第二次删除时会与第一条已删记录 (type, 1) 冲突，删除直接失败。
-- 不删除历史行、不改写历史编码：回收站、审计与对账仍能按原编码查到被删除的记录。
ALTER TABLE `system_dict_type`
    ADD COLUMN `alive` tinyint
        GENERATED ALWAYS AS (IF(`deleted` = b'0', 1, NULL)) VIRTUAL
        COMMENT '未删除标记：未删除为 1，已删除为 NULL，使唯一索引只在未删除行之间生效' AFTER `deleted`,
    DROP INDEX `uk_type`,
    ADD UNIQUE INDEX `uk_type_alive`(`type` ASC, `alive` ASC) USING BTREE;

-- 后检（只读，人工在目标库执行）：第一条只应返回 YES 与 VIRTUAL GENERATED；
-- 第二条只应有 PRIMARY(id) 与 uk_type_alive(type, alive)；第三条必须返回空集，非空立即停下调查并恢复备份。
--   SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_dict_type' AND COLUMN_NAME = 'alive';
--   SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS
--    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_dict_type' ORDER BY INDEX_NAME, SEQ_IN_INDEX;
--   SELECT type, COUNT(*) FROM system_dict_type WHERE deleted = b'0' GROUP BY type HAVING COUNT(*) > 1;
