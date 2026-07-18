"""Generate 半身像-2 images from 七分像 by applying an example crop ratio.

The script is dry-run by default. Add ``--execute`` to write files into
``半身像-2``.

Examples:
  python scripts/standing_images/generate_half_body_2.py --character-dir "1-咲季立绘.1"
  python scripts/standing_images/generate_half_body_2.py --character-dir "1-咲季立绘.1" --execute
  python scripts/standing_images/generate_half_body_2.py --character-dir "1-咲季立绘.1" --example 开心.png --execute
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
from typing import Sequence

try:
    from PIL import Image, ImageChops, UnidentifiedImageError
except ImportError:  # pragma: no cover - exercised only on machines without Pillow.
    Image = None  # type: ignore[assignment]
    ImageChops = None  # type: ignore[assignment]
    UnidentifiedImageError = OSError  # type: ignore[assignment]


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ROOT = REPO_ROOT / "怪文书素材" / "1.立绘"
SOURCE_SUBDIR = "七分像"
OUTPUT_SUBDIR = "半身像-2"
DEFAULT_EXTENSIONS = (".png",)


@dataclass
class ExampleInfo:
    character_dir: str
    example_name: str
    source_size: str
    example_size: str
    width_same: bool
    keep_height_ratio: float
    bottom_crop_ratio: float
    bottom_crop_pixels: int
    exact_top_crop_match: bool
    diff_bbox: tuple[int, int, int, int] | None


@dataclass
class CropRecord:
    source: str
    output: str
    status: str
    original_size: str
    bottom_cropped_size: str | None = None
    cropped_size: str | None = None
    crop_bottom_pixels: int | None = None
    alpha_trimmed: bool = False
    alpha_trim_removed_left: int = 0
    alpha_trim_removed_top: int = 0
    alpha_trim_removed_right: int = 0
    alpha_trim_removed_bottom: int = 0
    elapsed_ms: float = 0.0
    message: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Use a sample in 半身像-2 and its same-name 七分像 source to infer "
            "a bottom-crop ratio, then apply it to all 七分像 images."
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
        type=Path,
        required=True,
        help="Character directory. Accepts either an absolute path or a folder name relative to --root.",
    )
    parser.add_argument(
        "--example",
        help="Example file name in 半身像-2. If omitted, exactly one same-name example must exist.",
    )
    parser.add_argument(
        "--extensions",
        default=",".join(DEFAULT_EXTENSIONS),
        help="Comma-separated source extensions to process. Default: .png",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Optional backup directory for existing 半身像-2 files. Used only with --execute.",
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        help="Optional path for a JSON report.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Write files into 半身像-2. Without this flag, the script only reports planned outputs.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only print the summary and errors.",
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


def resolve_character_dir(root: Path, value: Path) -> Path:
    candidate = value if value.is_absolute() else root / value
    candidate = candidate.resolve()
    if not candidate.is_dir():
        raise ValueError(f"Character directory does not exist: {candidate}")
    if not is_relative_to(candidate, root):
        raise ValueError(f"Character directory must be below root: {candidate}")
    return candidate


def collect_sources(source_dir: Path, extensions: set[str]) -> list[Path]:
    return sorted(
        (path for path in source_dir.iterdir() if path.is_file() and path.suffix.lower() in extensions),
        key=lambda path: path.name,
    )


def find_example(output_dir: Path, source_dir: Path, example_name: str | None) -> Path:
    if example_name:
        example = output_dir / example_name
        source = source_dir / example_name
        if not example.is_file():
            raise ValueError(f"Example does not exist in {OUTPUT_SUBDIR}: {example}")
        if not source.is_file():
            raise ValueError(f"Same-name source does not exist in {SOURCE_SUBDIR}: {source}")
        return example

    matches = sorted(
        (path for path in output_dir.iterdir() if path.is_file() and (source_dir / path.name).is_file()),
        key=lambda path: path.name,
    )
    if not matches:
        raise ValueError(f"No same-name example found between {output_dir} and {source_dir}")
    if len(matches) > 1:
        names = ", ".join(path.name for path in matches)
        raise ValueError(f"Multiple same-name examples found; pass --example. Candidates: {names}")
    return matches[0]


def compare_example(character_dir: Path, root: Path, example_path: Path) -> ExampleInfo:
    source_path = character_dir / SOURCE_SUBDIR / example_path.name
    with Image.open(example_path) as example_image, Image.open(source_path) as source_image:
        example = example_image.convert("RGBA")
        source = source_image.convert("RGBA")
        if example.height > source.height:
            raise ValueError(
                f"Example is taller than source: {example_path.name} "
                f"{example.height}px vs {source.height}px"
            )

        width_same = example.width == source.width
        if width_same:
            top_crop = source.crop((0, 0, example.width, example.height))
            diff = ImageChops.difference(example, top_crop)
            diff_bbox = diff.getbbox()
        else:
            diff_bbox = None
        keep_height_ratio = example.height / source.height

        return ExampleInfo(
            character_dir=display_path(character_dir, root),
            example_name=example_path.name,
            source_size=f"{source.width}x{source.height}",
            example_size=f"{example.width}x{example.height}",
            width_same=width_same,
            keep_height_ratio=keep_height_ratio,
            bottom_crop_ratio=1.0 - keep_height_ratio,
            bottom_crop_pixels=source.height - example.height,
            exact_top_crop_match=width_same and diff_bbox is None,
            diff_bbox=diff_bbox,
        )


def trim_alpha_edges(image: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return image, (0, 0, 0, 0)

    left, top, right, bottom = bbox
    removed = (left, top, image.width - right, image.height - bottom)
    if removed == (0, 0, 0, 0):
        return image, removed
    return image.crop(bbox), removed


def save_image_atomically(cropped: Image.Image, original: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
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


def backup_existing(path: Path, character_dir: Path, backup_dir: Path) -> None:
    if not path.exists():
        return
    backup_path = backup_dir / character_dir.name / OUTPUT_SUBDIR / path.name
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup_path)


def crop_one(
    source_path: Path,
    output_path: Path,
    character_dir: Path,
    root: Path,
    keep_height_ratio: float,
    execute: bool,
    backup_dir: Path | None,
) -> CropRecord:
    start = time.perf_counter()
    record = CropRecord(
        source=display_path(source_path, root),
        output=display_path(output_path, root),
        status="error",
        original_size="unknown",
    )
    try:
        with Image.open(source_path) as source_image:
            source = source_image.convert("RGBA")
            crop_height = max(1, min(source.height, round(source.height * keep_height_ratio)))
            bottom_cropped = source.crop((0, 0, source.width, crop_height))
            cropped, removed = trim_alpha_edges(bottom_cropped)

            record.original_size = f"{source.width}x{source.height}"
            record.bottom_cropped_size = f"{bottom_cropped.width}x{bottom_cropped.height}"
            record.cropped_size = f"{cropped.width}x{cropped.height}"
            record.crop_bottom_pixels = source.height - crop_height
            record.alpha_trimmed = removed != (0, 0, 0, 0)
            (
                record.alpha_trim_removed_left,
                record.alpha_trim_removed_top,
                record.alpha_trim_removed_right,
                record.alpha_trim_removed_bottom,
            ) = removed

            if execute:
                if backup_dir is not None:
                    backup_existing(output_path, character_dir, backup_dir)
                save_image_atomically(cropped, source_image, output_path)
                record.status = "written"
            else:
                record.status = "would_write"
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


def print_example(info: ExampleInfo) -> None:
    print("Example")
    print(f"  character: {info.character_dir}")
    print(f"  file: {info.example_name}")
    print(f"  source size: {info.source_size}")
    print(f"  example size: {info.example_size}")
    print(f"  width same: {info.width_same}")
    print(f"  keep height ratio: {info.keep_height_ratio:.12f}")
    print(f"  bottom crop ratio: {info.bottom_crop_ratio:.12f}")
    print(f"  source example bottom crop: {info.bottom_crop_pixels}px")
    print(f"  exact top-crop pixel match: {info.exact_top_crop_match}")
    if info.diff_bbox is not None:
        print(f"  diff bbox: {info.diff_bbox}")
    print("")


def print_record(record: CropRecord, quiet: bool) -> None:
    if quiet and record.status not in {"error", "would_write", "written"}:
        return
    if record.status in {"would_write", "written"}:
        print(
            f"[{record.status}] {record.source} -> {record.output}: "
            f"{record.original_size} -> {record.bottom_cropped_size} -> {record.cropped_size}; "
            f"crop bottom {record.crop_bottom_pixels}px; "
            f"trim alpha L{record.alpha_trim_removed_left} T{record.alpha_trim_removed_top} "
            f"R{record.alpha_trim_removed_right} B{record.alpha_trim_removed_bottom}; "
            f"{record.elapsed_ms:.2f} ms"
        )
    elif record.status == "error":
        print(f"[error] {record.source}: {record.message}", file=sys.stderr)
    elif not quiet:
        print(f"[{record.status}] {record.source}: {record.message}")


def write_report(path: Path, example: ExampleInfo, records: list[CropRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "example": asdict(example),
        "records": [asdict(record) for record in records],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def print_summary(records: list[CropRecord], dry_run: bool) -> None:
    counts: dict[str, int] = {}
    for record in records:
        counts[record.status] = counts.get(record.status, 0) + 1

    print("")
    print("Summary")
    print(f"  total: {len(records)}")
    for status in sorted(counts):
        print(f"  {status}: {counts[status]}")

    if dry_run and counts.get("would_write", 0):
        print("")
        print("Dry-run only. Re-run with --execute when you are ready to write files.")


def main() -> int:
    if Image is None or ImageChops is None:
        print("Pillow is required. Install it with: python -m pip install Pillow", file=sys.stderr)
        return 2

    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        print(f"Root directory does not exist: {root}", file=sys.stderr)
        return 2

    try:
        character_dir = resolve_character_dir(root, args.character_dir)
        source_dir = character_dir / SOURCE_SUBDIR
        output_dir = character_dir / OUTPUT_SUBDIR
        if not source_dir.is_dir():
            raise ValueError(f"Source directory does not exist: {source_dir}")
        if not output_dir.is_dir():
            raise ValueError(f"Output directory does not exist: {output_dir}")
        example_path = find_example(output_dir, source_dir, args.example)
        example_info = compare_example(character_dir, root, example_path)
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

    sources = collect_sources(source_dir, extensions)
    if not args.quiet:
        mode = "execute" if args.execute else "dry-run"
        print(f"Mode: {mode}")
        print(f"Root: {root}")
        print_example(example_info)
        if backup_dir is not None:
            print(f"Backup: {backup_dir}")
            print("")

    records = [
        crop_one(
            source_path=source_path,
            output_path=output_dir / source_path.name,
            character_dir=character_dir,
            root=root,
            keep_height_ratio=example_info.keep_height_ratio,
            execute=args.execute,
            backup_dir=backup_dir,
        )
        for source_path in sources
    ]

    for record in records:
        print_record(record, args.quiet)

    if args.report_json:
        write_report(args.report_json, example_info, records)
        if not args.quiet:
            print(f"\nReport written: {args.report_json.resolve()}")

    print_summary(records, dry_run=not args.execute)
    return 1 if any(record.status == "error" for record in records) else 0


if __name__ == "__main__":
    raise SystemExit(main())
