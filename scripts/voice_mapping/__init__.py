"""Voice-Portrait mapping shared library.

Provides Mapping / MappingItem data classes and utilities for reading,
writing, and appending entries to voice-portrait-map.json files.

Used by GPT-SoVITS WebUI and any Python-side voice tools.
"""

from .mapping import Mapping, MappingItem

__all__ = [
    "Mapping",
    "MappingItem",
]
