# HRA procedural loft fits

`hra-female-lung-liver-lofts.json` is the integration artifact. It contains
compact, deterministic outer-surface coefficients for the left lung, right
lung, and liver capsule in the official Human Reference Atlas Visible Human
Female common frame. `hra-female-lung-lofts.json` is the same lung result
without liver data for lung-only integration.

The official CC-BY-4.0 GLBs are measurement references, not runtime assets.
The fitter preserves their absolute meter coordinates: +X is anatomical left,
+Y superior, and +Z anterior.

## Mesh filters

- Left lung: names containing `bronchopulmonary_seg` and either `_left_` or
  `_lingula_` (10 segment meshes).
- Right lung: names containing `bronchopulmonary_seg` and `_right_` (10 segment
  meshes). The prefix deliberately also accepts the source's `segmennt` typo and
  truncated `segm` name.
- Lung bronchi, bronchial cartilage, and hilum meshes are excluded.
- Liver: exact mesh name `VH_F_capsule_of_the_liver`; segment, impression,
  ligament, and porta-hepatis meshes are excluded.

Every matched source mesh name is recorded in the JSON.

## Reconstruction

Each organ has 21 anatomical Y sections and 48 X-Z polar radii. For section
`s` and angle index `i`, use the shared `sampling.polar_angle_radians[i]`:

```text
x = s.center_xz_m[0] + s.radii_m[i] * cos(angle[i])
y = s.y_m
z = s.center_xz_m[1] + s.radii_m[i] * sin(angle[i])
```

Connect equal angle indices between adjacent sections with two triangles per
quad, wrapping index 47 to 0. Add a lower fan at `lower_cap_y_m` centered on
the first section and an upper fan at `upper_cap_y_m` centered on the last.
The JSON reconstruction counts are therefore 1,010 vertices and 2,016
triangles per organ.

The section center is the deepest point found by a deterministic 31x31
inside/outside search. Rays retain the outermost surface hit. The four axial
angles preserve exact per-plane front/profile extrema; missing rays in a
non-star-shaped section are circularly interpolated and clipped to that
section's bounds.

## Rebuild and validation

```bash
python3 tools/reference-analysis/fit_anatomical_lofts.py --organs all \
  --output reference-atlas/fits/hra-female-lung-liver-lofts.json
```

The command fails if any reconstructed AABB dimension differs by more than 5%.
Current maximum AABB errors are below 0.9%. Front/profile silhouette IoU is
stored per organ at 320x320 pixels; current values are 94.7% to 98.5%.

Official records and attribution are embedded in the JSON. Source GLB SHA-256
hashes make the fit input auditable.

`silhouette-validation.png` shows the six validation projections (left lung,
right lung, liver; front then profile). White is overlap, red is official
source only, and blue is reconstructed loft only.

## Frontal pelvis fit

`hra-female-pelvis-front.json` is a separate 2.5-D fit optimized for a
recognizable anterior pelvis. A polar solid loft is unsuitable here because it
would close the obturator foramina and erase the pelvic inlet. Instead, each hip
bone is represented by a simplified frontal outer contour with a true
`obturator_foramen` hole, while the sacrum and coccyx remain separate midline
plates. The file also contains superior iliac-crest envelopes, atlas-derived
acetabular centers and rim radii, sacroiliac and pubic contacts, and nine-sample
anterior/posterior depth profiles.

The local atlas does not contain a standalone file named
`pelvis-female-v1.5.glb`. The fitter therefore extracts the eight compact/axial
pelvis meshes from the official `united-female-v1.5.glb`. It verifies every
selected vertex and face array against the official smaller
`pelvis-female-v1.2.glb`; they are bit-for-bit identical in the acquired files.
That check and both SHA-256 hashes are recorded in the JSON.

Rebuild it with:

```bash
python3 tools/reference-analysis/fit_pelvis_front.py
```

For Three.js, construct one `THREE.Shape` per hip from
`outer_contour_xy_m`, add the named foramen as a `THREE.Path` in
`shape.holes`, and extrude only 12–18 mm. Apply the sampled median-Z profile to
restore curvature. Add each acetabulum as a shallow beveled elliptical ring at
its fitted center/radii. Build the sacrum and coccyx separately, place patient
left at +X, and keep the entire pelvis behind bowel and bladder.

`procedural-pelvis.js` implements that recipe. Its asynchronous convenience API
loads the JSON relative to the module:

```js
import { createProceduralPelvis } from './procedural-pelvis.js';

const pelvis = await createProceduralPelvis({
  unitsPerMeter: 10,
  recenter: true,
});
pelvis.position.set(0, 4.7, 0.1);
scene.add(pelvis);
```

For already-loaded coefficients, `buildProceduralPelvis(coefficients, options)`
returns a `THREE.Group` synchronously. `loadPelvisCoefficients(url, options)`
only fetches and validates the document. Default output width is approximately
3.17 scene units (`0.31684 m * 10`) and the returned group is centered on the
atlas midsagittal/pelvic center. Set `recenter: false, unitsPerMeter: 1` to
retain exact HRA common-frame metres. `group.userData.components` exposes both
hips, acetabular rims, iliac crests, sacrum, coccyx, and sacral ridges;
`group.userData.dispose()` releases module-owned geometry and materials.

`pelvis-silhouette-validation.png` compares the official projection with the
reconstruction. White is overlap, red is official-only, and blue is
reconstruction-only. The complete frontal silhouette currently reaches
98.78% IoU and 99.38% Dice at 768 px, passing the fitter's 95% IoU gate.
