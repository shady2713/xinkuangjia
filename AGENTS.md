# basic-framework Engineering Guide

[中文版](AGENTS.zh.md)

Repository-wide requirements and task entry points for the Java backend and Vue administration application. Read the detailed rules relevant to the current task.

## Project Map

```text
后端代码/basic-framework-boot/
  basic-framework-core/          Common libraries and Spring Boot starters
  basic-framework-module-system/ Users, permissions, organization, dictionaries and logs
  basic-framework-module-infra/  Configuration, files and scheduled jobs
  basic-framework-server/        Application assembly and startup
  basic-framework-dependencies/  Shared dependency versions
前端代码/basic-framework-admin/
  apps/web-ele/                  Element Plus administration application
  packages/                      Shared UI, stores, hooks and utilities
  internal/                      Build, lint and TypeScript configuration
数据库文件/                      Database schema and initialization SQL
docs/部署/                       Application installation and deployment
scripts/                         Quality checks, tool tests and local launchers
docs/                            Architecture, development, testing and performance
.agents/skills/                  Project-specific Skills and supporting references
```

Start with the relevant package README for service operations. Use the [overall architecture](docs/架构/00-总体架构.md), [Java backend](docs/架构/03-Java后端.md) and [administration frontend](docs/架构/01-管理前端.md) for responsibilities and integration boundaries.

## Working Rules

- Follow applicable directory rules. Precedence: system and current user instructions, this file, project Skills and references, module configuration, then non-conflicting adjacent conventions. Stop writing if a conflict remains unresolved.
- Before editing, trace actual callers, data boundaries, configuration and consumers. Preserve responsibilities and dependency direction. Cross-module changes require the overall architecture and relevant module guide. Do not add unrelated refactoring, dependencies or services.
- Use UTF-8, with no BOM for new files. Preserve existing BOMs and line endings, except Java source and directly related tests, SQL, configuration, deployment scripts and documentation use LF. Do not edit garbled text, generated files or build artifacts.
- Every method must have an accurate responsibility comment. Public APIs and complex methods must document parameters, return values, actual exceptions and side effects. Explain business reasons and boundary outcomes for core logic; do not merely restate the code.
- Apply task-specific security and lifecycle rules. Never place secrets in source, defaults, tests, SQL, logs or documentation. Obtain real credentials from ignored local configuration or controlled environment injection.
- Keep HTTP request/response models separate from persistence objects. Preserve the existing authentication, permission and data-scope contracts; new endpoints must use the appropriate authorization checks.
- In business projects built on this framework, record non-trivial requirement, acceptance, behavior, contract, structure, workflow or rationale changes in the same change set using an [Agent Note](.agents/skills/weetion-doc-archive-agent-notes/SKILL.md#when-to-write-a-note). Preserve the source, evidence, alternatives, affected implementation and verification. Changed decisions need a new cross-linked record. Purely mechanical or local changes without those effects are exempt.
- The framework distribution starts without maintenance Notes. Create records for the business project's own decisions when required; do not copy framework extraction or maintenance history into business documentation.
- Reuse fully read, still-valid context. Read only relevant sections and complete truncated reads without repeating previous output.
- During general repository or documentation discovery, exclude `docs/需求卡/**` from file listings, text searches and automatic linked-document reading. Read only relevant plans/cards when the user explicitly requests them, provides their path, or the current task executes or checks them. From the repository root, add `-g '!docs/需求卡/**'` to `rg` discovery. This is a retrieval rule, not a quality-check exemption.

## Skill Routing

Use only `.agents/skills` and in-project references. Do not search for, read or load external Skills, including indirectly. Report missing Skills and continue feasible work without automatic fallback. Higher-priority instructions or an explicit current user request may override this restriction; explain the source and scope.

Load the applicable Skill for design, changes, tests, reviews or project-dependent architecture analysis. Simple searches, general questions and running existing checks do not automatically load language Skills.

| Task | Skill under `.agents/skills/` |
| --- | --- |
| Java, SQL and related configuration/deployment | [weetion-development-java-standards](.agents/skills/weetion-development-java-standards/SKILL.md) |
| Vue, TypeScript, JavaScript, frontend tests and CRUD | [weetion-development-web-standards](.agents/skills/weetion-development-web-standards/SKILL.md) |
| Code reviews | [weetion-code-review](.agents/skills/weetion-code-review/SKILL.md) |
| Markdown documentation and package READMEs | [weetion-doc](.agents/skills/weetion-doc/SKILL.md) |
| Business decision records | [weetion-doc-archive-agent-notes](.agents/skills/weetion-doc-archive-agent-notes/SKILL.md) |
| Simplification investigations | [weetion-doc-find-simplifications](.agents/skills/weetion-doc-find-simplifications/SKILL.md) |
| Removing authoring-process residue | [weetion-doc-trim-cot-leakage](.agents/skills/weetion-doc-trim-cot-leakage/SKILL.md) |
| Requirement cards, plans and execution | [weetion-task-cards](.agents/skills/weetion-task-cards/SKILL.md) |
| Performance investigation and verification | [weetion-speed-up-perf](.agents/skills/weetion-speed-up-perf/SKILL.md) |

For comments, fully read the Skill's required general and language-specific references. Follow version-controlled tool configuration without weakening requirements. Python files in this repository support quality and delivery tooling; no Python business-service Skill is provided.

## Operational Entry Points

- Dependencies, checks, builds and delivery: consult the [script index](docs/开发指南/脚本使用索引.md) first. When adding, moving or retiring a script, update the index and owning README.
- Development startup: use the owning package README. Confirm the working directory, environment and required variables before starting the application.
- Deployment and offline delivery: use [deployment](docs/部署/部署说明.md) and [offline packaging](docs/部署/构建离线部署包说明.md). Distinguish application artifacts from environment-specific configuration.
- Database initialization and data changes require a verified target and recovery method. Never automatically import a rebuilding SQL file into an existing database.
- Listed commands are not authorization to run them. Checks do not authorize staging, committing, pushing, replacing running services or changing production data.

<a id="required-validation"></a>

## Required Validation

- Before delivering a change, actually run applicable checks and necessary tests from the script index and [testing strategy](docs/测试与可靠性/测试策略.md). Cover normal, critical-boundary and failure behavior. Quality checks do not replace business tests or builds.
- Check the final modified versions: working-tree checks for unstaged content; [pre-commit checks](scripts/workflow/check_staged_quality.py) for staged content. If only staged checks exist, use an isolated snapshot without changing the real index. Empty or stale staging, zero objects and skips do not prove success.
- For checker, hook or central-rule changes, run both relevant tests and actual consumer checks, including changed scan scope. Checker tests alone are insufficient.
- Fix failures introduced by the change and rerun affected checks after further edits. Do not bypass checks, weaken assertions or rules, lower thresholds or hide failures with exclusions.
- Report unrelated failures or missing environments/permissions with their location, affected scope and reason. Do not expand remediation without authorization or mark incomplete checks as passed.
- Report changed files, actual commands, checked scope and versions, exit status or passing counts, failures, skips, unrun checks and remaining risks. Compilation is not a passing test.
