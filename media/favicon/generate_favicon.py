#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Install dependencies:
# brew install librsvg

# Generate favicon files from one or more SVGs.
# - If input is a file.svg → generate favicons/ with icons
# - If input is a directory or no input → process all .svg inside

#!/usr/bin/env python3
from pathlib import Path
import subprocess
import shutil
import argparse
from typing import Optional


def rasterize_with_rsvg(svg_path: Path, out_path: Path, size: int):
    subprocess.run([
        "rsvg-convert",
        "-w", str(size),
        "-h", str(size),
        str(svg_path),
        "-o", str(out_path)
    ], check=True)


def process_svg(svg_path: Path, outdir: Optional[Path] = None):
    outdir = outdir or (svg_path.parent)
    outdir.mkdir(parents=True, exist_ok=True)

    # copy svg

    sizes = {
        "favicon_32.png": 32,
        "favicon_16.png": 16,
        "apple-touch-icon.png": 180,
    }
    for filename, size in sizes.items():
        rasterize_with_rsvg(svg_path, outdir / filename, size)
        print(f"✓ {filename} from {svg_path.name}")


def main():
    default_dir = Path(__file__).parent  # folder where the script is located

    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", type=Path, default=default_dir)
    args = parser.parse_args()
    target = args.input.resolve()

    if target.is_file() and target.suffix.lower() == ".svg":
        process_svg(target)
    elif target.is_dir():
        svgs = [svg for svg in target.glob("*.svg") if not svg.name.startswith(".")]
        if not svgs:
            print(f"No SVG files found in {target}")
        for svg in svgs:
            process_svg(svg)
    else:
        print("Provide an .svg file or a directory with .svg files")


if __name__ == "__main__":
    main()