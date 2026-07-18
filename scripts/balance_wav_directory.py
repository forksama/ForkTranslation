"""Balance the loudness of WAV clips in a directory.

This script is designed for short voice lines stored as PCM WAV files.
It measures an approximate active loudness for each file, uses the
median loudness as the target, archives the original files under an
``original`` subdirectory by default, and writes normalized files back
to the input directory using the original file names.

Examples:
  python scripts/balance_wav_directory.py "C:\\path\\to\\audio"
  python scripts/balance_wav_directory.py "C:\\path\\to\\audio" --target-dbfs -18
  python scripts/balance_wav_directory.py "C:\\path\\to\\audio" --archive-dir source
  python scripts/balance_wav_directory.py "C:\\path\\to\\audio" --out-dir balanced
  python scripts/balance_wav_directory.py "C:\\path\\to\\audio" --dry-run
"""

from __future__ import annotations

import argparse
import audioop
import math
import os
import statistics
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SUPPORTED_SAMPLE_WIDTHS = {2, 4}


@dataclass
class LoudnessInfo:
    path: Path
    measured_dbfs: float
    peak_dbfs: float
    frames: int
    channels: int
    sample_width: int
    rate: int


def dbfs(value: float) -> float:
    if value <= 0:
        return float("-inf")
    return 20.0 * math.log10(value)


def normalize_dbfs(dbfs_value: float, target_dbfs: float) -> float:
    if dbfs_value == float("-inf"):
        return float("nan")
    return target_dbfs - dbfs_value


def collect_wavs(root: Path, recursive: bool) -> list[Path]:
    pattern = "**/*.wav" if recursive else "*.wav"
    return sorted(p for p in root.glob(pattern) if p.is_file())


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def filter_excluded_roots(paths: list[Path], excluded_roots: Iterable[Path]) -> list[Path]:
    resolved_excluded = [root.resolve() for root in excluded_roots]
    kept: list[Path] = []
    for path in paths:
        resolved_path = path.resolve()
        if any(is_relative_to(resolved_path, excluded) for excluded in resolved_excluded):
            continue
        kept.append(path)
    return kept


def analyze_wav(path: Path, block_ms: int, gate_dbfs: float) -> LoudnessInfo:
    with wave.open(str(path), "rb") as wf:
        nchannels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        nframes = wf.getnframes()

        if sampwidth not in SUPPORTED_SAMPLE_WIDTHS:
            raise ValueError(
                f"{path.name}: unsupported sample width {sampwidth} bytes; "
                "this script supports 16-bit and 32-bit PCM WAV only"
            )
        if wf.getcomptype() != "NONE":
            raise ValueError(f"{path.name}: compressed WAV is not supported")

        block_frames = max(1, int(framerate * block_ms / 1000))
        max_amplitude = float(1 << (8 * sampwidth - 1))

        full_sum = 0.0
        full_count = 0
        active_sum = 0.0
        active_count = 0
        peak = 0

        while True:
            chunk = wf.readframes(block_frames)
            if not chunk:
                break

            chunk_frames = len(chunk) // (sampwidth * nchannels)
            if chunk_frames <= 0:
                continue

            chunk_peak = audioop.max(chunk, sampwidth)
            peak = max(peak, chunk_peak)

            chunk_rms = audioop.rms(chunk, sampwidth)
            chunk_rms_dbfs = dbfs(chunk_rms / max_amplitude)
            samples = chunk_frames * nchannels
            full_sum += float(chunk_rms) * float(chunk_rms) * samples
            full_count += samples

            if chunk_rms_dbfs >= gate_dbfs:
                active_sum += float(chunk_rms) * float(chunk_rms) * samples
                active_count += samples

        if active_count > 0:
            rms = math.sqrt(active_sum / active_count)
        elif full_count > 0:
            rms = math.sqrt(full_sum / full_count)
        else:
            rms = 0.0

        measured_dbfs = dbfs(rms / max_amplitude)
        peak_dbfs = dbfs(peak / max_amplitude)

        return LoudnessInfo(
            path=path,
            measured_dbfs=measured_dbfs,
            peak_dbfs=peak_dbfs,
            frames=nframes,
            channels=nchannels,
            sample_width=sampwidth,
            rate=framerate,
        )


