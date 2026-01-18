# OMP IPython prelude helpers
if "__omp_prelude_loaded__" not in globals():
    __omp_prelude_loaded__ = True
    from pathlib import Path
    import os, sys, re, json, shutil, subprocess, glob, textwrap, inspect
    from datetime import datetime

    def _category(cat: str):
        """Decorator to tag a prelude function with its category."""
        def decorator(fn):
            fn._omp_category = cat
            return fn
        return decorator

    @_category("Navigation")
    def pwd() -> Path:
        """Print and return current working directory."""
        p = Path.cwd()
        print(str(p))
        return p

    @_category("Navigation")
    def cd(path: str | Path) -> Path:
        """Change directory and print the new cwd."""
        p = Path(path).expanduser().resolve()
        os.chdir(p)
        print(str(p))
        return p

    @_category("Shell")
    def env(key: str | None = None, value: str | None = None):
        """Get/set environment variables."""
        if key is None:
            items = dict(sorted(os.environ.items()))
            for k, v in items.items():
                print(f"{k}={v}")
            print(f"[env] {len(items)} variables")
            return items
        if value is not None:
            os.environ[key] = value
            print(f"{key}={value}")
            return value
        val = os.environ.get(key)
        print(f"{key}={val}")
        return val

    @_category("File I/O")
    def read(path: str | Path, *, limit: int | None = None) -> str:
        """Read file contents. Prints a short preview + length."""
        p = Path(path)
        data = p.read_text(encoding="utf-8")
        if limit is not None:
            preview = data[:limit]
            print(preview)
            print(f"[read {len(data)} chars from {p}]")
        else:
            print(data)
            print(f"[read {len(data)} chars from {p}]")
        return data

    @_category("File I/O")
    def write(path: str | Path, content: str) -> Path:
        """Write file contents (create parents). Prints bytes written."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"[wrote {len(content)} chars to {p}]")
        return p

    @_category("File I/O")
    def append(path: str | Path, content: str) -> Path:
        """Append to file. Prints bytes appended."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(content)
        print(f"[appended {len(content)} chars to {p}]")
        return p

    @_category("File ops")
    def mkdir(path: str | Path) -> Path:
        """Create directory (parents=True)."""
        p = Path(path)
        p.mkdir(parents=True, exist_ok=True)
        print(f"[mkdir] {p}")
        return p

    @_category("File ops")
    def rm(path: str | Path, *, recursive: bool = False) -> None:
        """Delete file or directory (recursive optional)."""
        p = Path(path)
        if p.is_dir():
            if recursive:
                shutil.rmtree(p)
                print(f"[rm -r] {p}")
                return
            print(f"[rm] {p} (directory, use recursive=True)")
            return
        if p.exists():
            p.unlink()
            print(f"[rm] {p}")
        else:
            print(f"[rm] {p} (missing)")

    @_category("File ops")
    def mv(src: str | Path, dst: str | Path) -> Path:
        """Move or rename a file/directory."""
        src_p = Path(src)
        dst_p = Path(dst)
        dst_p.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src_p), str(dst_p))
        print(f"[mv] {src_p} -> {dst_p}")
        return dst_p

    @_category("File ops")
    def cp(src: str | Path, dst: str | Path) -> Path:
        """Copy a file or directory."""
        src_p = Path(src)
        dst_p = Path(dst)
        dst_p.parent.mkdir(parents=True, exist_ok=True)
        if src_p.is_dir():
            shutil.copytree(src_p, dst_p, dirs_exist_ok=True)
        else:
            shutil.copy2(src_p, dst_p)
        print(f"[cp] {src_p} -> {dst_p}")
        return dst_p

    @_category("Navigation")
    def ls(path: str | Path = ".") -> list[Path]:
        """List directory contents."""
        p = Path(path)
        items = sorted(p.iterdir())
        for item in items:
            suffix = "/" if item.is_dir() else ""
            print(f"{item.name}{suffix}")
        print(f"[ls] {len(items)} entries in {p}")
        return items

    @_category("Search")
    def find(pattern: str, path: str | Path = ".", *, files_only: bool = True) -> list[Path]:
        """Recursive glob find. Defaults to files only."""
        p = Path(path)
        matches = []
        for m in p.rglob(pattern):
            if files_only and m.is_dir():
                continue
            matches.append(m)
        matches = sorted(matches)
        for m in matches:
            print(str(m))
        print(f"[find] {len(matches)} matches for '{pattern}' in {p}")
        return matches

    @_category("Search")
    def grep(pattern: str, path: str | Path, *, ignore_case: bool = False, context: int = 0) -> list[tuple[int, str]]:
        """Grep a single file."""
        flags = re.IGNORECASE if ignore_case else 0
        rx = re.compile(pattern, flags)
        p = Path(path)
        lines = p.read_text(encoding="utf-8").splitlines()
        hits: list[tuple[int, str]] = []
        for i, line in enumerate(lines, 1):
            if rx.search(line):
                hits.append((i, line))
                print(f"{i}: {line}")
                if context:
                    start = max(0, i - 1 - context)
                    end = min(len(lines), i - 1 + context + 1)
                    for j in range(start, end):
                        if j + 1 == i:
                            continue
                        print(f"{j+1}- {lines[j]}")
        print(f"[grep] {len(hits)} matches in {p}")
        return hits

    @_category("Search")
    def rgrep(pattern: str, path: str | Path = ".", *, glob_pattern: str = "*", ignore_case: bool = False) -> list[tuple[Path, int, str]]:
        """Recursive grep across files matching glob_pattern."""
        flags = re.IGNORECASE if ignore_case else 0
        rx = re.compile(pattern, flags)
        base = Path(path)
        hits: list[tuple[Path, int, str]] = []
        for file_path in base.rglob(glob_pattern):
            if file_path.is_dir():
                continue
            try:
                lines = file_path.read_text(encoding="utf-8").splitlines()
            except Exception:
                continue
            for i, line in enumerate(lines, 1):
                if rx.search(line):
                    hits.append((file_path, i, line))
                    print(f"{file_path}:{i}: {line}")
        print(f"[rgrep] {len(hits)} matches in {base}")
        return hits

    @_category("Text")
    def head(text: str, n: int = 10) -> str:
        """Return the first n lines of text."""
        lines = text.splitlines()[:n]
        out = "\n".join(lines)
        print(out)
        print(f"[head] {len(lines)} lines")
        return out

    @_category("Text")
    def tail(text: str, n: int = 10) -> str:
        """Return the last n lines of text."""
        lines = text.splitlines()[-n:]
        out = "\n".join(lines)
        print(out)
        print(f"[tail] {len(lines)} lines")
        return out

    @_category("Find/Replace")
    def replace(path: str | Path, pattern: str, repl: str, *, regex: bool = False) -> int:
        """Replace text in a file (regex optional)."""
        p = Path(path)
        data = p.read_text(encoding="utf-8")
        if regex:
            new, count = re.subn(pattern, repl, data)
        else:
            new = data.replace(pattern, repl)
            count = data.count(pattern)
        p.write_text(new, encoding="utf-8")
        print(f"[replace] {count} replacements in {p}")
        return count

    class ShellResult:
        """Result from shell command execution."""
        __slots__ = ("stdout", "stderr", "code")
        def __init__(self, stdout: str, stderr: str, code: int):
            self.stdout = stdout
            self.stderr = stderr
            self.code = code
        def __repr__(self):
            if self.code == 0:
                return ""
            return f"exit code {self.code}"
        def __bool__(self):
            return self.code == 0

    def _make_shell_result(proc: subprocess.CompletedProcess[str]) -> ShellResult:
        """Create ShellResult and print output."""
        if proc.stdout:
            print(proc.stdout, end="" if proc.stdout.endswith("\n") else "\n")
        if proc.stderr:
            print(proc.stderr, end="" if proc.stderr.endswith("\n") else "\n")
        return ShellResult(proc.stdout, proc.stderr, proc.returncode)

    @_category("Shell")
    def run(cmd: str, *, cwd: str | Path | None = None, timeout: int | None = None) -> ShellResult:
        """Run a shell command and print stdout/stderr."""
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return _make_shell_result(proc)

    @_category("Shell")
    def sh(cmd: str, *, cwd: str | Path | None = None, timeout: int | None = None) -> ShellResult:
        """Run a shell command via user's login shell with environment snapshot."""
        snapshot = os.environ.get("OMP_SHELL_SNAPSHOT")
        prefix = f"source '{snapshot}' 2>/dev/null && " if snapshot else ""
        final = f"{prefix}{cmd}"

        # Determine shell and args (mirroring shell.ts logic)
        shell_path = os.environ.get("SHELL")
        if not shell_path or not shutil.which(shell_path):
            shell_path = shutil.which("bash") or shutil.which("zsh") or shutil.which("sh")

        if not shell_path:
            if sys.platform.startswith("win"):
                proc = subprocess.run(
                    ["cmd", "/c", cmd],
                    cwd=str(cwd) if cwd else None,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                )
                return _make_shell_result(proc)
            raise RuntimeError("No suitable shell found")

        no_login = os.environ.get("OMP_BASH_NO_LOGIN") or os.environ.get("CLAUDE_BASH_NO_LOGIN")
        args = [shell_path, "-c", final] if no_login else [shell_path, "-l", "-c", final]

        proc = subprocess.run(
            args,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return _make_shell_result(proc)

    # --- Extended shell-like utilities ---

    @_category("File I/O")
    def cat(*paths: str | Path, separator: str = "\n") -> str:
        """Concatenate multiple files and print. Like shell cat."""
        parts = []
        for p in paths:
            parts.append(Path(p).read_text(encoding="utf-8"))
        out = separator.join(parts)
        print(out)
        print(f"[cat] {len(paths)} files, {len(out)} chars")
        return out

    @_category("File I/O")
    def touch(path: str | Path) -> Path:
        """Create empty file or update mtime."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.touch()
        print(f"[touch] {p}")
        return p

    @_category("Text")
    def wc(text: str) -> dict:
        """Word/line/char count."""
        lines = text.splitlines()
        words = text.split()
        result = {"lines": len(lines), "words": len(words), "chars": len(text)}
        print(f"{result['lines']} lines, {result['words']} words, {result['chars']} chars")
        return result

    @_category("Text")
    def sort_lines(text: str, *, reverse: bool = False, unique: bool = False) -> str:
        """Sort lines of text."""
        lines = text.splitlines()
        if unique:
            lines = list(dict.fromkeys(lines))
        lines = sorted(lines, reverse=reverse)
        out = "\n".join(lines)
        print(out)
        return out

    @_category("Text")
    def uniq(text: str, *, count: bool = False) -> str | list[tuple[int, str]]:
        """Remove duplicate adjacent lines (like uniq)."""
        lines = text.splitlines()
        if not lines:
            return [] if count else ""
        groups: list[tuple[int, str]] = []
        current = lines[0]
        current_count = 1
        for line in lines[1:]:
            if line == current:
                current_count += 1
                continue
            groups.append((current_count, current))
            current = line
            current_count = 1
        groups.append((current_count, current))
        if count:
            for c, l in groups:
                print(f"{c:>4} {l}")
            return groups
        out = "\n".join(line for _, line in groups)
        print(out)
        return out

    @_category("Text")
    def cols(text: str, *indices: int, sep: str | None = None) -> str:
        """Extract columns from text (0-indexed). Like cut."""
        result_lines = []
        for line in text.splitlines():
            parts = line.split(sep) if sep else line.split()
            selected = [parts[i] for i in indices if i < len(parts)]
            result_lines.append(" ".join(selected))
        out = "\n".join(result_lines)
        print(out)
        return out

    @_category("Navigation")
    def tree(path: str | Path = ".", *, max_depth: int = 3, show_hidden: bool = False) -> str:
        """Print directory tree."""
        base = Path(path)
        lines = []
        def walk(p: Path, prefix: str, depth: int):
            if depth > max_depth:
                return
            items = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
            items = [i for i in items if show_hidden or not i.name.startswith(".")]
            for i, item in enumerate(items):
                is_last = i == len(items) - 1
                connector = "└── " if is_last else "├── "
                suffix = "/" if item.is_dir() else ""
                lines.append(f"{prefix}{connector}{item.name}{suffix}")
                if item.is_dir():
                    ext = "    " if is_last else "│   "
                    walk(item, prefix + ext, depth + 1)
        lines.append(str(base) + "/")
        walk(base, "", 1)
        out = "\n".join(lines)
        print(out)
        return out

    @_category("Navigation")
    def stat(path: str | Path) -> dict:
        """Get file/directory info."""
        p = Path(path)
        s = p.stat()
        info = {
            "path": str(p),
            "size": s.st_size,
            "is_file": p.is_file(),
            "is_dir": p.is_dir(),
            "mtime": datetime.fromtimestamp(s.st_mtime).isoformat(),
            "mode": oct(s.st_mode),
        }
        for k, v in info.items():
            print(f"{k}: {v}")
        return info

    @_category("Batch")
    def diff(a: str | Path, b: str | Path) -> str:
        """Compare two files, print unified diff."""
        import difflib
        path_a, path_b = Path(a), Path(b)
        lines_a = path_a.read_text(encoding="utf-8").splitlines(keepends=True)
        lines_b = path_b.read_text(encoding="utf-8").splitlines(keepends=True)
        result = difflib.unified_diff(lines_a, lines_b, fromfile=str(path_a), tofile=str(path_b))
        out = "".join(result)
        if out:
            print(out)
        else:
            print("[diff] files are identical")
        return out

    @_category("Search")
    def glob_files(pattern: str, path: str | Path = ".") -> list[Path]:
        """Non-recursive glob (use find() for recursive)."""
        p = Path(path)
        matches = sorted(p.glob(pattern))
        for m in matches:
            print(str(m))
        print(f"[glob] {len(matches)} matches")
        return matches

    @_category("Batch")
    def batch(paths: list[str | Path], fn) -> list:
        """Apply function to multiple files. Returns list of results."""
        results = []
        for p in paths:
            result = fn(Path(p))
            results.append(result)
        print(f"[batch] processed {len(paths)} files")
        return results

    @_category("Find/Replace")
    def sed(path: str | Path, pattern: str, repl: str, *, flags: int = 0) -> int:
        """Regex replace in file (like sed -i). Returns count."""
        p = Path(path)
        data = p.read_text(encoding="utf-8")
        new, count = re.subn(pattern, repl, data, flags=flags)
        p.write_text(new, encoding="utf-8")
        print(f"[sed] {count} replacements in {p}")
        return count

    @_category("Find/Replace")
    def rsed(pattern: str, repl: str, path: str | Path = ".", *, glob_pattern: str = "*", flags: int = 0) -> int:
        """Recursive sed across files matching glob_pattern."""
        base = Path(path)
        total = 0
        for file_path in base.rglob(glob_pattern):
            if file_path.is_dir():
                continue
            try:
                data = file_path.read_text(encoding="utf-8")
                new, count = re.subn(pattern, repl, data, flags=flags)
                if count > 0:
                    file_path.write_text(new, encoding="utf-8")
                    print(f"{file_path}: {count} replacements")
                    total += count
            except Exception:
                continue
        print(f"[rsed] {total} total replacements")
        return total

    # --- Line-based operations (sed-like) ---

    @_category("Line ops")
    def lines(path: str | Path, start: int = 1, end: int | None = None) -> str:
        """Extract line range from file (1-indexed, inclusive). Like sed -n 'N,Mp'."""
        p = Path(path)
        all_lines = p.read_text(encoding="utf-8").splitlines()
        if end is None:
            end = len(all_lines)
        start = max(1, start)
        end = min(len(all_lines), end)
        selected = all_lines[start - 1 : end]
        out = "\n".join(f"{start + i}: {line}" for i, line in enumerate(selected))
        print(out)
        print(f"[lines] {start}-{end} ({len(selected)} lines) from {p}")
        return "\n".join(selected)

    @_category("Line ops")
    def delete_lines(path: str | Path, start: int, end: int | None = None) -> int:
        """Delete line range from file (1-indexed, inclusive). Like sed -i 'N,Md'."""
        p = Path(path)
        all_lines = p.read_text(encoding="utf-8").splitlines()
        if end is None:
            end = start
        start = max(1, start)
        end = min(len(all_lines), end)
        count = end - start + 1
        new_lines = all_lines[: start - 1] + all_lines[end:]
        p.write_text("\n".join(new_lines) + ("\n" if all_lines else ""), encoding="utf-8")
        print(f"[delete_lines] removed lines {start}-{end} ({count} lines) from {p}")
        return count

    @_category("Line ops")
    def delete_matching(path: str | Path, pattern: str, *, regex: bool = True) -> int:
        """Delete lines matching pattern. Like sed -i '/pattern/d'."""
        p = Path(path)
        all_lines = p.read_text(encoding="utf-8").splitlines()
        if regex:
            rx = re.compile(pattern)
            new_lines = [l for l in all_lines if not rx.search(l)]
        else:
            new_lines = [l for l in all_lines if pattern not in l]
        count = len(all_lines) - len(new_lines)
        p.write_text("\n".join(new_lines) + ("\n" if all_lines else ""), encoding="utf-8")
        print(f"[delete_matching] removed {count} lines matching '{pattern}' from {p}")
        return count

    @_category("Line ops")
    def insert_at(path: str | Path, line_num: int, text: str, *, after: bool = True) -> Path:
        """Insert text at line. after=True (sed 'Na\\'), after=False (sed 'Ni\\')."""
        p = Path(path)
        all_lines = p.read_text(encoding="utf-8").splitlines()
        new_lines = text.splitlines()
        line_num = max(1, min(len(all_lines) + 1, line_num))
        if after:
            idx = min(line_num, len(all_lines))
            all_lines = all_lines[:idx] + new_lines + all_lines[idx:]
            pos = "after" if line_num <= len(all_lines) - len(new_lines) else "at end"
        else:
            idx = line_num - 1
            all_lines = all_lines[:idx] + new_lines + all_lines[idx:]
            pos = "before"
        p.write_text("\n".join(all_lines) + "\n", encoding="utf-8")
        print(f"[insert_at] inserted {len(new_lines)} lines {pos} line {line_num} in {p}")
        return p

    # --- Git helpers ---

    def _git(*args: str, cwd: str | Path | None = None) -> tuple[int, str, str]:
        """Run git command, return (returncode, stdout, stderr)."""
        result = subprocess.run(
            ["git", *args],
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stdout, result.stderr

    @_category("Git")
    def git_status(*, cwd: str | Path | None = None) -> dict:
        """Get structured git status: {branch, staged, modified, untracked, ahead, behind}."""
        code, out, err = _git("status", "--porcelain=v2", "--branch", cwd=cwd)
        if code != 0:
            print(f"[git_status] error: {err.strip()}")
            return {}

        result: dict = {"branch": None, "staged": [], "modified": [], "untracked": [], "ahead": 0, "behind": 0}
        for line in out.splitlines():
            if line.startswith("# branch.head "):
                result["branch"] = line.split(" ", 2)[2]
            elif line.startswith("# branch.ab "):
                parts = line.split()
                for p in parts[2:]:
                    if p.startswith("+"):
                        result["ahead"] = int(p[1:])
                    elif p.startswith("-"):
                        result["behind"] = int(p[1:])
            elif line.startswith("1 ") or line.startswith("2 "):
                parts = line.split(" ", 8)
                xy = parts[1]
                path = parts[-1]
                if xy[0] != ".":
                    result["staged"].append(path)
                if xy[1] != ".":
                    result["modified"].append(path)
            elif line.startswith("? "):
                result["untracked"].append(line[2:])

        # Pretty print
        print(f"branch: {result['branch']}", end="")
        if result["ahead"] or result["behind"]:
            print(f" (+{result['ahead']}/-{result['behind']})", end="")
        print()
        if result["staged"]:
            print(f"staged ({len(result['staged'])}):")
            for f in result["staged"][:10]:
                print(f"  + {f}")
            if len(result["staged"]) > 10:
                print(f"  ... and {len(result['staged']) - 10} more")
        if result["modified"]:
            print(f"modified ({len(result['modified'])}):")
            for f in result["modified"][:10]:
                print(f"  M {f}")
            if len(result["modified"]) > 10:
                print(f"  ... and {len(result['modified']) - 10} more")
        if result["untracked"]:
            print(f"untracked ({len(result['untracked'])}):")
            for f in result["untracked"][:5]:
                print(f"  ? {f}")
            if len(result["untracked"]) > 5:
                print(f"  ... and {len(result['untracked']) - 5} more")
        if not any([result["staged"], result["modified"], result["untracked"]]):
            print("working tree clean")
        return result

    @_category("Git")
    def git_diff(
        *paths: str,
        staged: bool = False,
        ref: str | None = None,
        stat: bool = False,
        cwd: str | Path | None = None,
    ) -> str:
        """Show git diff. staged=True for --cached, ref for commit comparison."""
        args = ["diff"]
        if stat:
            args.append("--stat")
        if staged:
            args.append("--cached")
        if ref:
            args.append(ref)
        if paths:
            args.append("--")
            args.extend(paths)
        code, out, err = _git(*args, cwd=cwd)
        if code != 0:
            print(f"[git_diff] error: {err.strip()}")
            return ""
        print(out)
        return out

    @_category("Git")
    def git_log(
        n: int = 10,
        *,
        oneline: bool = True,
        ref_range: str | None = None,
        paths: list[str] | None = None,
        cwd: str | Path | None = None,
    ) -> list[dict]:
        """Get git log as list of {sha, subject, author, date}."""
        fmt = "%H%x00%s%x00%an%x00%aI" if not oneline else "%h%x00%s%x00%an%x00%aI"
        args = ["log", f"-{n}", f"--format={fmt}"]
        if ref_range:
            args.append(ref_range)
        if paths:
            args.append("--")
            args.extend(paths)
        code, out, err = _git(*args, cwd=cwd)
        if code != 0:
            print(f"[git_log] error: {err.strip()}")
            return []

        commits = []
        for line in out.strip().splitlines():
            parts = line.split("\x00")
            if len(parts) >= 4:
                commits.append({"sha": parts[0], "subject": parts[1], "author": parts[2], "date": parts[3]})

        # Pretty print
        for c in commits:
            date_short = c["date"][:10]
            print(f"{c['sha'][:8]} {date_short} {c['subject'][:60]}")
        print(f"[git_log] {len(commits)} commits")
        return commits

    @_category("Git")
    def git_show(ref: str = "HEAD", *, stat: bool = True, cwd: str | Path | None = None) -> dict:
        """Show commit details as {sha, subject, author, date, body, files}."""
        args = ["show", ref, "--format=%H%x00%s%x00%an%x00%aI%x00%b", "--no-patch"]
        code, out, err = _git(*args, cwd=cwd)
        if code != 0:
            print(f"[git_show] error: {err.strip()}")
            return {}

        parts = out.strip().split("\x00")
        result = {
            "sha": parts[0] if len(parts) > 0 else "",
            "subject": parts[1] if len(parts) > 1 else "",
            "author": parts[2] if len(parts) > 2 else "",
            "date": parts[3] if len(parts) > 3 else "",
            "body": parts[4].strip() if len(parts) > 4 else "",
            "files": [],
        }

        if stat:
            _, stat_out, _ = _git("show", ref, "--stat", "--format=", cwd=cwd)
            result["files"] = [l.strip() for l in stat_out.strip().splitlines() if l.strip()]

        # Pretty print
        print(f"commit {result['sha'][:12]}")
        print(f"Author: {result['author']}")
        print(f"Date:   {result['date']}")
        print(f"\n    {result['subject']}")
        if result["body"]:
            for line in result["body"].splitlines()[:5]:
                print(f"    {line}")
        if result["files"]:
            print()
            for f in result["files"][-5:]:
                print(f"  {f}")
        return result

    @_category("Git")
    def git_file_at(ref: str, path: str, *, lines: tuple[int, int] | None = None, cwd: str | Path | None = None) -> str:
        """Get file content at ref. Optional lines=(start, end) for range (1-indexed)."""
        code, out, err = _git("show", f"{ref}:{path}", cwd=cwd)
        if code != 0:
            print(f"[git_file_at] error: {err.strip()}")
            return ""

        if lines:
            all_lines = out.splitlines()
            start, end = lines
            start = max(1, start)
            end = min(len(all_lines), end)
            selected = all_lines[start - 1 : end]
            out = "\n".join(f"{start + i}: {line}" for i, line in enumerate(selected))
            print(out)
            print(f"[git_file_at] {ref}:{path} lines {start}-{end}")
            return "\n".join(selected)

        print(out)
        print(f"[git_file_at] {ref}:{path} ({len(out)} chars)")
        return out

    @_category("Git")
    def git_branch(*, cwd: str | Path | None = None) -> dict:
        """Get branches: {current, local, remote}."""
        code, out, _ = _git("branch", "-a", "--format=%(refname:short)%00%(HEAD)", cwd=cwd)
        if code != 0:
            return {"current": None, "local": [], "remote": []}

        result: dict = {"current": None, "local": [], "remote": []}
        for line in out.strip().splitlines():
            parts = line.split("\x00")
            name = parts[0]
            is_current = len(parts) > 1 and parts[1] == "*"
            if is_current:
                result["current"] = name
            if name.startswith("remotes/") or "/" in name and not name.startswith("feature/"):
                result["remote"].append(name)
            else:
                result["local"].append(name)
                if is_current:
                    result["current"] = name

        print(f"* {result['current']}")
        for b in result["local"]:
            if b != result["current"]:
                print(f"  {b}")
        if result["remote"]:
            print(f"  ({len(result['remote'])} remote branches)")
        return result

    @_category("Git")
    def git_has_changes(*, cwd: str | Path | None = None) -> bool:
        """Check if there are uncommitted changes (staged or unstaged)."""
        code, out, _ = _git("status", "--porcelain", cwd=cwd)
        has_changes = bool(out.strip())
        print(f"[git_has_changes] {'yes' if has_changes else 'no'}")
        return has_changes

    def __omp_prelude_docs__() -> list[dict[str, str]]:
        """Return prelude helper docs for templating. Discovers functions by _omp_category attribute."""
        helpers: list[dict[str, str]] = []
        for name, obj in globals().items():
            if not callable(obj) or not hasattr(obj, "_omp_category"):
                continue
            signature = str(inspect.signature(obj))
            doc = inspect.getdoc(obj) or ""
            docline = doc.splitlines()[0] if doc else ""
            helpers.append({
                "name": name,
                "signature": signature,
                "docstring": docline,
                "category": obj._omp_category,
            })
        return sorted(helpers, key=lambda h: (h["category"], h["name"]))
