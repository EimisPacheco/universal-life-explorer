# Medical reference mesh analysis

This utility converts official anatomical reference meshes into deterministic
measurements that can drive procedural geometry. It does **not** copy or import a
reference mesh into the application. Each logical mesh receives its own JSON
report, and multi-mesh sources can also receive an aggregate report.

Supported inputs:

- OBJ, including polygon triangulation, negative indices, and multiple `o` objects
- Binary and ASCII STL
- glTF 2.0 GLB with node transforms, multiple primitives, triangle strips/fans,
  interleaved accessors, and embedded buffers

The only runtime dependency is NumPy. The loader deliberately rejects Draco,
Meshopt, and sparse-accessor GLBs instead of returning incorrect measurements.
Such files should first be exported as an uncompressed GLB by Blender, glTF
Transform, or the source atlas's uncompressed-download option.

## Quick start

From the project root:

```bash
python3 tools/reference-analysis/analyze_mesh.py reference/liver.glb \
  --output-dir tools/reference-analysis/output
```

Analyze several files and register them to a united-body mesh:

```bash
python3 tools/reference-analysis/analyze_mesh.py \
  reference/left-lung.glb \
  reference/right-lung.glb \
  reference/liver.glb \
  reference/pelvis.glb \
  reference/small-intestine.glb \
  --reference-mesh reference/united-body.glb \
  --output-dir tools/reference-analysis/output
```

The command writes one `*.analysis.json` file per logical mesh, an aggregate
report when a source contains multiple meshes, a united-body reference report,
and `batch.analysis.json`.

## Manifest batches

For a traceable atlas ingestion pass, copy `manifest.example.json`, preserve its
source/license metadata, and run:

```bash
python3 tools/reference-analysis/analyze_mesh.py \
  --manifest tools/reference-analysis/manifest.example.json
```

Manifest paths are relative to the manifest itself. Supported top-level keys are:

- `meshes`: strings or objects with a required `path`; arbitrary metadata such as
  `organ`, `atlas`, `source_url`, `license`, and ontology IDs is copied into each
  report.
- `models`: an alias for provenance catalogs such as `reference-atlas/manifest.json`;
  entries may use `local_path` instead of `path`.
- `reference_mesh`: a body/united-model mesh analyzed in the same run.
- `reference_report`: an existing `*.analysis.json` to reuse instead of loading a
  body mesh.
- `canonical_frame.local_path`: used as the body reference when neither explicit
  reference key is present. Its `units` are checked against every organ.
- `output_dir` and `batch_output`: optional output locations.

CLI `--reference-mesh` or `--reference-report` overrides the corresponding
manifest value.

## Measurements and JSON schema

Every per-mesh report includes:

- source file path, format, SHA-256, logical mesh name, and manifest metadata;
- raw/analyzed vertex and triangle counts;
- weld tolerance and removed degeneracies;
- boundary/nonmanifold/inconsistently wound edges, connected components,
  watertightness, and winding consistency;
- axis-aligned bounds, dimensions, diagonal, and center;
- vertex-mean, exact area-weighted surface, and (when closed) volume centroids;
- triangle surface area and watertight volume;
- exact uniform-surface second moments, PCA eigenvalues/principal axes, and PCA
  oriented bounds;
- 1-bit normalized XY/XZ/YZ silhouettes in both world and PCA frames;
- normalized cross-sections at configurable fractions along all three PCA axes,
  including contour segments, sampled boundary points, bounds, centroid, and a
  filled 1-bit mask.

When manifest metadata contains `position_bbox_m`, `position_bbox_mm`, or
`position_bbox`, the report also records a pass/mismatch check against the bounds
measured from the file. This catches unit, scene-transform, and wrong-release
errors before they influence the procedural model.

The PCA covariance integrates the uniform surface of every triangle rather than
using the raw vertex cloud, so uneven triangulation density has much less effect.
Volume is emitted only for edge-watertight meshes. Face winding is repaired in
memory per connected component before the tetrahedral volume integral; the source
file is never changed.

Silhouette and section masks use text rows of `0`/`1`, listed top-to-bottom, with
a bottom-left geometric origin. The representation is intentionally transparent
and stable for version control and pixelwise scoring.

## United-body registration

When a reference body/report is supplied, each organ receives
`registration_to_reference`, including:

- organ AABB minimum, maximum, center, and dimensions in the body AABB unit box;
- every centroid in the same unit box;
- organ/body dimension, diagonal, AABB volume, surface area, and closed-volume
  ratios;
- body-bounds containment and per-axis overlap diagnostics.

Normalized coordinates use `0 = body minimum` and `1 = body maximum` independently
on each **world** axis. Values outside `[0, 1]` expose misregistration. PCA is not
used for placement because independently rotating each organ would destroy the
shared anatomical atlas frame.

Registration is marked `skipped` instead of manufacturing ratios when an entry
sets `register_to_reference: false`, uses different units from the canonical
frame, or states that it must not be directly registered. Thus HRA female organs
and a secondary BodyParts3D male morphology reference can coexist in one catalog
without mixing coordinate frames.

This makes placement gates concrete. For example, a procedural left lung can be
fitted against the reference lung's normalized body bounding box and centroid,
then judged on its PCA silhouettes and cross-sections.

## Options

```text
--silhouette-resolution N       default 48, allowed 16..256
--cross-section-resolution N    default 32, allowed 16..256
--slice-fractions LIST          default 0.10,0.25,0.50,0.75,0.90
--aggregate auto|always|never   default auto
--compact                       emit compact rather than indented JSON
--no-batch-output               suppress batch.analysis.json
```

Higher sampling resolutions improve mask comparison but increase runtime and JSON
size. Geometry measurements are independent of mask resolution.

## Verification

Run the isolated tests:

```bash
python3 -m unittest discover -s tools/reference-analysis/tests -v
```

The suite constructs known cubes in OBJ, duplicated-vertex binary STL, and GLB.
It verifies exact area/volume/centroids, STL welding and watertightness, GLB scene
transforms, silhouettes/cross-sections, CLI output, manifest batching, and
united-body normalization.

## Coordinate and anatomy cautions

- Source units are preserved and reported as unspecified. Record the atlas's unit
  convention in the manifest; do not silently assume GLB coordinates are metres.
- Register organs and the body from the same atlas release wherever possible.
  Comparing independently centered meshes cannot validate anatomical placement.
- PCA axis signs are deterministic, but nearly symmetric anatomy can have unstable
  axis ordering when eigenvalues are almost equal. Use world/body landmarks for
  left/right, superior/inferior, and anterior/posterior semantics.
- A watertight mesh can contain nested shells. This analyzer sums closed-component
  volumes; pathological or multi-shell files should be inspected before treating
  that total as tissue volume.
- Measurements establish geometry and placement parity. They do not establish
  medical validity on their own; retain atlas provenance and expert review.
