"""Trim fully transparent outer edges from standing image assets.

The script is dry-run by default. Add ``--execute`` to overwrite the
original files.

Examples:
  python scripts/standing_images/trim_alpha_edges.py
  python scripts/standing_images/trim_alpha_edges.py --execute
  python scripts/standing_images/trim_alpha_edges.py --subdir 七分像
  python scripts/standing_images/trim_alpha_edges.py --execute --backup-dir "C:\\path\\to\\backup"
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence

try:
    from PIL import Image, UnidentifiedImageError
except ImportError:  # pragma: no cover - exercised only on machines without Pillow.
    Image = None  # type: ignore[assignment]
    UnidentifiedImageError = OSError  # type: ignore[assignment]


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ROOT = REPO_ROOT / "怪文书素材" / "1.立绘"
DEFAULT_SUBDIRS = ("半身像", "七分像")
DEFAULT_EXTENSIONS = (".png",)


@dataclass
class TrimRecord:
    path: str
    status: str
    original_size: str | None = None
    cropped_size: str | None = None
    removed_left: int | None = None
    removed_top: int | None = None
    removed_right: int | None = None
    removed_bottom: int | None = None
    elapsed_ms: float = 0.0
    message: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Trim transparent outer edges from images under each character "
            "folder's 半身像 and 七分像 directories."
        )
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help=f"Standing image root. Default: {DEFAULT_ROOT}",
    )
    parser.add_argument(
        "--subdir",
        action="append",
        dest="subdirs",
        help="Target subdirectory name. Repeat to process more than one. Default: 半身像 and 七分像.",
    )
    parser.add_argument(
        "--character-dir",
        action="append",
        type=Path,
        dest="character_dirs",
        help=(
            "Process only this character directory. Accepts either an absolute path "
            "or a folder name relative to --root. Repeat to process more than one."
        ),
    )
    parser.add_argument(
        "--extensions",
        default=",".join(DEFAULT_EXTENSIONS),
        help="Comma-separated extensions to process. Default: .png",
    )
    parser.add_argument(
        "--alpha-threshold",
        type=int,
        default=0,
        help=(
            "Pixels with alpha greater than this value count as content. "
            "Default: 0, meaning only fully transparent edges are removed."
        ),
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Also process images in nested folders below each target subdirectory.",
    )
    parser.add_argument(
        "--include-helper-dirs",
        action="store_true",
        help="Include folders whose names start with '_' or contain '_裁剪'.",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Optional backup directory. Used only with --execute; preserves paths below --root.",
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        help="Optional path for a JSON report.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Overwrite original files. Without this flag, the script only reports planned trims.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only print the summary and errors.",
    )
    args = parser.parse_args()

    if not 0 <= args.alpha_threshold <= 255:
        parser.error("--alpha-threshold must be between 0 and 255")

    return args


def parse_extensions(raw: str) -> set[str]:
    extensions: set[str] = set()
    for part in raw.split(","):
        item = part.strip().lower()
        if not item:
            continue
        extensions.add(item if item.startswith(".") else f".{item}")
    return extensions


def display_path(path: Path, base: Path) -> str:
    try:
        return str(path.relative_to(base))
    except ValueError:
        return str(path)


def is_helper_dir(path: Path) -> bool:
    return path.name.startswith("_") or "_裁剪" in path.name


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def resolve_character_dirs(root: Path, values: Sequence[Path] | None) -> list[Path] | None:
    if not values:
        return None

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


def iter_character_dirs(root: Path, include_helper_dirs: bool) -> Iterable[Path]:
    for path in sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.name):
        if not include_helper_dirs and is_helper_dir(path):
            continue
        yield path


def iter_target_dirs(
    root: Path,
    subdirs: Iterable[str],
    include_helper_dirs: bool,
    character_dirs: Sequence[Path] | None,
) -> Iterable[Path]:
    candidates = character_dirs or list(iter_character_dirs(root, include_helper_dirs))
    for character_dir in candidates:
        for subdir in subdirs:
            target = character_dir / subdir
            if target.is_dir():
                yield target


def iter_images(target_dirs: Iterable[Path], extensions: set[str], recursive: bool) -> Iterable[Path]:
    for target_dir in target_dirs:
        candidates = target_dir.rglob("*") if recursive else target_dir.iterdir()
        for path in sorted(candidates, key=lambda p: str(p)):
            if path.is_file() and path.suffix.lower() in extensions:
                yield path


def has_alpha_channel(image: Image.Image) -> bool:
    return "A" in image.getbands() or image.info.get("transparency") is not None


def threshold_alpha(alpha: Image.Image, threshold: int) -> Image.Image:
    if threshold <= 0:
        return alpha
    return alpha.point(lambda value: 255 if value > threshold else 0)


def save_rgba_atomically(cropped: Image.Image, original: Image.Image, destination: Path) -> None:
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{destination.stem}.",
        suffix=destination.suffix,
        dir=str(destination.parent),
    )
    os.close(fd)
    tmp_path = Path(tmp_name)

    save_kwargs: dict[str, object] = {"format": original.format or "PNG"}
    for key in ("icc_profile", "dpi"):
        if key in original.info:
            save_kwargs[key] = original.info[key]

    try:
        cropped.save(tmp_path, **save_kwargs)
        os.replace(tmp_path, destination)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def backup_original(src: Path, root: Path, backup_dir: Path) -> None:
    backup_path = backup_dir / src.relative_to(root)
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, backup_path)


def trim_image(
    path: Path,
    root: Path,
    alpha_threshold: int,
    execute: bool,
    backup_dir: Path | None,
) -> TrimRecord:
    start = time.perf_counter()
    record = TrimRecord(path=display_path(path, root), status="error")

    try:
        with Image.open(path) as image:
            width, height = image.size
            record.original_size = f"{width}x{height}"

            if not has_alpha_channel(image):
                record.status = "skipped"
                record.message = "no alpha channel"
                return record

            rgba = image.convert("RGBA")
            alpha = threshold_alpha(rgba.getchannel("A"), alpha_threshold)
            bbox = alpha.getbbox()

            if bbox is None:
                record.status = "skipped"
                record.message = "fully transparent image"
                return record

            left, top, right, bottom = bbox
            if bbox == (0, 0, width, height):
                record.status = "unchanged"
                record.message = "no transparent outer edge"
                return record

            cropped = rgba.crop(bbox)
            record.cropped_size = f"{cropped.width}x{cropped.height}"
            record.removed_left = left
            record.removed_top = top
            record.removed_right = width - right
            record.removed_bottom = height - bottom

            if execute:
                if backup_dir is not None:
                    backup_original(path, root, backup_dir)
                save_rgba_atomically(cropped, image, path)
                record.status = "trimmed"
            else:
                record.status = "would_trim"

            return record
    except UnidentifiedImageError:
        record.status = "skipped"
        record.message = "not a readable image"
        return record
    except Exception as exc:  # pragma: no cover - keep batch runs moving.
        record.status = "error"
        record.message = str(exc)
        return record
    finally:
        record.elapsed_ms = round((time.perf_counter() - start) * 1000, 2)


def print_record(record: TrimRecord, quiet: bool) -> None:
    if quiet and record.status not in {"error", "would_trim", "trimmed"}:
        return

    if record.status in {"would_trim", "trimmed"}:
        print(
            f"[{record.status}] {record.path}: "
            f"{record.original_size} -> {record.cropped_size}; "
            f"remove L{record.removed_left} T{record.removed_top} "
            f"R{record.removed_right} B{record.removed_bottom}; "
            f"{record.elapsed_ms:.2f} ms"
        )
    elif record.status == "error":
        print(f"[error] {record.path}: {record.message}", file=sys.stderr)
    elif not quiet:
        print(f"[{record.status}] {record.path}: {record.message}")


def write_report(path: Path, records: list[TrimRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [asdict(record) for record in records]
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def print_summary(records: list[TrimRecord], dry_run: bool) -> None:
    counts: dict[str, int] = {}
    for record in records:
        counts[record.status] = counts.get(record.status, 0) + 1

    print("")
    print("Summary")
    print(f"  total: {len(records)}")
    for status in sorted(counts):
        print(f"  {status}: {counts[status]}")

    if dry_run and counts.get("would_trim", 0):
        print("")
        print("Dry-run only. Re-run with --execute when you are ready to overwrite files.")


def main() -> int:
    if Image is None:
        print("Pillow is required. Install it with: python -m pip install Pillow", file=sys.stderr)
        return 2

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

    subdirs = args.subdirs or list(DEFAULT_SUBDIRS)
    extensions = parse_extensions(args.extensions)
    if not extensions:
        print("No extensions configured.", file=sys.stderr)
        return 2

    backup_dir = args.backup_dir.resolve() if args.backup_dir and args.execute else None
    if backup_dir is not None:
        backup_dir.mkdir(parents=True, exist_ok=True)

    target_dirs = list(
        iter_target_dirs(
            root=root,
            subdirs=subdirs,
            include_helper_dirs=args.include_helper_dirs,
            character_dirs=character_dirs,
        )
    )
    images = list(iter_images(target_dirs, extensions, args.recursive))

    if not args.quiet:
        mode = "execute" if args.execute else "dry-run"
        print(f"Mode: {mode}")
        print(f"Root: {root}")
        if character_dirs:
            print("Character dirs:")
            for character_dir in character_dirs:
                print(f"  {display_path(character_dir, root)}")
        print(f"Subdirs: {', '.join(subdirs)}")
        print(f"Extensions: {', '.join(sorted(extensions))}")
        if backup_dir is not None:
            print(f"Backup: {backup_dir}")
        print("")

    records = [
        trim_image(
            path=path,
            root=root,
            alpha_threshold=args.alpha_threshold,
            execute=args.execute,
            backup_dir=backup_dir,
        )
        for path in images
    ]

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
