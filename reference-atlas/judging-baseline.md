# Adversarial anatomy parity baseline

**Verdict: REJECT — 62/100. The 90% stop gate is not met.**

This is an independent, deliberately strict baseline. It judges the current procedural model against two different standards:

1. The supplied 630×900 frontal image is the visual-composition target.
2. Official Human Reference Atlas (HRA) and BodyParts3D meshes are the anatomical geometry and placement authorities.

The supplied image has stock-image styling and is not treated as medical ground truth. When its anatomy conflicts with an official atlas, atlas geometry wins; lighting, crop, color, translucency, and visible-layer ordering may still follow the supplied image.

## Frozen inputs

- Target: `/var/folders/5w/ff984qcn0bl_t4j4t3mwsny80000gn/T/codex-clipboard-d8a96ce4-27de-40f3-92d5-af1bf6d0eb09.png`
- Current render: `/private/tmp/anatomy-official-baseline.png`
- Both images: 630×900 RGB
- Target SHA-256: `b45065efc31e1d91c8dc19cde414e6f3bfc92cda4cd15f5fb58201b60e5372b8`
- Current-render SHA-256: `8ac76ea684e3fcd38bd6d4823106a6b0930f928a338b702d512f272bcc5cd79c`
- `index.html` SHA-256: `823c765d7fdc549d55344abc4f2fa56060af79206e32f903ea10c68065b83917`
- `procedural-heart.js` SHA-256: `d2ced88d3db54e49765b711a256ee29f5f97b1708be6011dbb22917b1d028f8a`

Pixel boxes below use `[left, top, right, bottom]` in the common 630×900 frame. They are hand-audited estimates with about ±4 px uncertainty because neither image currently exposes an organ-ID mask. They are sufficient to identify gross failures, but future scores must come from deterministic segmentation renders.

## Pixel-first failures

| Structure | Target bbox | Current bbox | Centroid delta | Width / height error | Shape finding |
|---|---:|---:|---:|---:|---|
| Patient-right lung (image-left) | `[187,121,316,369]` | `[188,119,319,377]` | `(+2,+3)` px | `+1.6% / +4.0%` | Envelope is close, but the current surface is a tapered ovoid. It lacks a convincing broad diaphragmatic base, three-lobe volume transition, hilar indentation, and natural fissure geometry. |
| Patient-left lung (image-right) | `[316,121,444,369]` | `[320,119,439,374]` | `(-0.5,+1.5)` px | `-7.0% / +2.8%` | Envelope is close. Cardiac notch, lingula, medial border, and two-lobe asymmetry remain too weak; both lungs read as near-mirrored primitives. |
| Heart myocardium | `[270,191,372,352]` | `[307,226,392,330]` | `(+28.5,+6.5)` px | `-16.7% / -35.4%` | Too far image-right, much too short, and too compact. The ventricular cone, atrial shoulders, apex direction, pericardial relation, and great-vessel emergence do not match the target silhouette. |
| Liver | `[184,332,399,484]` | `[201,331,427,473]` | `(+22.5,-6)` px | `+5.1% / -6.6%` | Gross size is plausible, but the whole mass is too far image-right. Right/left lobe balance, inferior sharp margin, diaphragmatic dome, falciform division, and stomach impression are insufficient. |
| Gallbladder | `[245,420,278,457]` | `[239,409,275,447]` | `(-4.5,-10.5)` px | `+9.1% / +2.7%` | Too superior and too exposed. It should sit tucked under the visceral liver surface with only the fundus clearly visible in this view. |
| Stomach | `[300,382,429,505]` | `[285,384,430,483]` | `(-7,-10)` px | `+12.4% / -19.5%` | Too wide and shallow. Current form reads as a bent, inflated tube rather than a continuous fundus/body/antrum/pylorus with distinct greater and lesser curvatures. |
| Spleen | `[403,385,452,488]` | `[421,366,473,484]` | `(+19.5,-11.5)` px | `+6.1% / +14.6%` | Too lateral and superior, too thin, and too crescent-like. It needs an ovoid wedge with convex diaphragmatic and concave visceral faces. |
| Large intestine | `[187,459,445,731]` | `[190,458,431,722]` | `(-5.5,-5)` px | `-6.6% / -2.9%` | Outer envelope is one of the closest. Failure is topological: transverse sag, flexures, caecum, appendix, haustral cadence, sigmoid loop, and rectal transition are still generic-tube approximations. |
| Small intestine | `[216,488,416,685]` | `[208,492,409,679]` | `(-7.5,-1)` px | `+0.5% / -5.1%` | Envelope is close, but the repeated loop field is too orderly, has conspicuous crossings, and lacks correct duodenal, jejunal, ileal, and mesenteric organization. |
| Bladder / rectosigmoid visual cluster | `[279,681,357,751]` | `[277,667,361,742]` | `(+1,-11.5)` px | `+7.7% / +7.1%` | Too superior and too bulbous. The current bladder cannot be cleanly separated from the oversized distal-colon loop in the frontal render. |
| Female bony pelvis | `[157,556,476,782]` | `[153,541,478,816]` | `(-1,+9.5)` px | `+1.9% / +21.7%` | Width is close but it is far too tall. Iliac wings are flat panels, obturator foramina are circular torus rings, and sacrum, acetabula, pubic arch, ischia, and pelvic inlet do not form a coherent osseous surface. |
| Image-left hand/forearm endpoint | `[0,634,95,812]` | `[0,633,76,827]` | clipped | `about -20% / +9%` | Hand is too lateral, narrow, low, and clipped. Fingers project as sparse wires rather than articulated hand anatomy. The image-right side has the mirrored defect. |

