#!/usr/bin/env python3
"""Print synthetic smoke-test seed SQL for the disposable compose database.

Reads the generated password only from SMOKE_PASSWORD and writes SQL to stdout;
the caller pipes it into the existing database connection. No network access.
"""
import os
import re
import sys

import bcrypt

ACTOR = "smoke-seed"
ROLE_PERMISSIONS = (
    "system:role:query",
    "system:role:create",
    "system:role:update",
    "system:role:delete",
)
HASH_PATTERN = re.compile(r"\$2a\$10\$[./A-Za-z0-9]{53}")


def fail(message):
    print(f"smoke-seed: {message}", file=sys.stderr)
    sys.exit(2)


def bcrypt_hash(password):
    hashed = bcrypt.hashpw(password, bcrypt.gensalt(rounds=10, prefix=b"2a")).decode("ascii")
    if not HASH_PATTERN.fullmatch(hashed):
        fail("unexpected bcrypt output")
    return hashed


def main():
    if len(sys.argv) != 1:
        fail("command-line arguments are not accepted")
    password = os.environ.get("SMOKE_PASSWORD", "").encode("utf-8")
    if not 1 <= len(password) <= 72:
        fail("SMOKE_PASSWORD must be 1-72 bytes")
    admin_hash = bcrypt_hash(password)
    member_hash = bcrypt_hash(password)
    permissions = ", ".join(f"'{p}'" for p in ROLE_PERMISSIONS)
    sys.stdout.write(f"""SET NAMES utf8mb4;
START TRANSACTION;
UPDATE `system_users`
  SET `password` = '{admin_hash}', `password_change_required` = 1, `updater` = '{ACTOR}'
  WHERE `id` = 1 AND `deleted` = b'0';
INSERT INTO `system_users`
  (`username`, `password`, `password_change_required`, `user_type`, `nickname`, `status`, `creator`, `updater`)
  VALUES ('smokemember', '{member_hash}', 0, 'business_admin', 'Smoke Member', 0, '{ACTOR}', '{ACTOR}');
SET @smoke_user_id = LAST_INSERT_ID();
INSERT INTO `system_role`
  (`name`, `code`, `role_type`, `sort`, `status`, `type`, `remark`, `creator`, `updater`)
  VALUES ('Smoke Role Admin', 'smoke_role_admin', 'business_admin', 100, 0, 2, 'synthetic smoke fixture', '{ACTOR}', '{ACTOR}');
SET @smoke_role_id = LAST_INSERT_ID();
INSERT INTO `system_user_role` (`user_id`, `role_id`, `creator`, `updater`)
  VALUES (@smoke_user_id, @smoke_role_id, '{ACTOR}', '{ACTOR}');
INSERT INTO `system_menu`
  (`name`, `permission`, `type`, `menu_type`, `sort`, `parent_id`, `status`, `creator`, `updater`)
  SELECT m.`name`, m.`permission`, m.`type`, 'business_admin', m.`sort`, 0, 0, '{ACTOR}', '{ACTOR}'
  FROM `system_menu` m
  WHERE m.`deleted` = b'0' AND m.`menu_type` = 'super_admin' AND m.`permission` IN ({permissions});
INSERT INTO `system_role_menu` (`role_id`, `menu_id`, `creator`, `updater`)
  SELECT @smoke_role_id, m.`id`, '{ACTOR}', '{ACTOR}'
  FROM `system_menu` m
  WHERE m.`deleted` = b'0' AND m.`menu_type` = 'business_admin'
    AND m.`creator` = '{ACTOR}' AND m.`permission` IN ({permissions});
COMMIT;
""")


if __name__ == "__main__":
    main()
