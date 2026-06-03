#!/usr/bin/env python3
"""Agentkodex PTY session worker.

This helper intentionally uses only Python stdlib so Agentkodex can provide a real
pseudo-terminal runtime without mandatory native npm dependencies.
"""

import argparse
import errno
import fcntl
import json
import os
import pty
import re
import select
import signal
import sys
import time
from datetime import datetime, timezone

ANSI_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
SECRET_PATTERNS = [
    (re.compile(r"sk-[A-Za-z0-9_-]{12,}"), "[REDACTED_OPENAI_STYLE_KEY]"),
    (re.compile(r"ghp_[A-Za-z0-9_]{20,}"), "[REDACTED_GITHUB_TOKEN]"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{20,}"), "[REDACTED_SLACK_TOKEN]"),
    (re.compile(r"((?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|DATABASE_URL|API_KEY|SECRET|TOKEN|PASSWORD)=)[^\s]+", re.I), r"\1[REDACTED]"),
    (re.compile(r"-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----"), "[REDACTED_PRIVATE_KEY]"),
]


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def redact(text):
    value = text or ""
    for pattern, replacement in SECRET_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def strip_ansi(text):
    return ANSI_RE.sub("", text or "")


def atomic_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    os.replace(tmp, path)


def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return fallback


def append_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8", errors="replace") as handle:
        handle.write(text)
        handle.flush()


def append_event(path, event):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    event = {"ts": now(), **event}
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
        handle.flush()


def set_nonblocking(fd):
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


def detect_state(buffer):
    text = strip_ansi(buffer)[-12000:]
    last = "\n".join(text.splitlines()[-30:])
    if re.search(r"\b(approve|approval|permission|allow)\b[^\n]{0,160}\b(command|tool|edit|write|run|execute|install|modify)\b", last, re.I):
        return "awaiting_approval"
    if re.search(r"\b(y/n|yes/no|\[y/n\]|\[Y/n\]|\[y/N\])\b", last, re.I):
        return "awaiting_approval"
    if re.search(r"\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|jest|vitest|playwright|cypress|cargo test|go test)\b", last, re.I):
        return "tests_running"
    if re.search(r"\b(error|failed|failure|exception|traceback|panic|exit code [1-9])\b", last, re.I):
        return "error_visible"
    if re.search(r"\b(done|complete|completed|success|succeeded|all tests passed|task complete)\b", last, re.I):
        return "completed_signal"
    return "running"


class Worker:
    def __init__(self, args):
        self.args = args
        self.session_dir = os.path.abspath(args.session_dir)
        self.transcript = os.path.join(self.session_dir, "transcript.log")
        self.events = os.path.join(self.session_dir, "events.jsonl")
        self.status_file = args.status_file or os.path.join(self.session_dir, "session.json")
        self.fifo = os.path.join(self.session_dir, "input.fifo")
        self.child_pid = None
        self.master_fd = None
        self.fifo_fd = None
        self.exit_code = None
        self.exit_signal = None
        self.recent = ""
        self.stop_requested = False

    def update_status(self, **patch):
        existing = read_json(self.status_file, {})
        payload = {
            **existing,
            **patch,
            "updatedAt": now(),
            "helperPid": os.getpid(),
            "childPid": self.child_pid,
            "inputFifo": self.fifo,
            "transcriptFile": self.transcript,
            "eventsFile": self.events,
            "statusFile": self.status_file,
        }
        atomic_json(self.status_file, payload)

    def setup_fifo(self):
        os.makedirs(self.session_dir, exist_ok=True)
        try:
            if os.path.exists(self.fifo) and not os.path.exists(f"{self.fifo}.keep"):
                os.remove(self.fifo)
        except OSError:
            pass
        if not os.path.exists(self.fifo):
            os.mkfifo(self.fifo, 0o600)
        self.fifo_fd = os.open(self.fifo, os.O_RDWR | os.O_NONBLOCK)

    def spawn_child(self):
        pid, fd = pty.fork()
        if pid == 0:
            try:
                os.chdir(self.args.cwd)
                env = os.environ.copy()
                if self.args.env_file:
                    try:
                        with open(self.args.env_file, "r", encoding="utf-8") as handle:
                            env.update(json.load(handle))
                    except Exception:
                        pass
                shell = env.get("SHELL") or "/bin/sh"
                os.execvpe(shell, [shell, "-lc", self.args.command], env)
            except Exception as exc:  # pragma: no cover - child failure path
                os.write(2, f"Agentkodex PTY child failed: {exc}\n".encode())
                os._exit(127)
        self.child_pid = pid
        self.master_fd = fd
        set_nonblocking(self.master_fd)

    def write_initial_input(self):
        if not self.args.initial_input_file:
            return
        try:
            with open(self.args.initial_input_file, "r", encoding="utf-8") as handle:
                text = handle.read()
        except Exception:
            text = ""
        if not text:
            return
        if not text.endswith("\n"):
            text += "\n"
        try:
            os.write(self.master_fd, text.encode("utf-8", errors="replace"))
            append_event(self.events, {"type": "input", "source": "initial", "bytes": len(text)})
        except OSError:
            pass

    def handle_signal(self, signum, _frame):
        self.stop_requested = True
        append_event(self.events, {"type": "signal", "signal": signum})
        self.update_status(status="stopping", state="stopping")
        self.terminate_child(signal.SIGTERM)

    def terminate_child(self, sig):
        if not self.child_pid:
            return
        try:
            os.killpg(self.child_pid, sig)
        except OSError:
            try:
                os.kill(self.child_pid, sig)
            except OSError:
                pass

    def read_master(self):
        try:
            data = os.read(self.master_fd, 8192)
        except OSError as exc:
            if exc.errno in (errno.EIO, errno.EBADF):
                return False
            return True
        if not data:
            return False
        text = redact(data.decode("utf-8", errors="replace"))
        append_text(self.transcript, text)
        append_event(self.events, {"type": "output", "stream": "pty", "text": text})
        self.recent = (self.recent + text)[-20000:]
        state = detect_state(self.recent)
        self.update_status(status="running", state=state, lastOutputAt=now())
        return True

    def read_fifo(self):
        try:
            data = os.read(self.fifo_fd, 8192)
        except BlockingIOError:
            return
        except OSError:
            return
        if not data:
            return
        try:
            os.write(self.master_fd, data)
            append_event(self.events, {"type": "input", "source": "fifo", "bytes": len(data), "preview": redact(data.decode("utf-8", errors="replace"))[-500:]})
        except OSError:
            pass

    def poll_exit(self):
        if not self.child_pid:
            return False
        try:
            done_pid, status = os.waitpid(self.child_pid, os.WNOHANG)
        except ChildProcessError:
            return True
        if done_pid == 0:
            return False
        if os.WIFEXITED(status):
            self.exit_code = os.WEXITSTATUS(status)
            self.exit_signal = None
        elif os.WIFSIGNALED(status):
            self.exit_code = None
            self.exit_signal = os.WTERMSIG(status)
        else:
            self.exit_code = None
            self.exit_signal = None
        return True

    def run(self):
        os.makedirs(self.session_dir, exist_ok=True)
        signal.signal(signal.SIGTERM, self.handle_signal)
        signal.signal(signal.SIGINT, self.handle_signal)
        self.setup_fifo()
        append_text(self.transcript, f"\n$ {self.args.command}\n")
        append_event(self.events, {"type": "start", "command": self.args.command, "cwd": self.args.cwd})
        self.spawn_child()
        self.update_status(status="running", state="starting", startedAt=now())
        time.sleep(0.15)
        self.write_initial_input()

        child_exited = False
        master_open = True
        while master_open:
            read_fds = [self.master_fd, self.fifo_fd]
            try:
                readable, _, _ = select.select(read_fds, [], [], 0.25)
            except OSError:
                readable = []
            if self.master_fd in readable:
                master_open = self.read_master()
            if self.fifo_fd in readable:
                self.read_fifo()
            if not child_exited:
                child_exited = self.poll_exit()
            if child_exited:
                # Give the PTY a short grace period to flush remaining output.
                try:
                    more, _, _ = select.select([self.master_fd], [], [], 0.1)
                    if self.master_fd in more:
                        master_open = self.read_master()
                        continue
                except OSError:
                    pass
                break

        if not child_exited:
            child_exited = self.poll_exit()
        if self.exit_code is None and self.exit_signal is None and self.stop_requested:
            self.exit_signal = signal.SIGTERM

        exit_text = f"\n[exit {self.exit_code if self.exit_code is not None else 'null'}"
        if self.exit_signal is not None:
            exit_text += f" signal {self.exit_signal}"
        exit_text += "]\n"
        append_text(self.transcript, exit_text)
        append_event(self.events, {"type": "exit", "exitCode": self.exit_code, "signal": self.exit_signal})
        final_status = "completed" if self.exit_code == 0 and self.exit_signal is None else "failed"
        if self.stop_requested:
            final_status = "stopped"
        self.update_status(status=final_status, state=final_status, endedAt=now(), exitCode=self.exit_code, signal=self.exit_signal)
        try:
            os.close(self.master_fd)
        except Exception:
            pass
        try:
            os.close(self.fifo_fd)
        except Exception:
            pass


def parse_args():
    parser = argparse.ArgumentParser(description="Agentkodex PTY worker")
    parser.add_argument("--session-dir", required=True)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--command", required=True)
    parser.add_argument("--status-file", default="")
    parser.add_argument("--initial-input-file", default="")
    parser.add_argument("--env-file", default="")
    return parser.parse_args()


def main():
    args = parse_args()
    worker = Worker(args)
    worker.run()


if __name__ == "__main__":
    main()
