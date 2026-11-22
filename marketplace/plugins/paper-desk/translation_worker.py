"""Run the pinned layout engine and stream its documented progress events."""

import asyncio
import json
import logging
import sys
from pathlib import Path

from babeldoc.assets.assets import warmup
from pdf2zh_next.config import ConfigManager
from pdf2zh_next.high_level import do_translate_async_stream


async def main():
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    settings = ConfigManager().initialize_config()
    source, = settings.basic.input_files
    settings.basic.input_files = set()
    warmup()
    async for event in do_translate_async_stream(settings, Path(source)):
        kind = event["type"]
        if kind in ("progress_start", "progress_update", "progress_end"):
            fields = {k: event.get(k) for k in ("stage", "overall_progress", "part_index", "total_parts")}
            print("PAPER_DESK_PROGRESS " + json.dumps(fields, allow_nan=False), flush=True)
        elif kind == "finish":
            return 0 if event["translate_result"].mono_pdf_path else 1
        elif kind == "error":
            return 1
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
