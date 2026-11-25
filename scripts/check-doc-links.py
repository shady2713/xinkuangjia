#!/usr/bin/env python3
"""Check relative link destinations and local anchors in tracked Markdown.

Skips fenced code, inline code, and remote links. Targets must be files tracked
by git or ancestor directories of tracked files (including the repo root).
Anchors are explicit HTML ids and GitHub-style heading anchors. Prints
file:line for each broken link and exits 1 if any are found.
"""
import os
import re
import subprocess
import sys
from urllib.parse import unquote

FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
HEADING = re.compile(r"^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$")
INLINE_LINK = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]*)>?(?:\s+[^)]*)?\)")
REF_DEF = re.compile(r"^ {0,3}\[(?!\^)[^\]]+\]:\s*<?([^\s>]+)")
HTML_ID = re.compile(r"<[^>]*?\b(?:id|name)\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
CODE_SPAN = re.compile(r"(`+).*?\1")
REMOTE = re.compile(r"^(?:[A-Za-z][A-Za-z0-9+.-]*:|//)")
ANCHORS = {}


def scan(path):
    """Yield (line number, raw line, line without code spans) outside fences."""
    fence = None
    with open(path, encoding="utf-8") as handle:
        for number, raw in enumerate(handle, 1):
            raw = raw.rstrip("\n")
            match = FENCE.match(raw)
            if fence:
                if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence):
                    fence = None
                continue
            if match:
                fence = match.group(1)
                continue
            yield number, raw, CODE_SPAN.sub("", raw)


def slugify(text):
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text).strip().lower()
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def anchors(path):
    if path not in ANCHORS:
        found, counts = set(), {}
        for _, raw, line in scan(path):
            found.update(HTML_ID.findall(line))
            heading = HEADING.match(raw)
            if heading:
                slug = slugify(heading.group(1))
                count = counts.get(slug, 0)
                counts[slug] = count + 1
                found.add(slug if count == 0 else f"{slug}-{count}")
        ANCHORS[path] = found
    return ANCHORS[path]


def check(root, rel, files, dirs):
    path = os.path.join(root, rel)
    errors = []
    for number, _, line in scan(path):
        dests = INLINE_LINK.findall(line)
        ref = REF_DEF.match(line)
        if ref:
            dests.append(ref.group(1))
        for dest in dests:
            if not dest or REMOTE.match(dest):
                continue
            target, _, fragment = dest.partition("#")
            target = unquote(target.split("?", 1)[0])
            resolved = path
            if target:
                base = root if target.startswith("/") else os.path.dirname(path)
                resolved = os.path.normpath(os.path.join(base, target.lstrip("/")))
                tracked = os.path.relpath(resolved, root).replace(os.sep, "/")
                if os.path.commonpath([root, resolved]) != root or (tracked not in files and tracked not in dirs):
                    errors.append(f"{rel}:{number}: missing link target {dest}")
                    continue
            fragment = unquote(fragment)
            if fragment and resolved.endswith(".md") and os.path.isfile(resolved):
                known = anchors(resolved)
                if fragment not in known and fragment.lower() not in known:
                    errors.append(f"{rel}:{number}: missing anchor {dest}")
    return errors


def git(*args):
    return subprocess.run(
        ["git", *args],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout


def inventory(root):
    """Return tracked files and their ancestor directories, relative to root."""
    files = set(filter(None, git("-C", root, "ls-files", "-z").split("\0")))
    dirs = {"."}
    for rel in files:
        parts = rel.split("/")
        for i in range(1, len(parts)):
            dirs.add("/".join(parts[:i]))
    return files, dirs


def main():
    root = os.path.normpath(git("rev-parse", "--show-toplevel").strip())
    errors = []
    files, dirs = inventory(root)
    for rel in sorted(path for path in files if path.endswith(".md")):
        errors.extend(check(root, rel, files, dirs))
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        print(f"{len(errors)} broken documentation link(s)", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
