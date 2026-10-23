#!/usr/bin/env bash
# Prepares an OSRM dataset (car profile, MLD algorithm) from an OpenStreetMap extract.
#
#   infra/osrm/prepare-dataset.sh <extract.osm.pbf|.osm> <output-dir>
#
# Uses native OSRM binaries when OSRM_BIN_DIR is set (directory holding osrm-extract, and
# OSRM_PROFILE pointing at car.lua), otherwise the OSRM Docker image (OSRM_IMAGE).
# Then serve it with:
#   osrm-routed --algorithm mld <output-dir>/<name>.osrm
set -euo pipefail

input=${1:?usage: prepare-dataset.sh <extract> <output-dir>}
outdir=${2:?usage: prepare-dataset.sh <extract> <output-dir>}
image=${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v26.4.0}

mkdir -p "$outdir"
cp "$input" "$outdir/"
name=$(basename "$input")
base=${name%%.osm*}

if [[ -n "${OSRM_BIN_DIR:-}" ]]; then
  profile=${OSRM_PROFILE:?set OSRM_PROFILE to the car.lua profile shipped with the binaries}
  (cd "$outdir" && "$OSRM_BIN_DIR/osrm-extract" -p "$profile" "$name" \
    && "$OSRM_BIN_DIR/osrm-partition" "$base.osrm" \
    && "$OSRM_BIN_DIR/osrm-customize" "$base.osrm")
else
  run() { docker run --rm -t -v "$(cd "$outdir" && pwd):/data" "$image" "$@"; }
  run osrm-extract -p /opt/car.lua "/data/$name"
  run osrm-partition "/data/$base.osrm"
  run osrm-customize "/data/$base.osrm"
fi
rm "$outdir/$name"
echo "dataset ready: $outdir/$base.osrm"