def apply_gain(
    src: Path,
    dst: Path,
    gain_db: float,
    max_gain_db: float | None,
) -> tuple[float, bool]:
    gain = 10.0 ** (gain_db / 20.0)
    limited = False
    tmp_path: Path | None = None

    try:
        fd, tmp_name = tempfile.mkstemp(dir=str(dst.parent), suffix=".wav")
        os.close(fd)
        tmp_path = Path(tmp_name)

        with wave.open(str(src), "rb") as wf:
            params = wf.getparams()
            sampwidth = wf.getsampwidth()
            max_amplitude = float(1 << (8 * sampwidth - 1))
            peak = audioop.max(wf.readframes(wf.getnframes()), sampwidth)
            wf.rewind()

            if peak > 0:
                safe_gain = (max_amplitude - 1.0) / float(peak)
                if safe_gain < gain:
                    gain = safe_gain
                    limited = True

            if max_gain_db is not None:
                cap = 10.0 ** (max_gain_db / 20.0)
                if gain > cap:
                    gain = cap
                    limited = True

            with wave.open(str(tmp_path), "wb") as out:
                out.setparams(params)
                while True:
                    chunk = wf.readframes(4096)
                    if not chunk:
                        break
                    out.writeframes(audioop.mul(chunk, sampwidth, gain))

        try:
            os.replace(tmp_path, dst)
        except PermissionError:
            if src.resolve() == dst.resolve() or not dst.exists():
                raise
            dst.unlink()
            os.replace(tmp_path, dst)
    except Exception:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise

    return 20.0 * math.log10(gain), limited


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def build_output_path(src_root: Path, out_root: Path, src: Path) -> Path:
    return out_root / src.relative_to(src_root)


def display_path(path: Path, base: Path) -> str:
    try:
        return str(path.relative_to(base))
    except ValueError:
        return str(path)


def resolve_child_dir(src_root: Path, path: Path) -> Path:
    return path.resolve() if path.is_absolute() else src_root / path


