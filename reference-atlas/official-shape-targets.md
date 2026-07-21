# Official HRA shape targets for the procedural body

**Independent verdict:** the current render is not an atlas-fit model yet. Its front-view envelopes are often close, but the lung depth/lobation, liver contour and registration, pelvic topology, and bowel centerlines are still primitive approximations. Further freehand `scale`/`position` tuning will not reach the 90% gate.

This document converts the staged official meshes into code-oriented targets. Geometry and placement authority is the NIH-funded HuBMAP Human Reference Atlas (HRA); the supplied 630×900 image remains the authority for camera crop, layer visibility, lighting, and final illustrative styling. When the stock illustration conflicts with the HRA donor geometry, HRA wins.

## 1. Coordinate contract

The staged HRA objects already share one registered Visible Human Female frame:

- `+X` = anatomical left = screen-right in the locked anterior camera.
- `+Y` = superior.
- `+Z` = anterior.
- Body AABB minimum = `[-0.489561558, -0.794760942, -0.222619534] m`.
- Body AABB dimensions = `[0.967442058, 1.666348242, 0.455284934] m`.
- Body AABB centre = `[-0.005840529, 0.038413179, 0.005022933] m`.

Use exactly one atlas-to-scene transform:

```js
scenePoint = sceneRoot + sceneMetres * (hraPoint - hraBodyCenter);
sceneMetres = sceneBodyHeight / 1.666348242;
```

Do not recenter or independently translate the organs before applying this transform. Laterality assertions should fail the build if any of these are false:

```js
leftLung.center.x > 0;
rightLung.center.x < 0;
ascendingColon.center.x < 0;
descendingColon.center.x > 0;
hepaticFlexure.center.x < splenicFlexure.center.x;
```

The app now uses the correct semantic convention in comments, but the final geometry must preserve it as data, not rely on visual naming.

## 2. Frozen aggregate targets

Dimensions are `X × Y × Z`. `Body-H` expresses each dimension as a fraction of the 1.666348242 m reference body height. Body-unit centres are normalized independently along the body X/Y/Z AABB.

| Structure | Official dimensions (m) | Shape ratio | Body-H dimensions | Body-unit centre |
|---|---:|---:|---:|---:|
| Lung pair | `0.251135 × 0.223036 × 0.152605` | `1.000 : 0.888 : 0.608` | `0.1507 : 0.1338 : 0.0916` | `(0.5009, 0.7642, 0.3130)` |
| Liver outer capsule | `0.247107 × 0.169911 × 0.152532` | `1.000 : 0.688 : 0.617` | `0.1483 : 0.1020 : 0.0915` | aggregate placement `(0.4943, 0.6855, 0.3337)` |
| Female pelvis | `0.316838 × 0.211493 × 0.182744` | `1.000 : 0.668 : 0.577` | `0.1901 : 0.1269 : 0.1097` | `(0.4972, 0.5123, 0.2889)` |
| Small intestine, full | `0.161571 × 0.217233 × 0.099994` | `0.744 : 1.000 : 0.460` | `0.0970 : 0.1304 : 0.0600` | `(0.4995, 0.5895, 0.4271)` |
| Jejunum + ileum core | `0.161571 × 0.172945 × 0.098798` | `0.934 : 1.000 : 0.571` | — | source centre `(-0.00635, 0.16536, -0.02757) m` |
| Large intestine, full | `0.243276 × 0.294947 × 0.193418` | `0.825 : 1.000 : 0.656` | `0.1460 : 0.1770 : 0.1161` | `(0.5011, 0.5575, 0.3796)` |
| Colon frame, excluding sigmoid/rectum | `0.243276 × 0.255483 × 0.130068` | `0.952 : 1.000 : 0.509` | — | source centre `(-0.00482, 0.15392, -0.01812) m` |

The liver *capsule* is the outer-shape target. Ligaments and impression meshes extend the liver aggregate farther posteriorly and must not inflate the visible capsule AABB.

### Baseline-to-illustration front-view corrections

These are current-render-to-supplied-image corrections, not replacements for atlas metrics. Apply them only after the common HRA transform is established, preferably through the body/camera registration rather than donor-breaking per-organ offsets.

