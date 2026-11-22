# Review and Secret Scanning

## Code owner status

`.github/CODEOWNERS` is declared-only. It lists the current repository owner for CI workflows, system auth/security/profile code, backend application config, and SQL. No hosted rule requires code owner review, so a CODEOWNERS match is neither an approval nor a merge block.

A review of those paths counts only when all of the following are true:

1. An authorized reviewer performs it. The reviewer must be independent of the change author and have access to the repository.
2. A written fallback names who reviews when that reviewer is unavailable. Without a fallback, the change waits.
3. The review succeeds for the applicable schema, config, authorization, and CI impact. It must be tied to the exact commit SHA that CI tested. New commits need a new review.

Empty approvals and skipped or bypassed reviews do not count.

## Secret scanning in CI

The `secrets` job in `.github/workflows/ci.yml` does the following:

- Downloads Gitleaks 8.24.2 (Linux x64). It extracts the archive only after the archive matches the pinned SHA256 from the upstream release checksums.
- Checks out the exact event head commit. It validates event commit IDs before passing them to git.
- Scans `base..head` for pull requests and `before..after` for pushes. A new release candidate tag scans commits absent from the fetched main ref. An empty release candidate range scans all commits reachable from the checked-out head. For another new ref, an unavailable main comparison, or a missing push predecessor, it also scans all commits reachable from head. Gitleaks supplies `-p`, and `--diff-merges=first-parent` in `--log-opts` adds each merge commit's diff against its first parent, so the scan covers both merge commits and ordinary commits.
- Runs `gitleaks git --redact=100` without verbose output or reports, which keeps source and finding details out of logs. A nonzero exit fails the job.

A cancelled or skipped `secrets` run is not a passing scan. Do not copy findings into issues, PRs, or logs. Triage them locally.

## Manual full-history verification

First fetch every ref you intend to verify into a full (non-shallow) clone, for example `git fetch --prune --tags origin '+refs/heads/*:refs/remotes/origin/*'`.

The scan itself is read-only. Run the following as a script from the repository root. It writes only to a temporary directory and removes it on exit.

```bash
set -euo pipefail
GITLEAKS_VERSION=8.24.2
GITLEAKS_SHA256=fa0500f6b7e41d28791ebc680f5dd9899cd42b58629218a5f041efa899151a8e
archive="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/download" "$work/bin"
curl -sSfL --proto '=https' --tlsv1.2 -o "$work/download/$archive" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${archive}"
echo "${GITLEAKS_SHA256}  $work/download/$archive" | sha256sum --check --strict --quiet -
tar -xzf "$work/download/$archive" -C "$work/bin" --no-same-owner gitleaks
git rev-parse HEAD
"$work/bin/gitleaks" git --no-banner --redact=100 --log-opts=--all .
```

`--log-opts=--all` scans every commit reachable from any local ref, so refs you did not fetch are not covered. Record the printed SHA with the result. A nonzero exit means findings or a scanner error and must not be ignored.
