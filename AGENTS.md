# basic-framework Engineering Guide

[中文版](AGENTS.zh.md)

Repository-wide engineering rules for the ultra-lean enterprise & government management framework (Spring Boot 3.5 3-module backend + single-package Vue 3 & Element Plus frontend).

## Project Map

```text
后端代码/basic-framework-boot/
  basic-framework-core/      Common utilities, Web/XSS/Jackson, Security, MyBatis-Plus, DataPermission, Redis, Excel, @OperateLog AOP
  basic-framework-system/    Auth/SM2, Captcha, RBAC, Dept, Dict, OAuth2, Login/Operate logs, Aliyun SMS, Local/OSS File Storage
  basic-framework-server/    Spring Boot entrypoint, application.yaml, ArchUnit/OpenAPI/Schema tests, Dockerfile
前端代码/basic-framework-admin/
  src/                       Single-package Vite + Vue 3 + TypeScript + Element Plus + Pinia + Vue Router + Tailwind CSS
  scripts/                   OpenAPI -> TypeScript declaration generator (`pnpm api:gen`)
数据库文件/                  14-table baseline schema (`basic_framework.sql`)
docker-compose.dev.yml       Loopback-only MySQL 8 + Redis 7 dev stack
scripts/runtime/             Local env bootstrap, demo seed, and dev launchers
docs/                        Architecture, standard CRUD workflow, and deployment guide
.agents/skills/              Project-specific engineering skills
```

## Working Rules

- Follow applicable directory rules. Precedence: system and current user instructions, this file, project Skills, module configuration, then adjacent conventions.
- Use UTF-8 without BOM and LF line endings for Java, SQL, YAML, XML, TypeScript, Vue, shell, Python, and Markdown files.
- Never place secrets, credentials, or private keys in source, defaults, tests, SQL, logs, or docs. Obtain real credentials from gitignored `.env` or environment variables.
- Keep HTTP request/response VO models separate from persistence DOs. Every HTTP endpoint must declare `@PreAuthorize` or be explicitly listed in the ArchUnit `@PermitAll` allowlist.
- Preserve dual-platform isolation (`super_admin` vs `business_admin`), fail-closed authorization when operator context is absent, and `@Transactional(rollbackFor = Exception.class)` on write methods.
- Whenever backend controller routes or VO fields change, update the OpenAPI snapshot (`mvn -B -ntp verify -Pquality-gate -Dopenapi.update=true`) and regenerate frontend types (`pnpm api:gen`) in the same change set.
- Exclude `docs/需求卡/**` from general repository discovery unless explicitly requested by the user.

## Skill Routing

| Task | Skill under `.agents/skills/` |
| --- | --- |
| Java backend, SQL, security & deployment | [weetion-development-java-standards](.agents/skills/weetion-development-java-standards/SKILL.md) |
| Single-package Vue 3 + Element Plus frontend | [weetion-development-web-standards](.agents/skills/weetion-development-web-standards/SKILL.md) |
| Code review & security audit | [weetion-code-review](.agents/skills/weetion-code-review/SKILL.md) |

## Required Validation

Before delivering changes, run the applicable gates matching `.github/workflows/ci.yml`:
- **Backend**: `cd 后端代码/basic-framework-boot && mvn -B -ntp -Pquality-gate verify`
- **Frontend**: `cd 前端代码/basic-framework-admin && pnpm run quality:gates`
- Never weaken assertions, ArchUnit rules, JaCoCo thresholds, PMD rules, or ESLint rules to make checks pass.
