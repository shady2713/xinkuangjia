---
description: "说明独立 PR 验收的受信代码来源、首次引入门禁时的启动方式及版本绑定。"
kind: package-reference
---

# 受信 PR 验收

## 摘要

独立入口从经审核的发布包运行门禁，将结果绑定到 PR 的当前 head、base 和受验合并提交。

## 目录

- [首次发布](#首次发布)
- [运行门禁](#运行门禁)
- [托管承接](#托管承接)

<a id="首次发布"></a>

## 首次发布

首次引入受信门禁时，由独立复核者审查启动器、审查校验器、扫描器和规则路径清单。维护者将同一组已审查文件发布到独立受控位置，并在该位置记录完整提交标识和发布包 SHA-256。首次 PR 使用这个预先批准的发布包，合入后从明确选定的受保护 `main` 提交发布后续版本。批准值来自受控位置。更新门禁时重复此审核和发布流程。基线尚无启动器时同样适用。

<a id="运行门禁"></a>

## 运行门禁

在与候选 CI 分离的环境中校验上方发布包摘要并解包。候选提交被取到新建的裸仓库，仅提供 Git 对象。仓库、目标分支和 PR 编号从受控任务取得。用只读权限从 GitHub 取该 PR 的元数据、分页评论和评审。核对它仍开放、目标仓库与分支一致，且事件 base 等于刚抓取的当前 `main`。取 `refs/pull/<编号>/merge` 的实际 SHA，保留完整历史。GitHub API 的 `pulls/<编号>` 响应可封装为 `{"repository": <base.repo>, "pull_request": <原响应>}`。评论和评审文件使用 `gh api --paginate --slurp` 的分页数组格式。

```bash
python -I "$TRUSTED_ROOT/scripts/workflow/run_trusted_pr_gate.py" \
  --repo "$BARE_REPO" --event "$EVENT_JSON" --checkout-sha "$MERGE_SHA" \
  --comments "$COMMENTS_JSON" --reviews "$REVIEWS_JSON" --mode solo
```

两名及以上维护者按实际协作配置使用 `--mode team` 和重复的 `--maintainer`。启动器校验裸仓库和双亲，并以受信发布包的扫描规则检查实际 PR 提交范围。扫描规则改动也需要独立的 `security-rules` 签收。运行记录包含受信包摘要、PR 编号、base、head、合并 SHA、扫描规则版本和退出结果。重新读取 GitHub 当前版本后再接受或报告结果。base、head 或受验合并提交变化时重新取证。

<a id="托管承接"></a>

## 托管承接

候选 CI 的 `acceptance-proof` 与真实附件作业提供测试证据。维护者从独立入口另外采集权威门禁结果。若启用自动托管合并阻断，维护者选择独立 GitHub App 作为 `trusted-pr-gate` check 的预期发布来源，并开启严格的最新分支检查。只读获取使用 Contents 和 Pull requests 读权限，发布 check 的独立 App 仅按需增加 Checks 写权限。App 凭据保存在受控环境，候选 CI 无权使用。首次配置前先由该 App 报告一次同一合并 SHA 的实际门禁结果，再设置预期来源。相关开关和团队审批配置由维护者核对。 [GitHub 分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) · [GitHub 必过状态来源](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