| Structure | Current → target screen-centre delta | Width multiplier | Height multiplier |
|---|---:|---:|---:|
| Patient-right lung (screen-left) | `(-2, -3) px` | `0.985` | `0.961` |
| Patient-left lung (screen-right) | `(+0.5, -1.5) px` | `1.076` | `0.973` |
| Liver | `(-22.5, +6) px` | `0.951` | `1.070` |
| Small intestine | `(+7.5, +1) px` | `0.995` | `1.053` |
| Large intestine | `(+5.5, +5) px` | `1.071` | `1.033` |
| Pelvis | `(+1, -9.5) px` | `0.982` | `0.822` |

The liver and pelvis deltas are gross failures. The bowel and lung bboxes are already close enough that their remaining error is mostly topology and contour, not scale.

## 3. Lungs

### Side-specific geometry

| Side | HRA X range | Dimensions (m) | `W:H:D` | Centre (m) | Hilum in side-local unit box |
|---|---:|---:|---:|---:|---:|
| Patient left (`x>0`) | `[0.009888, 0.120606]` | `0.110718 × 0.223036 × 0.152605` | `0.496 : 1 : 0.684` | `(0.065247, 0.478591, -0.080119)` | approximately `(0.339, 0.617, 0.456)` |
| Patient right (`x<0`) | `[-0.130529, 0.000726]` | `0.131255 × 0.205494 × 0.150691` | `0.639 : 1 : 0.733` | `(-0.064902, 0.484618, -0.079720)` | approximately `(0.631, 0.529, 0.453)` |

The left lung is 8.5% taller, 15.6% narrower, and centred about 6 mm *inferior* to the right lung. `buildLungMesh()` currently puts the left lung slightly superior; reverse that relationship. The two parenchymal AABBs have only a 9.16 mm medial gap. They must approach the mediastinum but not overlap through it.

The current primitives are much too flat in depth. Their approximate radius ratios are near `D/H = 0.33–0.34`; the official targets are `0.684` left and `0.733` right. Fit the final measured AABB, which implies roughly doubling the current Z radius while keeping the front silhouette stable.

### Frontal contour target

Width is normalized by each lung's maximum frontal width. `q` is height from inferior (`0`) to superior (`1`).

| `q` | Left width | Right width |
|---:|---:|---:|
| `0.10` | `0.550` | `0.828` |
| `0.25` | `0.829` | `0.880` |
| `0.50` | `0.867` | `0.961` |
| `0.75` | `0.848` | `0.723` |
| `0.90` | `0.722` | `0.508` |

This is not a mirrored pair. The right lung has a broad inferior/middle envelope and shorter apex; the left lung is taller, narrower, and has a stronger medial cardiac accommodation.

### Required procedural changes

1. Replace the single deformed `createOrganicSphere()` per side with an atlas-fitted loft. Offline, sample each HRA parenchymal surface at 21–33 Y planes and 48–64 polar angles, then store the fitted ring coefficients/control points. Runtime geometry may remain fully procedural; the official GLB need not ship.
2. Fit separate medial, lateral, anterior, and posterior radii. Do not infer Z from the front-view width. Enforce the side-specific `W:H:D` table after deformation.
3. Preserve the left two-lobe/right three-lobe topology. Right: oblique plus horizontal fissure. Left: oblique fissure, cardiac notch, and lingula. Fissures should be curves on the fitted surface, not straight dark tubes laid over an ovoid.
4. Anchor the intrapulmonary tree to the measured hila above. The current bronchi use unrelated hard-coded world coordinates, so they drift when lung geometry changes.
5. Use the HRA lobe/segment meshes only to fit boundaries. The final lobe junctions must remain continuous and must not create coincident/intersecting shells.
6. Surface irregularity must be material/normal-scale detail. Vertex noise should remain below `0.5%` of the lung bbox diagonal so it cannot corrupt the silhouette.

## 4. Liver

The capsule target is broad, deep, asymmetric, and wedge-like—not a stretched noisy sphere. Its official `W:H:D` is `1 : 0.688 : 0.617`.

### Frontal contour target

`xMid` is the midpoint of the silhouette interval in the organ-local X box; smaller X is patient-right/screen-left.