The table shows why continued XYZ/scale nudging alone will plateau: lung and bowel bounding boxes are already reasonably close, yet their shape similarity is not. Replacement needs atlas-derived surfaces or atlas-fitted procedural representations.

## Strict scorecard

Category weights are morphology 30%, scale 15%, centroid/placement 25%, occlusion/depth 10%, and material realism 20%. A score of 90 means the structure is allowed to pass, not merely that it is recognizable.

| Structure | Morphology | Scale | Placement | Occlusion | Material | Composite | Decision |
|---|---:|---:|---:|---:|---:|---:|---|
| Patient-right lung | 56 | 94 | 96 | 60 | 62 | **73.3** | Reject |
| Patient-left lung | 58 | 91 | 97 | 60 | 62 | **73.7** | Reject |
| Heart | 58 | 55 | 55 | 60 | 60 | **57.4** | Reject |
| Trachea/main bronchi | 60 | 84 | 80 | 68 | 60 | **69.4** | Reject |
| Thyroid/laryngeal region | 34 | 55 | 56 | 50 | 40 | **45.5** | Reject |
| Liver | 57 | 82 | 73 | 66 | 55 | **65.2** | Reject |
| Gallbladder | 48 | 78 | 69 | 55 | 57 | **60.2** | Reject |
| Stomach | 48 | 72 | 72 | 64 | 60 | **61.6** | Reject |
| Spleen | 43 | 75 | 62 | 60 | 50 | **55.6** | Reject |
| Small intestine | 59 | 94 | 91 | 75 | 58 | **73.7** | Reject |
| Large intestine | 54 | 90 | 92 | 80 | 58 | **72.3** | Reject |
| Urinary bladder | 49 | 82 | 80 | 70 | 58 | **65.6** | Reject |
| Female pelvis | 42 | 76 | 89 | 70 | 48 | **62.9** | Reject |
| Rib cage and spine | 38 | 70 | 58 | 44 | 44 | **49.6** | Reject |
| Appendicular skeleton | 40 | 72 | 68 | 60 | 46 | **55.0** | Reject |
| Major vasculature | 35 | 75 | 66 | 55 | 52 | **54.1** | Reject |
| Transparent body shell | 32 | 80 | 76 | 55 | 36 | **53.3** | Reject |

**Unweighted strict mean: 61.7, rounded baseline: 62/100.** No visible structure reaches the 90 gate.

The brain, pancreas, kidneys, adrenal glands, and diaphragm cannot be fairly scored from this target frame: the head is cropped and the abdominal structures are normally posterior or occluded. They are not exempt. They must pass the 3D atlas gates below using isolated and multi-view renders before being accepted. A code inspection still identifies high risk: the pancreas is a translucent tube, kidneys are deformed ellipsoids with a front/back rather than medial hilar indentation, adrenals are small noisy spheres, and the diaphragm is a low-opacity radial grid.

## Anatomical and measurement blockers

