#!/usr/bin/env bash
# Compress downloaded GLB models for the scene: 1K WebP textures, meshopt geometry.
# Writes scene.glb next to each model.glb; existing outputs are kept.
# Usage: scripts/optimize_models.sh [model-dir-name ...]   (default: all Sketchfab models)
set -euo pipefail
cd "$(dirname "$0")/../assets/models/sketchfab"
dirs=("$@")
[ ${#dirs[@]} -eq 0 ] && dirs=(*/)
for d in "${dirs[@]}"; do
  d=${d%/}
  [ -f "$d/model.glb" ] && [ ! -f "$d/scene.glb" ] || continue
  echo "optimize $d"
  input="$d/model.glb"
  options=()
  compression=meshopt
  # Preserve the separate blade pivot so browser animation can use the simulated RPM.
  if [ "$d" = 28503240 ]; then
    options+=(--flatten false --join false)
  fi
  # This thin, layered module needs full position precision to avoid coplanar artifacts.
  if [ "$d" = f441251b ]; then
    compression=false
  fi
  # Scanned stockyard: preserve its photographed surface while reducing 752,685 faces.
  # Keep the original download intact; the intermediate is reproducible and disposable.
  if [ "$d" = e9554994 ]; then
    timeout 600 npx -y @gltf-transform/cli@4.2.1 weld "$input" "$d/welded.glb" >/dev/null
    timeout 600 npx -y @gltf-transform/cli@4.2.1 simplify "$d/welded.glb" "$d/reduced.glb" \
      --ratio 0.2 --error 0.002 >/dev/null
    input="$d/reduced.glb"
  fi
  timeout 600 npx -y @gltf-transform/cli@4.2.1 optimize "$input" "$d/scene.glb" \
    --compress "$compression" --texture-compress webp --texture-size 1024 "${options[@]}" >/dev/null || echo "FAIL $d" >&2
  rm -f "$d/welded.glb" "$d/reduced.glb"
done