| Height `q` from inferior | Width / max width | `xMid` |
|---:|---:|---:|
| `0.10` | `0.673` | `0.379` |
| `0.25` | `0.849` | `0.436` |
| `0.50` | `0.985` | `0.498` |
| `0.75` | `0.900` | `0.491` |
| `0.90` | `0.317` | `0.261` |

The high superior dome therefore collapses strongly toward the patient-right lobe. The inferior surface also narrows toward the right-heavy sharp margin; a vertically symmetric ellipsoid cannot reproduce either contour.

### Landmark targets in the liver aggregate unit box

| Landmark | Normalized centre | Normalized span |
|---|---:|---:|
| Falciform ligament/groove | `(0.502, 0.499, 0.794)` | `(0.224, 0.631, 0.357)` |
| Porta hepatis | `(0.413, 0.313, 0.601)` | `(0.199, 0.222, 0.245)` |
| Gastric impression | `(0.729, 0.377, 0.694)` | `(0.395, 0.686, 0.449)` |
| Renal impression | `(0.279, 0.164, 0.287)` | `(0.226, 0.254, 0.299)` |

### Required procedural changes

1. Solve placement first. The current front render is 22.5 px too far screen-right; changing lobe deformation while leaving `P.liverX` hand-tuned will only move the error around. The HRA aggregate centre is almost exactly on the body midline (`body-unit X=0.4943`), with the right-lobe mass producing the left-heavy silhouette.
2. Replace the sphere deformation with a 25-ring coronal loft of the HRA capsule (64 angular samples/ring), or fit a compact tensor-product B-spline/SDF to the same samples.
3. Put the superior dome on patient-right (`x<0`), preserve the thin left-lobe tongue, sharpen the anterior-inferior margin, and retain full depth (`D/W≈0.617`).
4. Move the falciform groove toward organ-local `x≈0.50`. The current `ox≈-0.36`/hard-coded crease lies too far into the right lobe and is not tied to the final deformed bbox.
5. Use the porta hepatis, gastric impression, and renal impression as actual posterior/visceral surface constraints. They should influence curvature/depth even when hidden in the frontal beauty render.

## 5. Female pelvis

The official pelvis is a shallow three-dimensional bowl with continuous ilium/ischium/pubis surfaces, not two flat plates plus torus rings. The baseline is 21.7% too tall while its width is already within about 2% of the supplied image.

### Component targets in the pelvis unit box

| Component | Normalized centre | Normalized span |
|---|---:|---:|
| Sacrum | `(0.502, 0.663, 0.287)` | `(0.402, 0.468, 0.574)` |
| Coccyx | `(0.503, 0.371, 0.127)` | `(0.101, 0.127, 0.208)` |
| Right ilium | `(0.182, 0.669, 0.535)` | `(0.363, 0.662, 0.884)` |
| Left ilium | `(0.813, 0.670, 0.547)` | `(0.375, 0.654, 0.907)` |
| Right pubis | `(0.354, 0.252, 0.760)` | `(0.295, 0.440, 0.386)` |
| Left pubis | `(0.643, 0.256, 0.764)` | `(0.296, 0.431, 0.374)` |
| Right ischium | `(0.254, 0.225, 0.493)` | `(0.255, 0.449, 0.371)` |
| Left ischium | `(0.743, 0.231, 0.497)` | `(0.261, 0.448, 0.354)` |

The front projection contains three dominant negative spaces:

- Pelvic inlet: normalized bbox approximately `[0.265, 0.224, 0.733, 0.596]`.
- Right obturator foramen: approximately `[0.295, 0.130, 0.382, 0.242]`.
- Left obturator foramen: approximately `[0.613, 0.135, 0.701, 0.249]`.

Outer frontal width rises from about `0.515` of maximum at `q=0.05` to `0.757` at `q=0.50`, and reaches `0.993` at `q=0.80`. Thus the iliac wings carry the maximum width superiorly; the lower pubic/ischial complex must narrow strongly.

### Required procedural changes

