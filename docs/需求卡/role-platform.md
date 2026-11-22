# Role change task card (T10)


- Goal: remove the misleading editable platform (role type) field from the role create/update form, because the server already decides it.
- Scope: `src/views/system/role/index.vue` form state, rule, select and write payload (typed as `RoleSaveReq`); class-level schema description of `RoleSaveReqVO`; this card; one link from the CRUD guide.
- Out of scope: controller and service logic, the read-only platform badge in the list, menu and data-scope dialogs, other pages, database schema and data.
- Acceptance: every check below passes.
- Validation: the gates and review below, on one exact commit SHA.

## Per-platform permissions (existing behavior, unchanged)

The roles controller sets role type from the authenticated operator, ignores any client value, and applies platform isolation. Existing role permission checks still apply.

| Operator platform | Read | Create | Update | Delete |
| --- | --- | --- | --- | --- |
| super_admin | own platform roles only | own platform only | own platform only | own platform only |
| business_admin | own platform roles only | own platform only | own platform only | own platform only |

Read, update and delete refuse records from another platform. Creation uses the operator's platform.

## Acceptance and refusal checks

- Read, update or delete of a role id from another platform: refused by platform isolation; no data returned or changed.
- The form shows no platform selector, the payload has no `roleType`, and the type-check accepts the payload as `RoleSaveReq`.
- The list still shows the read-only platform badge.
- Locally generated OpenAPI and TS for `RoleSaveReq` carry the class description and no `roleType` field.

## Gates and review

- Run the validation gates defined in `AGENTS.md`, plus local API type generation, on one exact commit SHA.
- Record that SHA with the results; any new commit voids them and requires a rerun.
- Merge only after human review approves the same SHA. This card claims no hosted CI result.

## Deployment and rollback

- Deploy the reviewed SHA as a versioned build to an isolated environment with synthetic data only.
- Rollback: redeploy the previous version; nothing else needs reverting.
- No changes to existing databases: no DDL, no DML, no SQL script edits, no migrations.
