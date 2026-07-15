"""Mapping data classes and file I/O.

Schema follows plan-010 voice-portrait-map.json specification.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class MappingItem:
    """A single voice-to-portrait mapping entry."""

    order: int
    audioFileName: str
    audioRelPath: str
    portraitRelPath: str
    role: str
    engine: str  # "gpt-sovits" | "voicevox"
    text: str

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "MappingItem":
        return cls(
            order=data["order"],
            audioFileName=data["audioFileName"],
            audioRelPath=data["audioRelPath"],
            portraitRelPath=data["portraitRelPath"],
            role=data["role"],
            engine=data["engine"],
            text=data.get("text", ""),
        )


@dataclass
class Mapping:
    """Represents a complete voice-portrait-map.json file."""

    schemaVersion: int = 1
    threadPathBase: str = "thread"
    portraitPathBase: str = "repo"
    items: list[MappingItem] = field(default_factory=list)

    # ------------------------------------------------------------------
    # I/O
    # ------------------------------------------------------------------

    @classmethod
    def load(cls, path: str) -> "Mapping":
        """Load a mapping file. Raises FileNotFoundError if not found."""
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        mapping = cls(
            schemaVersion=data.get("schemaVersion", 1),
            threadPathBase=data.get("threadPathBase", "thread"),
            portraitPathBase=data.get("portraitPathBase", "repo"),
        )
        mapping.items = [MappingItem.from_dict(item) for item in data.get("items", [])]
        return mapping

    @classmethod
    def load_or_create(cls, path: str) -> "Mapping":
        """Load if exists, otherwise create a new empty mapping (does not write)."""
        if os.path.isfile(path):
            return cls.load(path)
        return cls()

    def save(self, path: str) -> None:
        """Write mapping to file, creating parent dirs as needed."""
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)

    def to_dict(self) -> dict:
        return {
            "schemaVersion": self.schemaVersion,
            "threadPathBase": self.threadPathBase,
            "portraitPathBase": self.portraitPathBase,
            "items": [item.to_dict() for item in self.items],
        }

    # ------------------------------------------------------------------
    # Item operations
    # ------------------------------------------------------------------

    def next_order(self) -> int:
        """Return the next available order number (max + 1, or 1 if empty)."""
        return max((item.order for item in self.items), default=0) + 1

    def get_item_by_order(self, order: int) -> Optional[MappingItem]:
        """Find an item by its order field."""
        for item in self.items:
            if item.order == order:
                return item
        return None

    def get_item_by_audio_name(self, audioFileName: str) -> Optional[MappingItem]:
        """Find an item by its audioFileName field."""
        for item in self.items:
            if item.audioFileName == audioFileName:
                return item
        return None

    def upsert(self, item: MappingItem) -> None:
        """Insert or update an item.

        - If an item with the same ``order`` exists, replace it.
        - If an item with the same ``audioFileName`` exists (but different order),
          print a warning and replace it.
        - Otherwise append.
        - Always re-sort by order after writing.
        """
        # Check order conflict
        for i, existing in enumerate(self.items):
            if existing.order == item.order:
                self.items[i] = item
                self._sort()
                return

        # Check audioFileName conflict (different order)
        for i, existing in enumerate(self.items):
            if existing.audioFileName == item.audioFileName:
                print(
                    f"[voice-mapping] Warning: audioFileName '{item.audioFileName}' "
                    f"already exists with order {existing.order}, replacing with "
                    f"order {item.order}"
                )
                self.items[i] = item
                self._sort()
                return

        # New item
        self.items.append(item)
        self._sort()

    def _sort(self) -> None:
        self.items.sort(key=lambda x: x.order)

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    def audio_dir(self, mapping_path: str) -> str:
        """Return the absolute audio directory for this mapping.

        Convention: audio files live in the same directory as the mapping
        file, under ``media/voice/audio/``.  Given a mapping at
        ``<thread>/media/voice/voice-portrait-map.json``, the audio dir is
        ``<thread>/media/voice/audio/``.
        """
        mapping_dir = os.path.dirname(os.path.abspath(mapping_path))
        return os.path.join(mapping_dir, "audio")

    def thread_root(self, mapping_path: str) -> str:
        """Return the thread root directory (two levels up from mapping file)."""
        return os.path.dirname(os.path.dirname(os.path.abspath(mapping_path)))


def make_audio_filename(order: int, role: str, ext: str = "wav") -> str:
    """Generate a zero-padded audio file name: ``0001-咲季.wav``."""
    safe_role = role.strip()
    return f"{order:04d}-{safe_role}.{ext}"
