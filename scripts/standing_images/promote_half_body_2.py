"""Promote reviewed 半身像-2 images into 半身像, then clear 半身像-2.

The script is dry-run by default. Add ``--execute`` to copy files and delete
the processed source files from ``半身像-2``.

Examples:
  python scripts/standing_images/promote_half_body_2.py --character-dir "1-咲季立绘.1"
  python scripts/standing_images/promote_half_body_2.py --character-dir "1-咲季立绘.1" --execute
  python scripts/standing_images/promote_half_body_2.py --execute --backup-dir "C:\\path\\to\\backup"
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ROOT = REPO_ROOT / "怪文书素材" / "1.立绘"
DEFAULT_SOURCE_SUBDIR = "半身像-2"
DEFAULT_TARGET_SUBDIR = "半身像"
DEFAULT_EXTENSIONS = (".png",)


@dataclass
class PromoteRecord:
    source: str
    target: str
    status: str
    copied: bool = False
    target_existed: bool = False
    source_deleted: bool = False
    backed_up: bool = False
    elapsed_ms: float = 0.0
    message: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Copy reviewed 半身像-2 images into 半身像 without overwriting "
            "existing files, then clear the processed 半身像-2 files."
        )
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help=f"Standing image root. Default: {DEFAULT_ROOT}",
    )
    parser.add_argument(
        "--character-dir",
        action="append",
        type=Path,
        dest="character_dirs",
        help=(
            "Character directory. Accepts either an absolute path or a folder name "
            "relative to --root. Repeat to process more than one. If omitted, all "
            "character directories are processed."
        ),
    )
    parser.add_argument(
        "--source-subdir",
        default=DEFAULT_SOURCE_SUBDIR,
        help=f"Reviewed source subdirectory. Default: {DEFAULT_SOURCE_SUBDIR}",
    )
    parser.add_argument(
        "--target-subdir",
        default=DEFAULT_TARGET_SUBDIR,
        help=f"Promotion target subdirectory. Default: {DEFAULT_TARGET_SUBDIR}",
    )
    parser.add_argument(
        "--extensions",
        default=",".join(DEFAULT_EXTENSIONS),
        help="Comma-separated extensions to process. Default: .png",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Optional backup directory for 半身像-2 files before they are deleted. Used only with --execute.",
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        help="Optional path for a JSON report.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Copy files and clear processed source files. Without this flag, the script only reports.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only print summary and errors.",
    )
    return parser.parse_args()


def parse_extensions(raw: str) -> set[str]:
    extensions: set[str] = set()
    for part in raw.split(","):
        item = part.strip().lower()
        if not item:
            continue
        extensions.add(item if item.startswith(".") else f".{item}")
    return extensions


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def display_path(path: Path, base: Path) -> str:
    try:
        return str(path.relative_to(base))
    except ValueError:
        return str(path)


def is_helper_dir(path: Path) -> bool:
    return path.name.startswith("_") or "_裁剪" in path.name


def iter_character_dirs(root: Path) -> Iterable[Path]:
    for path in sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.name):
        if is_helper_dir(path):
            continue
        yield path


def resolve_character_dirs(root: Path, values: Sequence[Path] | None) -> list[Path]:
    if not values:
        return list(iter_character_dirs(root))

    resolved_dirs: list[Path] = []
    for value in values:
        candidate = value if value.is_absolute() else root / value
        candidate = candidate.resolve()
        if not candidate.is_dir():
            raise ValueError(f"Character directory does not exist: {candidate}")
        if not is_relative_to(candidate, root):
            raise ValueError(f"Character directory must be below root: {candidate}")
        resolved_dirs.append(candidate)
    return resolved_dirs


def collect_source_files(source_dir: Path, extensions: set[str]) -> list[Path]:
    if not source_dir.is_dir():
        return []
    return sorted(
        (path for path in source_dir.iterdir() if path.is_file() and path.suffix.lower() in extensions),
        key=lambda path: path.name,
    )


def backup_source(src: Path, character_dir: Path, source_subdir: str, backup_dir: Path) -> None:
    backup_path = backup_dir / character_dir.name / source_subdir / src.name
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, backup_path)


def promote_one(
    src: Path,
    target: Path,
    character_dir: Path,
    root: Path,
    source_subdir: str,
    execute: bool,
    backup_dir: Path | None,
) -> PromoteRecord:
    start = time.perf_counter()
    record = PromoteRecord(
        source=display_path(src, root),
        target=display_path(target, root),
        status="error",
    )

    try:
        target_exists = target.exists()
        record.target_existed = target_exists

        if execute:
            if backup_dir is not None:
                backup_source(src, character_dir, source_subdir, backup_dir)
                record.backed_up = True

            if target_exists:
                record.status = "skipped_existing"
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, target)
                record.copied = True
                record.status = "copied"

            src.unlink()
            record.source_deleted = True
        else:
            record.status = "would_skip_existing" if target_exists else "would_copy"

        return record
    except Exception as exc:  # pragma: no cover - keep batch runs moving.
        record.status = "error"
        record.message = str(exc)
        return record
    finally:
        record.elapsed_ms = round((time.perf_counter() - start) * 1000, 2)


def write_report(path: Path, records: list[PromoteRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps([asdict(record) for record in records], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def print_record(record: PromoteRecord, quiet: bool) -> None:
    if quiet and record.status not in {"copied", "skipped_existing", "error", "would_copy", "would_skip_existing"}:
        return

    if record.status == "error":
        print(f"[error] {record.source}: {record.message}", file=sys.stderr)
        return

    detail = []
    if record.target_existed:
        detail.append("target exists")
    if record.backed_up:
        detail.append("backed up")
    if record.source_deleted:
        detail.append("source deleted")
    suffix = f" ({', '.join(detail)})" if detail else ""
    print(f"[{record.status}] {record.source} -> {record.target}{suffix}; {record.elapsed_ms:.2f} ms")


def print_summary(records: list[PromoteRecord], dry_run: bool) -> None:
    counts: dict[str, int] = {}
    for record in records:
        counts[record.status] = counts.get(record.status, 0) + 1

    print("")
    print("Summary")
    print(f"  total: {len(records)}")
    for status in sorted(counts):
        print(f"  {status}: {counts[status]}")

    if dry_run and (counts.get("would_copy", 0) or counts.get("would_skip_existing", 0)):
        print("")
        print("Dry-run only. Re-run with --execute when reviewed and ready to promote.")


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        print(f"Root directory does not exist: {root}", file=sys.stderr)
        return 2

    try:
        character_dirs = resolve_character_dirs(root, args.character_dirs)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    extensions = parse_extensions(args.extensions)
    if not extensions:
        print("No extensions configured.", file=sys.stderr)
        return 2

    backup_dir = args.backup_dir.resolve() if args.backup_dir and args.execute else None
    if backup_dir is not None:
        backup_dir.mkdir(parents=True, exist_ok=True)

    records: list[PromoteRecord] = []
    for character_dir in character_dirs:
        source_dir = character_dir / args.source_subdir
        target_dir = character_dir / args.target_subdir
        for src in collect_source_files(source_dir, extensions):
            records.append(
                promote_one(
                    src=src,
                    target=target_dir / src.name,
                    character_dir=character_dir,
                    root=root,
                    source_subdir=args.source_subdir,
                    execute=args.execute,
                    backup_dir=backup_dir,
                )
            )

    if not args.quiet:
        mode = "execute" if args.execute else "dry-run"
        print(f"Mode: {mode}")
        print(f"Root: {root}")
        print(f"Source: {args.source_subdir}")
        print(f"Target: {args.target_subdir}")
        if backup_dir is not None:
            print(f"Backup: {backup_dir}")
        print("")

    for record in records:
        print_record(record, args.quiet)

    if args.report_json:
        write_report(args.report_json, records)
        if not args.quiet:
            print(f"\nReport written: {args.report_json.resolve()}")

    print_summary(records, dry_run=not args.execute)
    return 1 if any(record.status == "error" for record in records) else 0


if __name__ == "__main__":
    raise SystemExit(main())
