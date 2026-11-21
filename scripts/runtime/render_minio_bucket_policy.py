#!/usr/bin/env python3
"""生成 MinIO 桶的匿名访问策略，供部署与隔离开发共用。

Modes:
  mixed    Anonymous s3:GetObject on every object, then an explicit Deny for
           the reserved first key segment "private" in all 128 letter-case
           spellings (exact, "private/*" and "private *") and for keys starting with
           a space (reserved).
  private  Whole-private bucket: one explicit anonymous Deny of s3:GetObject on
           every object and no Allow; applied with set-json like mixed mode.

MinIO evaluates bucket policies for anonymous requests only; signed (SigV4)
requests are authorized by IAM policies. Output is compact JSON on stdout and
must stay under MinIO's 20 KiB bucket policy limit; rendering fails closed.

Usage:
  python -B -X utf8 scripts/runtime/render_minio_bucket_policy.py --bucket basic-framework --mode mixed
  python -B -X utf8 scripts/runtime/render_minio_bucket_policy.py --bucket basic-framework --mode private

@author Claude Code
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import sys

sys.dont_write_bytecode = True

POLICY_VERSION = "2012-10-17"
MODES = ("mixed", "private")
PRIVATE_SEGMENT = "private"
# MinIO rejects bucket policies larger than 20 KiB.
MAX_POLICY_BYTES = 20 * 1024
# S3 bucket naming: 3-63 chars of lowercase letters, digits, '.' and '-'.
BUCKET_PATTERN = re.compile(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]")
ANONYMOUS_PRINCIPAL = {"AWS": ["*"]}


class PolicyError(ValueError):
    """报告无法安全生成桶策略的输入或大小问题。"""


def case_variants(word: str) -> list[str]:
    """枚举保留目录名的大小写组合，保持策略输出稳定。

    Args:
        word: ASCII word.
    Returns:
        2 ** len(word) spellings when every character is a letter.
    """
    choices = [sorted({char.lower(), char.upper()}) for char in word]
    return ["".join(combo) for combo in itertools.product(*choices)]


def private_resources(bucket: str) -> list[str]:
    """构造匿名读取须拒绝的保留首段和对象键范围。

    Args:
        bucket: Validated bucket name.
    Returns:
        Exact, "/*" and " *" ARNs for every spelling of the private segment, plus
        the reserved leading-space key range.
    """
    base = f"arn:aws:s3:::{bucket}/"
    resources: list[str] = []
    for spelling in case_variants(PRIVATE_SEGMENT):
        resources.append(base + spelling)
        resources.append(base + spelling + "/*")
        # A trailing space also covers older trimmed exact names ("private ").
        resources.append(base + spelling + " *")
    # Keys starting with a space are reserved (e.g. " private/...").
    resources.append(base + " *")
    return resources


def render_policy(bucket: str, mode: str) -> dict:
    """按桶名和访问模式生成结构化策略。

    Args:
        bucket: Bucket name.
        mode: "mixed" or "private".
    Returns:
        Policy document as a dict.
    Raises:
        PolicyError: If the mode or bucket name is invalid.
    """
    if mode not in MODES:
        raise PolicyError(f"unsupported mode {mode!r}; expected one of: {', '.join(MODES)}")
    if not BUCKET_PATTERN.fullmatch(bucket) or ".." in bucket:
        raise PolicyError(f"invalid bucket name {bucket!r}; use 3-63 lowercase letters, digits, '.' or '-'")
    if mode == "private":
        # Explicit anonymous Deny with no Allow; signed requests remain authorized by IAM.
        deny_all = {"Sid": "DenyAnonymousGetObject", "Effect": "Deny", "Principal": ANONYMOUS_PRINCIPAL,
                    "Action": ["s3:GetObject"], "Resource": [f"arn:aws:s3:::{bucket}/*"]}
        return {"Version": POLICY_VERSION, "Statement": [deny_all]}
    return {
        "Version": POLICY_VERSION,
        "Statement": [
            {
                "Sid": "AnonymousGetObject",
                "Effect": "Allow",
                "Principal": ANONYMOUS_PRINCIPAL,
                "Action": ["s3:GetObject"],
                "Resource": [f"arn:aws:s3:::{bucket}/*"],
            },
            {
                "Sid": "DenyAnonymousReservedKeys",
                "Effect": "Deny",
                "Principal": ANONYMOUS_PRINCIPAL,
                "Action": ["s3:GetObject"],
                "Resource": private_resources(bucket),
            },
        ],
    }


def render_policy_json(bucket: str, mode: str) -> str:
    """输出紧凑策略 JSON 并校验 MinIO 的策略大小上限。

    Args:
        bucket: Bucket name.
        mode: "mixed" or "private".
    Returns:
        Policy JSON text.
    Raises:
        PolicyError: If inputs are invalid or the policy exceeds MAX_POLICY_BYTES.
    """
    text = json.dumps(render_policy(bucket, mode), separators=(",", ":"), ensure_ascii=True) + "\n"
    size = len(text.encode("utf-8"))
    if size > MAX_POLICY_BYTES:
        raise PolicyError(
            f"policy for bucket {bucket!r} is {size} bytes, over MinIO's {MAX_POLICY_BYTES}-byte "
            "limit; use a shorter MINIO_BUCKET or --mode private"
        )
    return text


def main(argv: list[str] | None = None) -> int:
    """解析参数并向标准输出写入无凭据的桶策略。

    Args:
        argv: Arguments without the program name; defaults to sys.argv[1:].
    Returns:
        Process exit code (2 on a rendering error).
    """
    parser = argparse.ArgumentParser(description="Render the MinIO anonymous bucket policy to stdout.")
    parser.add_argument("--bucket", default="basic-framework", help="bucket name (default: basic-framework)")
    parser.add_argument("--mode", choices=MODES, default="mixed", help="mixed (default) or private")
    args = parser.parse_args(argv)
    try:
        sys.stdout.write(render_policy_json(args.bucket, args.mode))
    except PolicyError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