1. Rebuild `rebuildPelvis()` in pelvis-local coordinates around `(0,0,0)`. It currently constructs vertices with absolute `py` and then applies `scale.y=2.18`, making placement and proportion inseparable.
2. As an interim front-view correction only, reduce the current effective Y scale by `0.822` (`2.18 → about 1.79`) around the pelvic centre and move that centre 9.5 px superior. Do not keep this as the final atlas fit.
3. Replace flat extruded iliac plates with bilateral curved shell/loft surfaces that achieve `D/W=0.577`. The present depth is far too shallow in sagittal view.
4. Add the sacrum and coccyx to the pelvis assembly at the normalized targets above. They are essential to the pelvic inlet and cannot be delegated to a generic spinal column.
5. Form obturator foramina and the pelvic inlet as holes in a continuous bony surface/SDF. Torus objects are anatomically wrong and visibly circular. Add acetabular cups at the ilium/ischium/pubis junction rather than decorative rings.
6. Fit the iliac crests, ASIS regions, pubic symphysis, pubic arch, ischial tuberosities, and acetabular centres as explicit landmarks before tuning material translucency.

## 6. Small intestine

The HRA full bowel is taller than it is wide because the duodenal sweep sits above the jejunoileal loop field. The loop field itself is nearly square (`W/H=0.934`), which is compatible with the supplied image. Do not scale the entire small intestine to make the full AABB square.

### Named-region targets in the small-intestine unit box

| Region | Normalized centre | Normalized span |
|---|---:|---:|
| Duodenum superior | `(0.351, 0.883, 0.435)` | `(0.238, 0.235, 0.690)` |
| Duodenum descending | `(0.236, 0.847, 0.134)` | `(0.218, 0.276, 0.267)` |
| Duodenum horizontal | `(0.392, 0.707, 0.193)` | `(0.401, 0.127, 0.277)` |
| Duodenum ascending | `(0.590, 0.757, 0.327)` | `(0.166, 0.118, 0.414)` |
| Jejunum | `(0.577, 0.480, 0.370)` | `(0.845, 0.633, 0.644)` |
| Terminal ileum | `(0.270, 0.215, 0.436)` | `(0.446, 0.311, 0.153)` |

The current hand-authored duodenal path starts on `+X`, travels farther `+X`, then crosses to `-X`; that does not match the HRA sequence. The official descending duodenum is patient-right (`x<0`), the horizontal part crosses toward patient-left, and the ascending part ends at positive X.

### Required procedural changes

1. Extract or fit a continuous atlas centreline offline, resample it by arc length, and store only normalized B-spline/Fourier control data in the app. A procedural tube generated from fitted coefficients satisfies the from-scratch runtime requirement without shipping the GLB.
2. Build named centreline ranges for duodenum, jejunum, ileum, and terminal ileum. Enforce the region centres/spans above and join the terminal ileum to the measured ileocecal-valve anchor.
3. Replace the current sequence of 18 almost-closed `1.62π` loops plus deep connector dives. It produces artificial repeated C-shapes and long posterior bridges. Use one smooth, arc-length-parameterized centreline with varying loop scale/orientation and collision-aware packing.
4. Keep the jejunum predominantly superior/left and ileum predominantly inferior/right. Use depth staggering from the atlas rather than alternating only two Z planes.
5. Use a variable outside diameter, approximately `20–28 mm` before global scene scaling, and prevent non-neighbour centreline samples from approaching closer than roughly `1.8–2.0` local tube radii unless an atlas contact explicitly requires it.
6. In the full body, do not render rounded caps at the duodenal and terminal ends; join them to stomach/duodenum and ileocecal valve. Caps are allowed only in isolated debug mode.

## 7. Large intestine

Laterality is currently broadly correct: ascending/caecum at `x<0`, descending at `x>0`. Shape and depth are not.

### Named anchors in the large-intestine unit box

| Anchor | Normalized centre | Normalized span |
|---|---:|---:|
| Hepatic flexure | `(0.159, 0.809, 0.533)` | `(0.281, 0.240, 0.408)` |
| Splenic flexure | `(0.860, 0.873, 0.623)` | `(0.267, 0.253, 0.373)` |
| Caecum | `(0.133, 0.496, 0.610)` | `(0.221, 0.235, 0.267)` |
| Ileocecal valve | `(0.198, 0.561, 0.582)` | `(0.024, 0.067, 0.104)` |
| Sigmoid colon | `(0.480, 0.260, 0.537)` | `(0.362, 0.214, 0.480)` |
| Rectum | `(0.531, 0.179, 0.164)` | `(0.218, 0.359, 0.328)` |

