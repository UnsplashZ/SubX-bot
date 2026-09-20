#!/usr/bin/env python3
"""Two-phase directory-fd atomic writer used by ConfigWriter."""

import argparse
import ctypes
import errno
import hashlib
import os
import secrets
import stat
import sys


def fail(code):
    sys.stderr.write(f"{code}\n")
    raise SystemExit(2)


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--dir-fd", type=int, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--mode", required=True)
    parser.add_argument("--size", type=int, required=True)
    parser.add_argument("--expected-sha256")
    return parser.parse_args()


def assert_safe_name(name):
    if not name or name in (".", "..") or "/" in name or "\\" in name or "\x00" in name:
        fail("CONFIG_ATOMIC_NAME_INVALID")


def assert_safe_existing(dir_fd, name):
    try:
        value = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(value.st_mode):
        fail("CONFIG_ATOMIC_TARGET_NOT_REGULAR")
    if value.st_nlink != 1:
        fail("CONFIG_ATOMIC_TARGET_LINK_UNSAFE")
    return value


def read_revision(dir_fd, name):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(name, flags, dir_fd=dir_fd)
    except FileNotFoundError:
        return None
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            fail("CONFIG_ATOMIC_TARGET_NOT_REGULAR")
        if before.st_nlink != 1:
            fail("CONFIG_ATOMIC_TARGET_LINK_UNSAFE")
        digest = hashlib.sha256()
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
        after = os.fstat(fd)
        identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_nlink)
        if identity != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_nlink):
            fail("CONFIG_ATOMIC_TARGET_CHANGED")
        return identity, digest.hexdigest()
    finally:
        os.close(fd)


NOREPLACE_FALLBACK_ERRNOS = {
    errno.EINVAL,  # Docker Desktop Windows bind mounts (virtiofs/gRPC-FUSE/9p)
    errno.ENOSYS,
    getattr(errno, "EOPNOTSUPP", errno.EINVAL),
    getattr(errno, "ENOTSUP", errno.EINVAL),
    errno.EPERM,
}


