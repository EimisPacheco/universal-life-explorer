# Smooth HRA lung-track integration

Use `hra-female-lung-smooth-tracks.json` in place of the ellipse-envelope path
inside `createAtlasLungLoftGeometry()`. The artifact still derives entirely
from the official HRA female lung fit, but its section values are direct X-Z
boundary points instead of radii around a section center.

## Required reconstruction

1. Select `left_lung` or `right_lung` and read its 21 `sections`.
2. For each of the 48 point indices, PCHIP-interpolate X and Z independently
   through `section.y_m`, with four subdivisions per measured interval. Do not
   Catmull-interpolate a center plus radius; that is the correspondence error
   that produced the transverse accordion.
3. Map each resulting `(x, y, z)` through the existing source-to-scene mapping.
4. For every quad, evaluate both diagonals and use the one whose two normalized
   triangle normals have the larger dot product.
5. Call `computeVertexNormals()` after the adaptive index buffer is installed.

The Python implementation of the exact PCHIP slope rule is in
`tools/reference-analysis/fit_smooth_lung_tracks.py` (`_pchip_slopes` and
`_pchip_sample`). It translates directly to JavaScript; use the same rule so
the zero-fold validation remains reproducible.

The artifact's four cardinal indices are anatomical extrema and must not be
moved:

- `0`: +X, anatomical left
- `12`: +Z, anterior
- `24`: -X, anatomical right
- `36`: -Z, posterior

## Remove the flat basal band

The original fit samples its first plane only 0.2% above the lower AABB and
then closes it with one fan vertex. That nearly coplanar fan is the straight
inferior shading band seen in the beauty render.

For the beauty mesh, omit measured rings 0 and 1 from the side wall and use
ring 2 as a smooth cap anchor. Insert six cap rings between ring 2 and
`lower_cap_y_m`:

```js
for (let step = 1; step <= 6; step++) {
  const t = step / 6;
  const eased = t * t * (3 - 2 * t);
  const radialScale = Math.sqrt(Math.max(0, 1 - eased * eased));
  const y = THREE.MathUtils.lerp(anchorY, lowerCapY, eased);
  // anchorCenter is the mean X-Z of ring 2.
  // For every ray: xz = anchorCenter + radialScale * (anchorXZ - anchorCenter)
}
```

End with a single point at `lower_cap_y_m`. This keeps the official inferior
Y bound but replaces the broad flat fan with a rounded diaphragmatic closure.
If the base becomes too tapered, anchor at ring 1 instead of ring 2. Remove the
existing ad-hoc `lowerBand` Y subtraction when this cap is enabled so the two
deformations do not stack.

Use the same construction at the upper cap if an apex ring is visible, usually
anchoring at measured ring 19.

## Frozen validation

At 81 render rings and 48 points per ring:

| Organ | Front IoU | Profile IoU | Mean measured-section IoU | Normal jump p95 | Folded quads | Self-intersections |
|---|---:|---:|---:|---:|---:|---:|
| Left lung | 0.9861 | 0.9880 | 0.9424 | 18.41° | 0 | 0 |
| Right lung | 0.9874 | 0.9426 | 0.9002 | 14.72° | 0 | 0 |

The current smooth ellipse baseline retains only 0.7037 and 0.7872 mean
measured-section IoU respectively. The track representation therefore restores
substantial official cross-sectional asymmetry while remaining topologically
clean.

Regenerate and verify with:

```bash
PYTHONPATH=tools/reference-analysis \
  python3 tools/reference-analysis/fit_smooth_lung_tracks.py
```

White/red/blue overlap panels are written to
`reference-atlas/fits/smooth-lung-track-validation.png`.
