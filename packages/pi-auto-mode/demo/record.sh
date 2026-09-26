#!/usr/bin/env bash
# Records demo.gif: builds a throwaway home, plays demo.tape in it with vhs,
# and encodes the frames with ffmpeg. Needs vhs, ffmpeg, and a TypeSafe key.
set -euo pipefail

demo=$(cd "$(dirname "$0")" && pwd)
work=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$work"' EXIT

: "${TYPESAFE_API_KEY:=$(security find-generic-password -s TYPESAFE_API_KEY -w)}"
export TYPESAFE_API_KEY
export DEMO_HOME=$work/home
export PI_CLI=$demo/../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js

"$demo/setup.sh" "$DEMO_HOME"
(cd "$work" && vhs "$demo/demo.tape")

# vhs writes the terminal and the cursor as separate layers.
ffmpeg -loglevel error -y -framerate 30 -i "$work/frames/frame-text-%05d.png" \
  -framerate 30 -i "$work/frames/frame-cursor-%05d.png" \
  -filter_complex "[0][1]overlay,fps=15,scale=1100:-1:flags=lanczos,pad=iw+40:ih+40:20:20:color=0x171717,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  "$demo/demo.gif"
echo "wrote $demo/demo.gif ($(du -h "$demo/demo.gif" | cut -f1))"
