# OMP IPython prelude helpers
if "__omp_prelude_loaded__" not in globals():
    __omp_prelude_loaded__ = True
    from pathlib import Path
    import os, sys, re, json, shutil, subprocess, glob, textwrap, inspect
    from datetime import datetime
    from IPython.display import display

    def _emit_status(op: str, **data):
        """Emit structured status event for TUI rendering."""
        display({"application/x-omp-status": {"op": op, **data}}, raw=True)

    def _category(cat: str):
        """Decorator to tag a prelude function with its category."""
        def decorator(fn):
            fn._omp_category = cat
            return fn
        return decorator

    @_category("Navigation")
    def pwd() -> Path:
        """Return current working directory."""
        p = Path.cwd()
        _emit_status("pwd", path=str(p))
        return p

    @_category("Navigation")
    def cd(path: str | Path) -> Path:
        """Change directory."""
        p = Path(path).expanduser().resolve()
        os.chdir(p)
        _emit_status("cd", path=str(p))
        return p

    @_category("Shell")
    def env(key: str | None = None, value: str | None = None):
        """Get/set environment variables."""
        if key is None:
            items = dict(sorted(os.environ.items()))
            _emit_status("env", count=len(items), keys=list(items.keys())[:20])
            return items
        if value is not None:
            os.environ[key] = value
            _emit_status("env", key=key, value=value, action="set")
            return value
        val = os.environ.get(key)
        _emit_status("env", key=key, value=val, action="get")
        return val

    @_category("File I/O")
    def read(path: str | Path, *, offset: int = 1, limit: int | None = None) -> str:
        """Read file contents. offset/limit are 1-indexed line numbers."""
        p = Path(path)
        data = p.read_text(encoding="utf-8")
        lines = data.splitlines(keepends=True)
        if offset > 1 or limit is not None:
            start = max(0, offset - 1)
            end = start + limit if limit else len(lines)
            lines = lines[start:end]
            data = "".join(lines)
        preview = data[:500]
        _emit_status("read", path=str(p), chars=len(data), preview=preview)
        return data

    @_category("File I/O")
    def write(path: str | Path, content: str) -> Path:
        """Write file contents (create parents)."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        _emit_status("write", path=str(p), chars=len(content))
        return p

    @_category("File I/O")
    def append(path: str | Path, content: str) -> Path:
        """Append to file."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(content)
        _emit_status("append", path=str(p), chars=len(content))
        return p

    @_category("File ops")
    def mkdir(path: str | Path) -> Path:
        """Create directory (parents=True)."""
        p = Path(path)
        p.mkdir(parents=True, exist_ok=True)
        _emit_status("mkdir", path=str(p))
        return p

    @_category("File ops")
    def rm(path: str | Path, *, recursive: bool = False) -> None:
        """Delete file or directory (recursive optional)."""
        p = Path(path)
        if p.is_dir():
            if recursive:
                shutil.rmtree(p)
                _emit_status("rm", path=str(p), recursive=True)
                return
            _emit_status("rm", path=str(p), error="directory, use recursive=True")
            return
        if p.exists():
            p.unlink()
            _emit_status("rm", path=str(p))
        else:
            _emit_status("rm", path=str(p), error="missing")

    @_category("File ops")
    def mv(src: str | Path, dst: str | Path) -> Path:
        """Move or rename a file/directory."""
        src_p = Path(src)
        dst_p = Path(dst)
        dst_p.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src_p), str(dst_p))
        _emit_status("mv", src=str(src_p), dst=str(dst_p))
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
        _emit_status("cp", src=str(src_p), dst=str(dst_p))
        return dst_p

    @_category("Navigation")
    def ls(path: str | Path = ".") -> list[Path]:
        """List directory contents."""
        p = Path(path)
        items = sorted(p.iterdir())
        _emit_status("ls", path=str(p), count=len(items), items=[i.name + ("/" if i.is_dir() else "") for i in items[:20]])
        return items

    def _load_gitignore_patterns(base: Path) -> list[str]:
        """Load .gitignore patterns from base directory and parents."""
        patterns: list[str] = []
        # Always exclude these
        patterns.extend(["**/.git", "**/.git/**", "**/node_modules", "**/node_modules/**"])
        # Walk up to find .gitignore files
        current = base.resolve()
        for _ in range(20):  # Limit depth
            gitignore = current / ".gitignore"
            if gitignore.exists():
                try:
                    for line in gitignore.read_text().splitlines():
                        line = line.strip()
                        if line and not line.startswith("#"):
                            # Normalize pattern for fnmatch
                            if line.startswith("/"):
                                patterns.append(str(current / line[1:]))
                            else:
                                patterns.append(f"**/{line}")
                except Exception:
                    pass
            parent = current.parent
            if parent == current:
                break
            current = parent
        return patterns

    def _match_gitignore(path: Path, patterns: list[str], base: Path) -> bool:
        """Check if path matches any gitignore pattern."""
        import fnmatch
        rel = str(path.relative_to(base)) if path.is_relative_to(base) else str(path)
        abs_path = str(path.resolve())
        for pat in patterns:
            if pat.startswith("**/"):
                # Match against any part of the path
                if fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(rel, pat[3:]):
                    return True
                # Also check each path component
                for part in path.parts:
                    if fnmatch.fnmatch(part, pat[3:]):
                        return True
            elif fnmatch.fnmatch(abs_path, pat) or fnmatch.fnmatch(rel, pat):
                return True
        return False

    @_category("Search")
    def find(
        pattern: str,
        path: str | Path = ".",
        *,
        type: str = "file",
        limit: int = 1000,
        hidden: bool = False,
        sort_by_mtime: bool = False,
        maxdepth: int | None = None,
        mindepth: int | None = None,
    ) -> list[Path]:
        """Recursive glob find. Respects .gitignore.
        
        maxdepth/mindepth are relative to path (0 = path itself, 1 = direct children).
        """
        p = Path(path).resolve()
        base_depth = len(p.parts)
        ignore_patterns = _load_gitignore_patterns(p)
        matches: list[Path] = []
        for m in p.rglob(pattern):
            if len(matches) >= limit:
                break
            # Check depth constraints
            rel_depth = len(m.resolve().parts) - base_depth
            if maxdepth is not None and rel_depth > maxdepth:
                continue
            if mindepth is not None and rel_depth < mindepth:
                continue
            # Skip hidden files unless requested
            if not hidden and any(part.startswith(".") for part in m.parts):
                continue
            # Skip gitignored paths
            if _match_gitignore(m, ignore_patterns, p):
                continue
            # Filter by type
            if type == "file" and m.is_dir():
                continue
            if type == "dir" and not m.is_dir():
                continue
            matches.append(m)
        if sort_by_mtime:
            matches.sort(key=lambda x: x.stat().st_mtime, reverse=True)
        else:
            matches.sort()
        _emit_status("find", pattern=pattern, path=str(p), count=len(matches), matches=[str(m) for m in matches[:20]])
        return matches

    @_category("Search")
    def grep(
        pattern: str,
        path: str | Path,
        *,
        ignore_case: bool = False,
        literal: bool = False,
        context: int = 0,
    ) -> list[tuple[int, str]]:
        """Grep a single file. Returns (line_number, text) tuples."""
        p = Path(path)
        lines = p.read_text(encoding="utf-8").splitlines()
        if literal:
            if ignore_case:
                match_fn = lambda line: pattern.lower() in line.lower()
            else:
                match_fn = lambda line: pattern in line
        else:
            flags = re.IGNORECASE if ignore_case else 0
            rx = re.compile(pattern, flags)
            match_fn = lambda line: rx.search(line) is not None
        
        match_lines: set[int] = set()
        for i, line in enumerate(lines, 1):
            if match_fn(line):
                match_lines.add(i)
        
        # Expand with context
        if context > 0:
            expanded: set[int] = set()
            for ln in match_lines:
                for offset in range(-context, context + 1):
                    expanded.add(ln + offset)
            output_lines = sorted(ln for ln in expanded if 1 <= ln <= len(lines))
        else:
            output_lines = sorted(match_lines)
        
        hits = [(ln, lines[ln - 1]) for ln in output_lines]
        _emit_status("grep", pattern=pattern, path=str(p), count=len(match_lines), hits=[{"line": h[0], "text": h[1][:100]} for h in hits[:10]])
        return hits

    @_category("Search")
    def rgrep(
        pattern: str,
        path: str | Path = ".",
        *,
        glob_pattern: str = "*",
        ignore_case: bool = False,
        literal: bool = False,
        limit: int = 100,
        hidden: bool = False,
    ) -> list[tuple[Path, int, str]]:
        """Recursive grep across files matching glob_pattern. Respects .gitignore."""
        if literal:
            if ignore_case:
                match_fn = lambda line: pattern.lower() in line.lower()
            else:
                match_fn = lambda line: pattern in line
        else:
            flags = re.IGNORECASE if ignore_case else 0
            rx = re.compile(pattern, flags)
            match_fn = lambda line: rx.search(line) is not None
        
        base = Path(path)
        ignore_patterns = _load_gitignore_patterns(base)
        hits: list[tuple[Path, int, str]] = []
        for file_path in base.rglob(glob_pattern):
            if len(hits) >= limit:
                break
            if file_path.is_dir():
                continue
            # Skip hidden files unless requested
            if not hidden and any(part.startswith(".") for part in file_path.parts):
                continue
            # Skip gitignored paths
            if _match_gitignore(file_path, ignore_patterns, base):
                continue
            try:
                lines = file_path.read_text(encoding="utf-8").splitlines()
            except Exception:
                continue
            for i, line in enumerate(lines, 1):
                if len(hits) >= limit:
                    break
                if match_fn(line):
                    hits.append((file_path, i, line))
        _emit_status("rgrep", pattern=pattern, path=str(base), count=len(hits), hits=[{"file": str(h[0]), "line": h[1], "text": h[2][:80]} for h in hits[:10]])
        return hits

    @_category("Text")
    def head(text: str, n: int = 10) -> str:
        """Return the first n lines of text."""
        lines = text.splitlines()[:n]
        out = "\n".join(lines)
        _emit_status("head", lines=len(lines), preview=out[:500])
        return out

    @_category("Text")
    def tail(text: str, n: int = 10) -> str:
        """Return the last n lines of text."""
        lines = text.splitlines()[-n:]
        out = "\n".join(lines)
        _emit_status("tail", lines=len(lines), preview=out[:500])
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
        _emit_status("replace", path=str(p), count=count)
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

    def _make_shell_result(proc: subprocess.CompletedProcess[str], cmd: str) -> ShellResult:
        """Create ShellResult and emit status."""
        output = proc.stdout + proc.stderr if proc.stderr else proc.stdout
        _emit_status("sh", cmd=cmd[:80], code=proc.returncode, output=output[:500])
        return ShellResult(proc.stdout, proc.stderr, proc.returncode)

    import signal as _signal

    def _run_with_interrupt(args: list[str], cwd: str | None, timeout: int | None, cmd: str) -> ShellResult:
        """Run subprocess with proper interrupt handling."""
        proc = subprocess.Popen(
            args,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except KeyboardInterrupt:
            os.killpg(proc.pid, _signal.SIGINT)
            try:
                stdout, stderr = proc.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, _signal.SIGKILL)
                stdout, stderr = proc.communicate()
            result = subprocess.CompletedProcess(args, -_signal.SIGINT, stdout, stderr)
            return _make_shell_result(result, cmd)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, _signal.SIGKILL)
            stdout, stderr = proc.communicate()
            result = subprocess.CompletedProcess(args, -_signal.SIGKILL, stdout, stderr)
            return _make_shell_result(result, cmd)
        result = subprocess.CompletedProcess(args, proc.returncode, stdout, stderr)
        return _make_shell_result(result, cmd)

    @_category("Shell")
    def run(cmd: str, *, cwd: str | Path | None = None, timeout: int | None = None) -> ShellResult:
        """Run a shell command."""
        shell_path = shutil.which("bash") or shutil.which("sh") or "/bin/sh"
        args = [shell_path, "-c", cmd]
        return _run_with_interrupt(args, str(cwd) if cwd else None, timeout, cmd)

    @_category("Shell")
    def sh(cmd: str, *, cwd: str | Path | None = None, timeout: int | None = None) -> ShellResult:
        """Run a shell command via user's login shell with environment snapshot."""
        snapshot = os.environ.get("OMP_SHELL_SNAPSHOT")
        prefix = f"source '{snapshot}' 2>/dev/null && " if snapshot else ""
        final = f"{prefix}{cmd}"

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
                return _make_shell_result(proc, cmd)
            raise RuntimeError("No suitable shell found")

        no_login = os.environ.get("OMP_BASH_NO_LOGIN") or os.environ.get("CLAUDE_BASH_NO_LOGIN")
        args = [shell_path, "-c", final] if no_login else [shell_path, "-l", "-c", final]

        return _run_with_interrupt(args, str(cwd) if cwd else None, timeout, cmd)

    @_category("File I/O")
    def cat(*paths: str | Path, separator: str = "\n") -> str:
        """Concatenate multiple files. Like shell cat."""
        parts = []
        for p in paths:
            parts.append(Path(p).read_text(encoding="utf-8"))
        out = separator.join(parts)
        _emit_status("cat", files=len(paths), chars=len(out), preview=out[:500])
        return out

    @_category("File I/O")
    def touch(path: str | Path) -> Path:
        """Create empty file or update mtime."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.touch()
        _emit_status("touch", path=str(p))
        return p

    @_category("Text")
    def wc(text: str) -> dict:
        """Word/line/char count."""
        lines = text.splitlines()
        words = text.split()
        result = {"lines": len(lines), "words": len(words), "chars": len(text)}
        _emit_status("wc", lines=result["lines"], words=result["words"], chars=result["chars"])
        return result

    @_category("Text")
    def sort_lines(text: str, *, reverse: bool = False, unique: bool = False) -> str:
        """Sort lines of text."""
        lines = text.splitlines()
        if unique:
            lines = list(dict.fromkeys(lines))
        lines = sorted(lines, reverse=reverse)
        out = "\n".join(lines)
        _emit_status("sort_lines", lines=len(lines), unique=unique, reverse=reverse)
        return out

    @_category("Text")
    def uniq(text: str, *, count: bool = False) -> str | list[tuple[int, str]]:
        """Remove duplicate adjacent lines (like uniq)."""
        lines = text.splitlines()
        if not lines:
            _emit_status("uniq", groups=0)
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
        _emit_status("uniq", groups=len(groups), count_mode=count)
        if count:
            return groups
        return "\n".join(line for _, line in groups)

    @_category("Text")
    def counter(
        items: str | list,
        *,
        limit: int | None = None,
        reverse: bool = True,
    ) -> list[tuple[int, str]]:
        """Count occurrences and sort by frequency. Like sort | uniq -c | sort -rn.
        
        items: text (splits into lines) or list of strings
        reverse: True for descending (most common first), False for ascending
        Returns: [(count, item), ...] sorted by count
        """
        from collections import Counter
        if isinstance(items, str):
            items = items.splitlines()
        counts = Counter(items)
        sorted_items = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=reverse)
        if limit is not None:
            sorted_items = sorted_items[:limit]
        result = [(count, item) for item, count in sorted_items]
        _emit_status("counter", unique=len(counts), total=sum(counts.values()), top=result[:10])
        return result

    @_category("Text")
    def cols(text: str, *indices: int, sep: str | None = None) -> str:
        """Extract columns from text (0-indexed). Like cut."""
        result_lines = []
        for line in text.splitlines():
            parts = line.split(sep) if sep else line.split()
            selected = [parts[i] for i in indices if i < len(parts)]
            result_lines.append(" ".join(selected))
        out = "\n".join(result_lines)
        _emit_status("cols", lines=len(result_lines), columns=list(indices))
        return out

    @_category("Navigation")
    def basenames(paths: list[str | Path]) -> list[str]:
        """Extract basename from each path. Like: sed 's|.*/||'."""
        names = [Path(p).name for p in paths]
        _emit_status("basenames", count=len(names), sample=names[:10])
        return names

    @_category("Navigation")
    def tree(path: str | Path = ".", *, max_depth: int = 3, show_hidden: bool = False) -> str:
        """Return directory tree."""
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
        _emit_status("tree", path=str(base), entries=len(lines) - 1, preview=out[:1000])
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
        _emit_status("stat", path=str(p), size=s.st_size, is_dir=p.is_dir(), mtime=info["mtime"])
        return info

    @_category("Batch")
    def diff(a: str | Path, b: str | Path) -> str:
        """Compare two files, return unified diff."""
        import difflib
        path_a, path_b = Path(a), Path(b)
        lines_a = path_a.read_text(encoding="utf-8").splitlines(keepends=True)
        lines_b = path_b.read_text(encoding="utf-8").splitlines(keepends=True)
        result = difflib.unified_diff(lines_a, lines_b, fromfile=str(path_a), tofile=str(path_b))
        out = "".join(result)
        _emit_status("diff", file_a=str(path_a), file_b=str(path_b), identical=not out, preview=out[:500])
        return out

    @_category("Search")
    def glob_files(pattern: str, path: str | Path = ".", *, hidden: bool = False) -> list[Path]:
        """Non-recursive glob (use find() for recursive). Respects .gitignore."""
        p = Path(path)
        ignore_patterns = _load_gitignore_patterns(p)
        matches: list[Path] = []
        for m in p.glob(pattern):
            # Skip hidden files unless requested
            if not hidden and m.name.startswith("."):
                continue
            # Skip gitignored paths
            if _match_gitignore(m, ignore_patterns, p):
                continue
            matches.append(m)
        matches = sorted(matches)
        _emit_status("glob", pattern=pattern, path=str(p), count=len(matches), matches=[str(m) for m in matches[:20]])
        return matches

    @_category("Batch")
    def batch(paths: list[str | Path], fn) -> list:
        """Apply function to multiple files. Returns list of results."""
        results = []
        for p in paths:
            result = fn(Path(p))
            results.append(result)
        _emit_status("batch", files=len(paths))
        return results

    @_category("Find/Replace")
    def sed(path: str | Path, pattern: str, repl: str, *, flags: int = 0) -> int:
        """Regex replace in file (like sed -i). Returns count."""
        p = Path(path)
        data = p.read_text(encoding="utf-8")
        new, count = re.subn(pattern, repl, data, flags=flags)
        p.write_text(new, encoding="utf-8")
        _emit_status("sed", path=str(p), count=count)
        return count

    @_category("Find/Replace")
    def rsed(
        pattern: str,
        repl: str,
        path: str | Path = ".",
        *,
        glob_pattern: str = "*",
        flags: int = 0,
        hidden: bool = False,
    ) -> int:
        """Recursive sed across files matching glob_pattern. Respects .gitignore."""
        base = Path(path)
        ignore_patterns = _load_gitignore_patterns(base)
        total = 0
        files_changed = 0
        changed_files = []
        for file_path in base.rglob(glob_pattern):
            if file_path.is_dir():
                continue
            # Skip hidden files unless requested
            if not hidden and any(part.startswith(".") for part in file_path.parts):
                continue
            # Skip gitignored paths
            if _match_gitignore(file_path, ignore_patterns, base):
                continue
            try:
                data = file_path.read_text(encoding="utf-8")
                new, count = re.subn(pattern, repl, data, flags=flags)
                if count > 0:
                    file_path.write_text(new, encoding="utf-8")
                    total += count
                    files_changed += 1
                    if len(changed_files) < 10:
                        changed_files.append({"file": str(file_path), "count": count})
            except Exception:
                continue
        _emit_status("rsed", path=str(base), count=total, files=files_changed, changed=changed_files)
        return total

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
        out = "\n".join(selected)
        _emit_status("lines", path=str(p), start=start, end=end, count=len(selected), preview=out[:500])
        return out

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
        _emit_status("delete_lines", path=str(p), start=start, end=end, count=count)
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
        _emit_status("delete_matching", path=str(p), pattern=pattern, count=count)
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
            pos = "after"
        else:
            idx = line_num - 1
            all_lines = all_lines[:idx] + new_lines + all_lines[idx:]
            pos = "before"
        p.write_text("\n".join(all_lines) + "\n", encoding="utf-8")
        _emit_status("insert_at", path=str(p), line=line_num, lines_inserted=len(new_lines), position=pos)
        return p

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
            _emit_status("git_status", error=err.strip())
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

        clean = not any([result["staged"], result["modified"], result["untracked"]])
        _emit_status("git_status", branch=result["branch"], staged=len(result["staged"]), modified=len(result["modified"]), untracked=len(result["untracked"]), clean=clean, files=result["staged"][:5] + result["modified"][:5])
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
            _emit_status("git_diff", error=err.strip())
            return ""
        lines_count = len(out.splitlines()) if out else 0
        _emit_status("git_diff", staged=staged, ref=ref, lines=lines_count, preview=out[:500])
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
            _emit_status("git_log", error=err.strip())
            return []

        commits = []
        for line in out.strip().splitlines():
            parts = line.split("\x00")
            if len(parts) >= 4:
                commits.append({"sha": parts[0], "subject": parts[1], "author": parts[2], "date": parts[3]})

        _emit_status("git_log", commits=len(commits), entries=[{"sha": c["sha"][:8], "subject": c["subject"][:50]} for c in commits[:5]])
        return commits

    @_category("Git")
    def git_show(ref: str = "HEAD", *, stat: bool = True, cwd: str | Path | None = None) -> dict:
        """Show commit details as {sha, subject, author, date, body, files}."""
        args = ["show", ref, "--format=%H%x00%s%x00%an%x00%aI%x00%b", "--no-patch"]
        code, out, err = _git(*args, cwd=cwd)
        if code != 0:
            _emit_status("git_show", ref=ref, error=err.strip())
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

        _emit_status("git_show", ref=ref, sha=result["sha"][:12], subject=result["subject"][:60], files=len(result["files"]))
        return result

    @_category("Git")
    def git_file_at(ref: str, path: str, *, lines: tuple[int, int] | None = None, cwd: str | Path | None = None) -> str:
        """Get file content at ref. Optional lines=(start, end) for range (1-indexed)."""
        code, out, err = _git("show", f"{ref}:{path}", cwd=cwd)
        if code != 0:
            _emit_status("git_file_at", ref=ref, path=path, error=err.strip())
            return ""

        if lines:
            all_lines = out.splitlines()
            start, end = lines
            start = max(1, start)
            end = min(len(all_lines), end)
            selected = all_lines[start - 1 : end]
            out = "\n".join(selected)
            _emit_status("git_file_at", ref=ref, path=path, start=start, end=end, lines=len(selected))
            return out

        _emit_status("git_file_at", ref=ref, path=path, chars=len(out))
        return out

    @_category("Git")
    def git_branch(*, cwd: str | Path | None = None) -> dict:
        """Get branches: {current, local, remote}."""
        code, out, _ = _git("branch", "-a", "--format=%(refname:short)%00%(HEAD)", cwd=cwd)
        if code != 0:
            _emit_status("git_branch", error="failed to list branches")
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

        _emit_status("git_branch", current=result["current"], local=len(result["local"]), remote=len(result["remote"]), branches=result["local"][:10])
        return result

    @_category("Git")
    def git_has_changes(*, cwd: str | Path | None = None) -> bool:
        """Check if there are uncommitted changes (staged or unstaged)."""
        code, out, _ = _git("status", "--porcelain", cwd=cwd)
        has_changes = bool(out.strip())
        _emit_status("git_has_changes", has_changes=has_changes)
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