The splenic flexure is 19 mm (`6.4%` of the full colon height) superior to the hepatic flexure. The transverse-colon centreline drops from roughly `y=0.248–0.258 m` at the flexures to `y=0.196 m` centrally: a sag of about `0.057 m`, or `19%` of the full colon height. The present `liPts` transverse run is almost level and under-sags by roughly a factor of five.

The rectum is strongly posterior: its local Z centre is `0.164`, versus about `0.53–0.62` for the flexures/caecum. The current path remains anterior through its distal end.

### Required procedural changes

1. Fit separate B-spline centreline ranges for ascending, hepatic flexure, transverse, splenic flexure, descending, sigmoid, and rectum. Preserve the named anchors, then concatenate with C1/C2 continuity.
2. Lower the transverse midpoint to about `0.19–0.20` of full-colon height below the average flexure level. Raise the patient-left/splenic flexure relative to hepatic.
3. Drive the sigmoid-to-rectum path posteriorly by about `0.4` of the colon depth box; do not keep all `liPts` near one front-facing Z layer.
4. Replace uniform sinusoidal radial corrugation with arc-length-spaced haustral pouches: variable spacing (`±15%`), localized annular constrictions, and three longitudinal taeniae approximately 120° apart. The current single decorative anterior taenia and perfectly periodic 28-cycle sine read as a toy tube.
5. Preserve a bulbous caecum, a true ileocecal junction, tapered appendix, and a smooth rectal transition. The distal colon must not form the oversized bulb now confused with the bladder.
6. Preserve depth order: colon frame/front surfaces should occlude the small-bowel edge where HRA Z ranges overlap; pelvis remains posterior to both.

## 8. Recommended implementation representation

The highest-fidelity from-scratch approach is numerical fitting, not manual primitive stacking:

1. Sample official meshes offline in their shared world coordinates.
2. Lungs/liver: fit cross-sectional ring tables or compact B-spline/SDF coefficients.
3. Pelvis: fit bilateral surface patches plus boolean negative-space fields and a separate sacrum/coccyx loft.
4. Bowel: extract/fix centreline splines, radius functions, named anchors, and local parallel-transport frames.
5. Commit only the normalized coefficients/landmarks and deterministic procedural generator; keep the official meshes as measurement fixtures under `reference-atlas/`.
6. Emit an organ-ID mask, linear-depth pass, and isolated front/±30°/profile renders on every judged build.

No organ should pass until its final generated mesh satisfies the gates in `reference-atlas/judging-baseline.md`, including per-axis OBB error `≤5%`, five-view mean silhouette IoU `≥0.90`, exact laterality, and landmark RMS `≤5 mm`.

## Sources inspected

- `reference-atlas/models/hra/lung-female-v1.3.glb` — HRA Female Lung v1.3, DOI `10.48539/HBM794.PKQV.978`.
- `reference-atlas/models/hra/liver-female-v1.1.glb` — HRA Female Liver v1.1, DOI `10.48539/HBM798.JZZM.649`.
- `reference-atlas/models/hra/pelvis-female-v1.2.glb` — HRA Female Pelvis v1.2, DOI `10.48539/HBM427.CCRP.887`.
- `reference-atlas/models/hra/small-intestine-female-v1.1.glb` — HRA Female Small Intestine v1.1, DOI `10.48539/HBM887.PSNL.257`.
- `reference-atlas/models/hra/large-intestine-female-v1.2.glb` — HRA Female Large Intestine v1.2, DOI `10.48539/HBM637.SRWT.828`.
- Baseline render: `/private/tmp/anatomy-official-baseline.png`.
- Supplied composition target: `/var/folders/5w/ff984qcn0bl_t4j4t3mwsny80000gn/T/codex-clipboard-d8a96ce4-27de-40f3-92d5-af1bf6d0eb09.png`.