1. **Lung laterality is semantically reversed.** The code states that `+X` is the patient's left, but `buildLungMesh('left')` places the object at negative X and stores it as `leftLung`. The horizontal fissure is consequently on the visually correct patient-right side but attached to the wrong semantic ID. Fix the identity/anchor convention before registration; otherwise automated atlas comparison will compare the wrong lungs.
2. **The heart uses a negative X scale.** That is visually convenient but complicates signed volume, surface normals, exported winding, and correspondence. Bake the reflection into the procedural vertices or the canonical body transform before any mesh metric is trusted.
3. **Every organ has an independent hand-tuned transform.** This prevents a single consistent body coordinate frame. Register one global transform from HRA/BodyParts3D coordinates into scene units, then preserve each official organ's atlas transform.
4. **There is no deterministic organ-ID/depth pass.** RGB thresholding cannot separate overlapping pink organs. Every scoring capture must output a flat-color organ-ID mask and linear depth map alongside the beauty render.
5. **The current shell is composed of revolved/tubular pieces.** Its bright diagonal seams and straight limb columns materially change both organ occlusion and global pixel similarity.

## Official reference policy

Only these two geometry sources are approved for this parity program:

- **Primary:** [Human Reference Atlas 3D Reference Object Library](https://humanatlas.io/3d-reference-library). The HRA describes its GLB reference organs as anatomically correct, created by a medical illustrator, approved by organ experts, registered in a common coordinate framework, ontology-tagged, and released under CC BY 4.0.
- **Secondary/fallback:** [BodyParts3D official download](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html), including its PART-OF hierarchy and common-body OBJ set. Its [official license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html) is CC BY 4.0.

Do not mix meshes from unrelated commercial/marketplace anatomy packs. Different donors, postures, units, sex, and coordinate frames would destroy the Lego-style registration strategy.

### Source assignment

| Component | Shape authority | Placement authority | Notes |
|---|---|---|---|
| Lungs, bronchi, trachea | HRA female lung GLB | HRA female common frame | Preserve left/right ontology IDs, lobes, bronchopulmonary segments, hila, and airway tree. |
| Liver | HRA female liver GLB | HRA female common frame | Use the liver surface, impressions, porta hepatis, capsule, and Couinaud structures as fitting constraints. |
| Small intestine | HRA female small-intestine GLB | HRA female common frame | Fit duodenum, jejunum, ileum, and terminal ileum separately; do not optimize only the outer 2D envelope. |
| Large intestine | HRA female large-intestine GLB | HRA female common frame | Keep ascending, transverse, descending, sigmoid, caecum, rectum, appendix, and both flexures as named parts. |
| Female pelvis | HRA female pelvis GLB | HRA female common frame | Registration scaffold for bladder, bowel, femora, and body shell. |
| Heart, pancreas, spleen, kidneys, bladder, brain, vasculature, skin/skeleton | HRA object where available | HRA female/United female common frame | HRA first; BodyParts3D only when the required whole-organ object is absent from the selected HRA release. |
| Stomach, gallbladder, adrenals, diaphragm, missing skeletal details | BodyParts3D PART-OF object | BodyParts3D full-body frame, then one documented cross-atlas registration into HRA | Relevant official IDs are already present in the staged BodyParts3D name table. |

The staged HRA files are not generic decorative assets; their raw GLB accessor ranges occupy a shared body coordinate space and therefore support mathematical placement. Current inspection found:

| HRA file | Nodes / meshes | Raw accessor-space envelope |
|---|---:|---|
| `lung-female-v1.3.glb` | 75 / 56 | `[-0.1305,0.3671,-0.1564]` to `[0.1206,0.5901,-0.0038]` |
| `liver-female-v1.1.glb` | 33 / 26 | `[-0.1349,0.2625,-0.1538]` to `[0.1122,0.4325,0.0124]` |
| `small-intestine-female-v1.1.glb` | 11 / 9 | `[-0.0871,0.0789,-0.0782]` to `[0.0744,0.2961,0.0218]` |
| `large-intestine-female-v1.2.glb` | 11 / 10 | `[-0.1265,-0.0133,-0.1465]` to `[0.1168,0.2817,0.0469]` |
| `pelvis-female-v1.2.glb` | 24 / 14 | `[-0.1670,-0.0468,-0.1825]` to `[0.1498,0.1647,0.0003]` |

These numbers must remain in source coordinates until the single atlas-to-scene transform is solved. Do not independently recenter each file: that would discard the placement information the user specifically wants.

## Objective 90% gates

### A. Mesh and landmark gates

Normalize all distance metrics by the reference organ's oriented-bounding-box diagonal `D`; also report millimetres after confirming source units.

| Metric | Per-organ pass requirement |
|---|---:|
| Semantic identity/laterality | Exact ontology/side match; any reversal is an automatic failure |
| Manifold validity | No NaN/Inf, no non-manifold edges; closed organs watertight; outward normals |
| OBB extent error | `<= 5%` on each principal axis |
| Volume error | `<= 10%` for closed parenchymal organs |
| Surface-area error | `<= 12%` |
| Voxel Dice at agreed resolution | `>= 0.90` |
| Symmetric Chamfer, median | `<= 0.015 D` |
| Symmetric Chamfer, 95th percentile | `<= 0.040 D` |
| Robust Hausdorff, 95th percentile | `<= 0.050 D` |
| Surface-normal consistency | `>= 0.90` |
| Organ centroid placement | `<= 0.005` of body height and `<= 8 mm` |
| Named-landmark RMS | `<= 5 mm`; every landmark `<= 8 mm` |
| Principal-axis angular error | `<= 5 degrees` |
| Pairwise organ-anchor distance error | `<= 10 mm` |
| Non-anatomical interpenetration | `< 1%` of the smaller organ's volume |
| Expected contact coverage | Within `±10%` of atlas contact area |

Required named landmarks include, as applicable: lung apex/base/hilum/fissure endpoints; heart apex/base/aortic root/pulmonary trunk/vena-cava entries; liver extrema/porta hepatis/falciform groove/gallbladder fossa; stomach cardia/fundus/incisura/pylorus; renal poles/hilum; bowel flexures/caecum/ileocecal valve/sigmoid/rectum; pelvic ASIS, acetabular centres, pubic symphysis, sacral promontory, and ischial tuberosities.

### B. Fixed-camera render gates

Lock camera, crop, renderer, lights, exposure, tone mapping, background, DPR, pose, visible systems, and animation phase before comparison. The supplied target is always rendered at exactly 630×900. In addition, render atlas-comparison views at front, ±30° three-quarter, and both profiles; a procedural mesh may not pass by imitating only one silhouette.

| Metric | Per-organ pass requirement |
|---|---:|
| Organ silhouette IoU, target front view | `>= 0.90` |
| Mean silhouette IoU across five atlas views | `>= 0.90`; no view `< 0.85` |
| Boundary F1 at 2 px tolerance | `>= 0.90` |
| 2D centroid error | `<= 5 px` in target front view |
| Projected bbox width/height error | `<= 5%` each |
| Visible-fraction error | `<= 5 percentage points` |
| Depth-order accuracy at overlapping organ edges | `>= 95%` |
| Mean masked color difference, CIEDE2000 | `<= 6` after exposure calibration |
| Masked SSIM | `>= 0.90` |
| Global body silhouette IoU | `>= 0.90` |
| Global organ-ID mean IoU | `>= 0.90` |

Beauty-image SSIM is not allowed to hide a bad organ mask. Geometry/landmark, organ-ID silhouette, depth-order, and material gates are reported separately.

### C. Stop policy

The project may claim 90% only when all of the following are true:

1. Every priority visible structure has composite `>= 90`.
2. No component category for any priority structure is below `85`.
3. All semantic, laterality, mesh-validity, and landmark hard gates pass.
4. The global weighted score is `>= 90` on two consecutive unchanged builds.
5. A fresh adversarial judge reproduces the result from frozen inputs and masks.

An organ that is hidden in the supplied frontal image can pass only through the official-atlas multi-view and mesh gates. It may not receive 90 by being invisible.

## Replacement and judging order

1. Establish one HRA-female canonical coordinate transform and fix lung laterality.
2. Replace/fit both lungs and their airway anchors; judge shape before material.
3. Re-register the procedural heart to HRA thoracic landmarks and eliminate negative scale.
4. Replace/fit liver, then gallbladder, stomach, spleen, pancreas, and kidneys using shared neighbor anchors.
5. Replace/fit large intestine and pelvis; use their shared coordinate frame to lock bladder and small intestine.
6. Rebuild rib cage, appendicular skeleton, vasculature, and shell only after organ placement is frozen.
7. Run isolated-organ mesh metrics, multi-view ID-mask metrics, then the 630×900 beauty comparison after every replacement.

The next meaningful improvement is not another round of freehand scale sliders. It is a measured atlas registration followed by one organ replacement at a time, with this judge rerun after each change.