def fallback_rename(dir_fd, source, destination):
    # 文件系统不支持 renameat2(RENAME_NOREPLACE) 时的降级路径：
    # 先用存在性检查尽力保留 no-clobber 语义（存在 TOCTOU 残余风险，共享盘上无法避免），
    # 再退回普通 rename。其余安全检查（dir_fd 锚定、内容哈希、fsync、mode）均保留。
    try:
        os.stat(destination, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        pass
    else:
        raise OSError(errno.EEXIST, os.strerror(errno.EEXIST), source, destination)
    sys.stderr.write("CONFIG_ATOMIC_NOREPLACE_FALLBACK\n")
    os.rename(source, destination, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)


def rename_noreplace(dir_fd, source, destination):
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform.startswith("linux"):
        operation = libc.renameat2
        result = operation(dir_fd, source.encode(), dir_fd, destination.encode(), 1)
    elif sys.platform == "darwin":
        operation = libc.renameatx_np
        result = operation(dir_fd, source.encode(), dir_fd, destination.encode(), 4)
    else:
        fail("CONFIG_ATOMIC_NOREPLACE_UNSUPPORTED")
    if result != 0:
        value = ctypes.get_errno()
        if value in NOREPLACE_FALLBACK_ERRNOS:
            fallback_rename(dir_fd, source, destination)
            return
        raise OSError(value, os.strerror(value), source, destination)


def publish_noreplace(dir_fd, source, destination):
    rename_noreplace(dir_fd, source, destination)


def safe_unlink(dir_fd, name):
    try:
        os.unlink(name, dir_fd=dir_fd)
    except FileNotFoundError:
        pass


def unlink_if_revision(dir_fd, name, expected):
    current = read_revision(dir_fd, name)
    if current is None:
        return
    if current != expected:
        fail("CONFIG_ATOMIC_RECOVERY_REQUIRED")
    safe_unlink(dir_fd, name)


def read_exact(size):
    remaining = size
    chunks = []
    while remaining:
        chunk = sys.stdin.buffer.read(min(1024 * 1024, remaining))
        if not chunk:
            fail("CONFIG_ATOMIC_INPUT_TRUNCATED")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def main():
    args = parse_args()
    assert_safe_name(args.name)
    if args.size < 0:
        fail("CONFIG_ATOMIC_SIZE_INVALID")
    try:
        mode = int(args.mode, 8)
    except ValueError:
        fail("CONFIG_ATOMIC_MODE_INVALID")
    if mode < 0 or mode > 0o777:
        fail("CONFIG_ATOMIC_MODE_INVALID")

    dir_fd = args.dir_fd
    directory = os.fstat(dir_fd)
    if not stat.S_ISDIR(directory.st_mode):
        fail("CONFIG_ATOMIC_DIRECTORY_REQUIRED")
    claim_prefix = f".{args.name}.atomic-claim."
    claim_names = [entry for entry in os.listdir(dir_fd) if entry.startswith(claim_prefix)]
    if len(claim_names) > 1:
        fail("CONFIG_ATOMIC_RECOVERY_REQUIRED")
    if claim_names:
        recovered_claim = claim_names[0]
        existing_claim = read_revision(dir_fd, recovered_claim)
        claimed_hash = recovered_claim[len(claim_prefix):]
        if existing_claim is None or claimed_hash != existing_claim[1]:
            fail("CONFIG_ATOMIC_RECOVERY_REQUIRED")
        current = read_revision(dir_fd, args.name)
        if current is None:
            try:
                publish_noreplace(dir_fd, recovered_claim, args.name)
            except OSError as error:
                if error.errno != errno.EEXIST:
                    raise
                pass
        else:
            unlink_if_revision(dir_fd, recovered_claim, existing_claim)
        os.fsync(dir_fd)
    initial_revision = read_revision(dir_fd, args.name)
    if args.expected_sha256 and (initial_revision is None or initial_revision[1] != args.expected_sha256):
        fail("CONFIG_ATOMIC_TARGET_CHANGED")
    claim_suffix = args.expected_sha256 or (initial_revision[1] if initial_revision is not None else "absent")
    claim_name = f"{claim_prefix}{claim_suffix}"

    temp_name = f".{args.name}.{os.getpid()}.{secrets.token_hex(8)}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    temp_fd = None
    installed = False
    try:
        temp_fd = os.open(temp_name, flags, mode, dir_fd=dir_fd)
        data = read_exact(args.size)
        view = memoryview(data)
        while view:
            written = os.write(temp_fd, view)
            view = view[written:]
        os.fchmod(temp_fd, mode)
        os.fsync(temp_fd)
        os.close(temp_fd)
        temp_fd = None
        sys.stdout.write(f"READY {temp_name}\n")
        sys.stdout.flush()

        command = sys.stdin.buffer.readline(32).decode("ascii", "strict").strip()
        if command == "ABORT":
            return
        if command != "COMMIT":
            fail("CONFIG_ATOMIC_COMMAND_INVALID")

        if initial_revision is not None:
            try:
                rename_noreplace(dir_fd, args.name, claim_name)
            except OSError as error:
                if error.errno in (errno.ENOENT, errno.EEXIST):
                    fail("CONFIG_ATOMIC_TARGET_CHANGED")
                raise
            os.fsync(dir_fd)
            claim_revision = read_revision(dir_fd, claim_name)
            if claim_revision != initial_revision or (args.expected_sha256 and claim_revision[1] != args.expected_sha256):
                try:
                    publish_noreplace(dir_fd, claim_name, args.name)
                except OSError as error:
                    if error.errno != errno.EEXIST:
                        raise
                fail("CONFIG_ATOMIC_TARGET_CHANGED")

        injected = os.environ.get("BILI_CONFIG_ATOMIC_TEST_EXTERNAL_REVISION")
        if injected is not None:
            fd = os.open(args.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode, dir_fd=dir_fd)
            try:
                os.write(fd, injected.encode())
                os.fsync(fd)
            finally:
                os.close(fd)

        try:
            publish_noreplace(dir_fd, temp_name, args.name)
        except OSError as error:
            if error.errno != errno.EEXIST:
                raise
            if initial_revision is not None:
                unlink_if_revision(dir_fd, claim_name, claim_revision)
            os.fsync(dir_fd)
            fail("CONFIG_ATOMIC_TARGET_CHANGED")
        installed = True
        if os.environ.get("BILI_CONFIG_ATOMIC_TEST_CRASH_AFTER_PUBLISH") == "1":
            os._exit(91)
        if initial_revision is not None:
            unlink_if_revision(dir_fd, claim_name, claim_revision)
        target_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        target_fd = os.open(args.name, target_flags, dir_fd=dir_fd)
        try:
            target = os.fstat(target_fd)
            if not stat.S_ISREG(target.st_mode) or target.st_nlink != 1:
                fail("CONFIG_ATOMIC_TARGET_UNSAFE")
            os.fchmod(target_fd, mode)
            os.fsync(target_fd)
        finally:
            os.close(target_fd)
        os.fsync(dir_fd)
        sys.stdout.write("COMMITTED\n")
        sys.stdout.flush()
    finally:
        if temp_fd is not None:
            os.close(temp_fd)
        if not installed:
            safe_unlink(dir_fd, temp_name)


if __name__ == "__main__":
    main()