def normalize_and_archive(
    src: Path,
    archive_dst: Path,
    gain_db: float,
    max_gain_db: float | None,
) -> tuple[float, bool]:
    if archive_dst.exists():
        raise FileExistsError(
            f"Archive file already exists, refusing to overwrite: {archive_dst}"
        )

    ensure_parent(archive_dst)

    fd, normalized_tmp_name = tempfile.mkstemp(
        dir=str(src.parent),
        prefix=".normalized-",
        suffix=".wav",
    )
    os.close(fd)
    normalized_tmp = Path(normalized_tmp_name)

    try:
        applied_gain_db, limited = apply_gain(src, normalized_tmp, gain_db, max_gain_db)
        src.rename(archive_dst)
        try:
            os.replace(normalized_tmp, src)
        except Exception:
            if not src.exists() and archive_dst.exists():
                archive_dst.rename(src)
            raise
    except Exception:
        if normalized_tmp.exists():
            normalized_tmp.unlink(missing_ok=True)
        raise

    return applied_gain_db, limited


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Directory containing WAV files")
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Process WAV files in subdirectories too",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        help=(
            "Write normalized copies to this directory instead of replacing input "
            "files and archiving originals"
        ),
    )
    parser.add_argument(
        "--archive-dir",
        type=Path,
        default=Path("original"),
        help=(
            "Directory for unnormalized source files when --out-dir is not used "
            "(default: <input>/original)"
        ),
    )
    parser.add_argument(
        "--target-dbfs",
        type=float,
        help="Force a target loudness in dBFS instead of using the directory median",
    )
    parser.add_argument(
        "--gate-dbfs",
        type=float,
        default=-50.0,
        help="Ignore windows quieter than this when measuring loudness (default: -50)",
    )
    parser.add_argument(
        "--block-ms",
        type=int,
        default=50,
        help="Analysis window size in milliseconds (default: 50)",
    )
    parser.add_argument(
        "--max-gain-db",
        type=float,
        default=12.0,
        help="Cap positive gain changes to this many dB (default: 12)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print the planned gain changes; do not write audio files",
    )

    args = parser.parse_args(argv)

    src_root = args.directory.resolve()
    if not src_root.is_dir():
        raise SystemExit(f"Not a directory: {src_root}")

    copy_mode = args.out_dir is not None
    out_root = resolve_child_dir(src_root, args.out_dir) if args.out_dir else None
    archive_root = resolve_child_dir(src_root, args.archive_dir)

    excluded_roots: list[Path] = []
    if args.recursive:
        excluded_roots.append(archive_root)
        if out_root is not None:
            excluded_roots.append(out_root)

    wavs = filter_excluded_roots(collect_wavs(src_root, args.recursive), excluded_roots)
    if not wavs:
        raise SystemExit(f"No WAV files found under {src_root}")

    infos: list[LoudnessInfo] = []
    for wav_path in wavs:
        info = analyze_wav(wav_path, args.block_ms, args.gate_dbfs)
        infos.append(info)

    loudness_values = [info.measured_dbfs for info in infos if info.measured_dbfs != float("-inf")]
    if not loudness_values:
        raise SystemExit("All files appear silent; nothing to normalize")

    target_dbfs = args.target_dbfs if args.target_dbfs is not None else statistics.median(loudness_values)

    print(f"Input:  {src_root}")
    if copy_mode:
        print(f"Output: {out_root}")
    else:
        print(f"Output: {src_root}")
        print(f"Archive: {archive_root}")
    print(f"Target: {target_dbfs:.2f} dBFS")
    print()

    for info in infos:
        delta_db = normalize_dbfs(info.measured_dbfs, target_dbfs)
        if math.isnan(delta_db):
            print(f"{info.path.name}: silent, skipped")
            continue

        if args.dry_run:
            planned_gain_db = delta_db
            limited = False
            if info.peak_dbfs != float("-inf"):
                headroom_db = -info.peak_dbfs
                if planned_gain_db > headroom_db:
                    planned_gain_db = headroom_db
                    limited = True
            if args.max_gain_db is not None and planned_gain_db > args.max_gain_db:
                planned_gain_db = args.max_gain_db
                limited = True
            status = "limited dry-run" if limited else "dry-run"
            destination = (
                build_output_path(src_root, out_root, info.path)
                if copy_mode and out_root is not None
                else info.path
            )
            archive_note = (
                ""
                if copy_mode
                else f", archive -> {display_path(build_output_path(src_root, archive_root, info.path), src_root)}"
            )
            print(
                f"{info.path.name}: {info.measured_dbfs:7.2f} dBFS -> "
                f"{target_dbfs:7.2f} dBFS, gain {planned_gain_db:+6.2f} dB "
                f"[{status}], normalized -> {display_path(destination, src_root)}{archive_note}"
            )
            continue

        if copy_mode and out_root is not None:
            dst = build_output_path(src_root, out_root, info.path)
            ensure_parent(dst)
            applied_gain_db, limited = apply_gain(info.path, dst, delta_db, args.max_gain_db)
        else:
            archive_dst = build_output_path(src_root, archive_root, info.path)
            applied_gain_db, limited = normalize_and_archive(
                info.path,
                archive_dst,
                delta_db,
                args.max_gain_db,
            )
        status = "limited" if limited else "ok"
        print(
            f"{info.path.name}: {info.measured_dbfs:7.2f} dBFS -> "
            f"{target_dbfs:7.2f} dBFS, gain {applied_gain_db:+6.2f} dB [{status}]"
        )

    print()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
