# Build Tracker — Silhouette + Anatomical Joints + Rig + MediaPipe Motion

Working file: `index.html` (single-file app, Three.js r162).
Backup before any edits: `index.pre-motion-rig-2026-07-18.html`.
Scope guard: **organs are NOT touched visually** (re-parenting for motion only). Only silhouette, skeleton joints, rig, and MediaPipe code change.

User decisions: arms + wrist orientation only (no fingers) · mirror mode · PiP webcam preview with landmarks, toggleable.

## Phase 1 — Body silhouette reshape (match reference figure)
- [x] 1.1 New `torsoProfile` (trapezius slope, waist 0.82, rounder hips) sampled through a CatmullRom `sampleProfile` helper
- [x] 1.2 `applyTorsoShaping()` — gaussian vertex displacement for bust, lower abdomen, glutes, lumbar curve (no separate breast shells)
- [x] 1.3 Deeper `torsoDepthStops` so organs stay inside the shell in profile
- [x] 1.4 Leg profile: fuller thighs, defined calves + inner-thigh adductor fill
- [x] 1.5 Arm radii taper; shoulder cap spheres REMOVED (they read as a collar shelf)
- [x] 1.6 Closed torso underside + domed limb-segment caps (no open lathe rims)
- [x] 1.7 JUDGE round 1 (3.5/10 → fixes applied); round 2 running

## Phase 2 — Anatomical bone joints (replace sphere blobs)
- [x] 2.1 Shoulder: humeral head + greater tubercle + surgical neck + glenoid rim torus
- [x] 2.2 Elbow: trochlea + capitulum + both epicondyles + olecranon + radial head (olecranon now swings with the forearm)
- [x] 2.3 Wrist: 8-bone carpal cluster in two rows
- [x] 2.4 Hip: femoral head seated in the acetabulum + angled neck + greater/lesser trochanters
- [x] 2.5 Knee: paired femoral condyles + intercondylar notch + tibial plateau + tuberosity + patella + fibular head
- [x] 2.6 Ankle: medial/lateral malleoli (lateral lower, as in life) + talar dome
- [x] 2.7 Verified in skeleton + close-up renders

## Phase 3 — Persistent articulation rig
Chose **pivot groups over SkinnedMesh**: limb skin is split into per-segment shells with domed caps, which suits the translucent shell look, avoids skin-weight artifacts, and keeps organs untouched.
- [x] 3.1 `RIG_JOINTS` table + `buildRig()` — 17 pivots: Pelvis→Spine→Chest→Neck→Head, Chest→arms, Pelvis→legs
- [x] 3.2 Pivot + compensating inner group (offset by −jointPosition) so every piece keeps its original coordinates → bind pose pixel-identical, pinned organ placements still valid
- [x] 3.3 Limb skin segmented (`makeLimbShell` arms, `clipLimbProfile` legs), each piece tagged `userData.limbPivot`
- [x] 3.4 Bone segments nested: thigh→shin→foot, upperArm→forearm→hand
- [x] 3.5 `assembleRig()` claims all tagged pieces; organs → Spine/Head/Pelvis
- [x] 3.6 Limb vessels split at joint Y via `addVessel(..., limbSpans)` so they bend with the limb
- [x] 3.7 Layer toggles refactored to tag-based `forEachShellMesh`/`setShellLayerVisible`
- [ ] 3.8 NOT DONE: `bodyGroup.scale.x = 1.18` still present → limbs rotated far from vertical stretch ~18% horizontally

## Phase 4 — MediaPipe motion capture
- [x] 4.1 `@mediapipe/tasks-vision` via CDN, PoseLandmarker VIDEO mode, GPU delegate with CPU fallback, `pose_landmarker_full`
- [x] 4.2 "Live Pose" sidebar button; getUserMedia lifecycle; permission-denied and model-failure fallbacks; stop → eases back to rest
- [x] 4.3 Solver: worldLandmarks → One Euro filter → per-joint quaternions (head, pelvis+chest lean/twist, upper arms, forearms, wrists, thighs, shins, feet) with angle clamps, visibility gating, mirror mode
- [x] 4.4 PiP overlay: mirrored webcam + drawn landmark skeleton; hide and stop buttons
- [x] 4.5 Wired into `animate()`; auto-rotate disabled and body eased to face forward while tracking
- [x] 4.6 Verified via synthetic landmark playback (no camera needed): raised right hand → mirrored arm raises, skin+bones+vessels follow together
- [ ] 4.7 NOT DONE: live webcam run with a real person (needs a human in front of the camera)

## Verified so far
- 17 rig pivots build; zero page errors; all 110 tagged pieces land on the correct pivot
- Bind pose renders identically to the pre-change build (organs, skeleton, pinning intact)
- Synthetic mocap: correct mirror side, independent joints, vessels bending with limbs
- Idle state relaxes smoothly back to rest pose

## Debug hooks added (`window.__ANATOMY_DEBUG__`)
`rig`, `tracker` (lazy getter), `setJoint(name,x,y,z)`, `resetPose()`, `feedPose(result)`, `camera`, `controls` — these let the headless harness drive and inspect the rig without a webcam.

## Harness note
`shot.mjs` arg parsing needed `[\s\S]` instead of `.` — multi-line `--eval` payloads were silently dropped, which masked working code as "not applied". Worth remembering when a headless eval appears to do nothing.

## Judge protocol (every phase)
Multi-agent workflow: (a) visual judges score the headless screenshot against the reference image / expected pose on a written rubric, (b) an adversarial code reviewer hunts real bugs in the diff, (c) a regression judge confirms organs + UI untouched. Findings are fixed before the phase is checked off.

## Status log
- 2026-07-18: Tracker created. Research + codebase exploration + architecture design done. Phase 1 started.
- 2026-07-18: All four phases implemented. Judge round 1 on the silhouette scored 3.5/10 (paper-thin side profile, shoulder cap spheres, open hip rim) — all three fixed. Rig + motion capture verified end-to-end with synthetic landmarks. Final judge panel running.

## Judge round 2 — findings and what was done

Three reviewers (rig/mocap code, regression, visual) scored 3/3/4. They were right and my
visual spot-check was wrong: the frame was cropping the legs, hiding a real displacement.

**Fixed:**
- [x] `assembleRig` used `add()` where pieces are authored in *mixed* coordinate spaces. Leg
      shells and nested bone pivots (shin/foot/forearm/hand) are parent-relative, so they
      teleported — the thigh sat at world y −4.22 instead of 0. Now `attach()` after
      `bodyGroup.updateMatrixWorld(true)`; verified thigh at (0.86, 0). This was the earlier
      `attach()` attempt's real failure too: stale world matrices, not `attach()` itself.
- [x] `bodyGroup.remove()` silently no-oped once the rig owned a piece, so every rebuild
      duplicated geometry (a ghost organ per pixel of slider drag). All 29 call sites now use
      `detachFromBody()`, which removes from the actual parent.
- [x] Individual organ rebuilds left new geometry outside the rig. `addOrgan`/`addOrganGroup`
      and the 7 group builders now call `scheduleRigSync()` (rAF-coalesced `assembleRig`).
- [x] Skeleton toggle/x-ray missed limb bones because the rig empties `organs.armBones`/
      `legBones`. Bone meshes now carry `userData.skeletonPart`; toggles resolve by tag.
      Verified: 200 bone meshes hide and restore.
- [x] A tracking start failure froze the body in its last pose — `error` now relaxes like `idle`.

**Still open (ranked):**
- [ ] Foot joint uses the global bind axis (0,−1,0) but foot geometry rests pointing +z, so both
      feet pitch down ~57° while tracking. Give `aimJoint` a per-joint bind axis.
- [ ] Muscle-layer legs never got `limbPivot` tags, so in muscle view they swing from the chest.
      Split and tag them like the skin legs.
- [ ] Arm rig pivots are derived from raw params and ignore `armAngle`/`elbowAngle`, so the
      elbow/wrist pivots sit ~0.19 off the real joint. Derive them from the same transform chain
      the bones use. The vessel split levels have the same class of error.
- [ ] Leg vessel spans start at y=99, pulling the pelvic vessel origin into the thigh pivot.
      Clamp the proximal span to the hip Y.
- [ ] Hover/click/sculpt/arrange collection still resolves limb bones and vessels through
      `organs.armBones`/`legBones`/`aorta`, which the rig empties — selection of limb parts is lost.
- [ ] `bodyGroup.scale.x = 1.18` → limbs rotated far from vertical stretch ~18%.
- [ ] Visual: in side profile the heart, colon and small intestine still breach the front shell;
      hands read as opaque rods rather than the glassy shell material.

## MediaPipe is vendored, not CDN-loaded
The CDN import 404'd because version `0.10.22` never existed (latest is `0.10.35`). Rather than
pin a new CDN version, the library is now local so tracking works offline and cannot break again:
- `vendor/mediapipe/vision_bundle.mjs` + `vendor/mediapipe/wasm/` (from `npm install @mediapipe/tasks-vision@latest`)
- `vendor/models/pose_landmarker_full.task` (9 MB, downloaded once)
- `server.py` now sends `application/wasm` for `.wasm` — without it the browser's
  streaming compile rejects the module.

**Camera verified working** end-to-end with Chrome's synthetic device
(`--use-fake-device-for-media-capture`): state `tracking`, video 640×480, **33 landmarks
detected**, PiP visible, zero errors. Still untested with a real person in frame.

## Hands and shoulders (user feedback)
- [x] Hands were spidery: finger tubes nearly as long as the forearm, on a flat disc palm, with
      visible cut ends. Rebuilt as **one continuous paddle** — palm widening at the knuckles,
      tapering to blunt fingertips, with shallow grooves suggesting fingers — sized to enclose
      the existing finger bones. Thumb moved to the same side as the thumb bones (it was mirrored).
- [x] Shoulder rounded: fuller deltoid band in the torso profile (crown at 8.99, max 1.34),
      the upper-arm shell barely tapers at its proximal end (`startFloor: 0.94`) and starts
      higher inside the torso, plus a low wide deltoid blend sunk into both surfaces — unlike
      the old cap sphere that sat proud of the trapezius and read as a separate ball.

## Arm / shoulder / joint pass (reference-image comparison)
Compared against the user's medical-atlas reference (arm + shoulder, X-ray style):
- [x] **Arm shape** — the old radius profile was nearly constant, so arms read as pipes. Now
      sampled as real muscle masses: deltoid crown 0.315 → deltoid max 0.375 → mid-humerus 0.300
      → elbow narrowing 0.232 → forearm flexor belly 0.248 → slim wrist 0.138. A real arm loses
      about a third of its width at the elbow and regains some over the forearm.
- [x] **Shoulder** — deltoid blend enlarged (0.40 × 0.34 × 0.35) and dropped to y 8.94 so it fills
      the torso/arm corner rather than perching on the trapezius.
- [x] **Bone joints** — shafts thickened to suit the fuller limb (humerus 0.040→0.055,
      radius 0.030→0.038, ulna 0.025→0.034) and joint masses scaled ~1.3× so the elbow and
      shoulder read as clearly wider than the bone, as in the reference: humeral head 0.150,
      trochlea 0.064, capitulum 0.056, epicondyles 0.030, olecranon 0.052×0.072, radial head 0.040.
- [x] **Hand** — the reference shows separated fingers, so the one-piece paddle was replaced by a
      flat palm plus five tapered digits built from deformed spheres (rounded tips, no open
      cylinder ends). Finger lengths 0.27–0.35 with a slight fan.

## Floating camera panel
Right edge, vertically centred, 260 px, live red pulse dot, mirrored feed with the landmark
skeleton drawn over it. `–` collapses to just the header (tracking continues), `×` stops tracking.


## Learn Mode — grab an organ off your own body (NEW)

Reach to a spot on your own torso, close your hand, pull away: that organ lifts out of the model,
enlarges, spins, and is narrated. Bring your hand back to your body to put it away.

- [x] `gesture_recognizer.task` vendored to `vendor/models/` (8.4 MB); GestureRecognizer runs
      alongside PoseLandmarker on the same `<video>`, on alternate frames. It returns hand
      landmarks *and* the gesture, so no separate hand tracker is needed.
- [x] **Body-frame hit test** (`handToBodyFrame`) — the palm is projected into a frame built from
      the user's own shoulders and hips: `u` = along the shoulder line (±1 at the shoulders),
      `v` = 0 at shoulders to 1 at hips. Invariant to distance from camera, body size and position
      in frame. Verified: shoulder round-trips to u=1, hip line to v=1.
- [x] **`ORGAN_REGIONS`** maps (u,v) rectangles to 5 organs (heart, both lungs, liver, stomach,
      brain), anatomically correct sides. `regionAt` picks the nearest region centre on overlap.
- [x] **Lung-ID swap compensated.** Confirmed the trap predicted in planning: the region for the
      user's *left* lung resolves to the `rightLung` object, because the two lung ids are swapped
      relative to every other organ in the pinned data. `resolveOrganId()` resolves by comparing
      actual world x, not by id name.
- [x] **State machine**: hover → `Closed_Fist` held 350 ms → holding. A `pulledAway` latch means
      the hand must first travel away from the torso (>0.95 body units) before returning (<0.78)
      ends the lesson — without it, the grab released instantly, since your hand is still on your
      body at the moment you grab. Plus a 600 ms grace period and a 900 ms hand-lost timeout.
- [x] **Presentation without re-parenting**: the organ's original local transform is recorded and
      it eases toward a target in the *same parent space* (lift toward viewer, slight rise, 1.6×
      scale, slow Y spin). Dimming reuses the existing x-ray pass. Verified the organ returns to
      exactly its home transform on release.
- [x] **Voice** via Web Speech API, sentence-sized utterances built from the existing
      `desc`/`functions`/`facts`; `cancel()` stops mid-sentence on release. All behind
      `voice.speak()` / `voice.stop()` so a hosted voice is a drop-in swap later.
- [x] `renderOrganDetail(id)` extracted from `selectOrgan()` so Learn Mode shows the same card
      without also hard-hiding every other organ and flying the camera in.
- [x] UI: `#ctrl-learn` toggle (on by default) and a `#grab-label` hint pill.
- [x] **Hardened**: `applyTrackedPose` now returns early unless `worldLandmarks[0]` has ≥33
      entries. A short array used to throw mid-function and take the whole render loop down.

Verified by synthetic landmark injection (no camera needed): hover label, grab after dwell,
organ floats 1.7 forward / 1.6× / spinning, detail panel opens, and returning the hand puts it
back exactly home with the panel closed. Tested with both heart and liver.

### Learn Mode debug hooks
`__ANATOMY_DEBUG__.grab`, `.voice`, `.presentation`, `.bodyFrame(pose, point)`, `.regionAt(u,v)`,
`.resolveOrganId(id)` — enough to drive the whole flow headlessly.

### Not yet done
- [ ] Live camera test of Learn Mode with a real person (synthetic only so far).
- [ ] Only 5 organs mapped; kidneys, spleen, bladder, intestines still to add.


### Learn Mode judge round — findings and fixes
Three reviewers (code / regression / UX) scored 4, 6, 5. Two criticals were real and my own test
had missed them because it released with an *open* palm:

**Fixed:**
- [x] **Heart was on the wrong side.** `u > 0` is the user's anatomical left (confirmed against
      liver and stomach, which were correct), but the heart region was centred at u = −0.14 — the
      user's *right* chest. The instinctive hand-over-heart spot fell into the left lung. Heart is
      now u[−0.12, 0.46]; lungs widened to match.
- [x] **Putting the organ back re-grabbed it in a loop.** You release with your hand still closed
      and still over your body, so the dwell timer immediately re-fired. Added an `armed` gate:
      after a release the hand must open before a new grab can start. Label now reads
      "Open your hand to pick another organ".
- [x] **The idle hand hijacked the release.** `Math.min` over all hands meant a hand resting at
      your side pinned the distance low forever, so the lesson could never be ended. The grabbing
      hand's index is recorded and only that hand is measured.
- [x] **"Pull your hand away" barely registered.** `u` and `v` have different scales (half-shoulder
      span vs shoulder-to-hip), so combining them raw under-counted sideways motion. Added
      `torsoDistance()` which normalises both to one unit.
- [x] **Organ only rose 35% on grab.** Blend now jumps to full on grab; reach adds extra float.
- [x] **Spin snapped 180° every half turn** — `slerp` takes the shortest arc. Rotation is now built
      directly with `setFromAxisAngle(...).premultiply(home)`.
- [x] **Two speech chains could drain one queue** (`cancel()` fires end/error asynchronously).
      Added a generation counter so stale chains go inert.
- [x] **A grab clobbered manual X-ray / sidebar selection.** The prior view state is snapshotted in
      `beginPresentation` and restored in `endPresentation`.
- [x] Reset button and the panel close button now end an active lesson instead of leaving the organ
      floating and narrating. Hand-lost timeout also covers the case where the body frame fails.
- [x] Fist now needs `score > 0.5`, a brief misclassification no longer resets the dwell, and
      capture is 1280×720 (a hand at 2 m was only ~40 px at 640×480).
- [x] Gesture-model load failure now disables the Learn button visibly instead of failing silently;
      clicking Learn with the camera off starts the camera.

**Still open (minor):** gesture model loads before `getUserMedia`, adding latency to camera start
for users who only want motion capture.

Verified end to end with synthetic frames: grab heart → hold → put back *while still fisted* →
organ returns exactly home → open hand → grab liver. The full "and so on" flow works.


### Why the arms still looked unchanged — the real cause
The user pushed back that the arms looked identical to before. They were right, and my earlier
diagnosis was wrong: I had resized the *shell* while leaving the *bones* as thin wires, and it is
the bones that give the reference its character.

Measured against the reference: the humerus was **15%** of the arm's width; the reference is
roughly **40%**. The vessels were visually louder than the skeleton.

- [x] Humerus 0.055 → **0.140**, radius 0.038 → 0.060, ulna 0.034 → 0.053
- [x] Femur 0.05 → 0.135, tibia 0.04 → 0.098, fibula 0.025 → 0.050 (same problem in the legs)
- [x] Joint masses scaled to stay wider than the new shafts (humeral head 0.210, trochlea 0.098,
      capitulum 0.086, olecranon 0.076×0.104, epicondyles 0.044, radial head 0.058)
- [x] Bone material 0.60 opacity / no depth write → **0.94 with depthWrite** so bones read as solid
      structures rather than washing out behind the shell
- [x] Radius and ulna were only ±0.02 apart, so at the new thickness they merged into one mass.
      Separated to ±0.055–0.080 with a natural convergence toward the wrist.

**Lesson for next time:** when a render "doesn't match the reference", measure the ratio of the
parts against the reference before changing anything. The shell was never the problem.


## Shape controls, Trace Arm, and the grab fix

### 1. Tuning sliders for skin shape and bone thickness
Seven new sliders in the "Tune & Reference" panel, wired through the existing `organSliders`
table (`{key, div, fn}`) exactly like the organ sliders:
- **Body Shape**: Shoulders, Waist, Bust, Arm thickness, Leg thickness
- **Bone Thickness**: Arm bones, Leg bones
New `organParams` keys (`shoulderWidth`, `waistWidth`, `bustSize`, `armThickness`,
`legThickness`, `armBoneThickness`, `legBoneThickness`), all defaulting to 1.0 = as authored.
Ranges deliberately span the real defaults (the pre-existing sliders have stale HTML `value=`
attributes and several sit outside their own min/max — worth fixing separately).

### 2. Trace Arm (modelled on Trace Liver)
Trace Liver warps a blob radially about its centroid. An arm is a *limb*, so the same idea is
adapted: the drawn outline is read as a **width profile along the limb axis**.
- `startTraceArm()` mirrors `startTraceLiver()` (overlay, 850 ms camera settle, Esc to cancel);
  `traceState.target` routes pointerup to the right applier.
- `applyTracedArmContour()` projects the shoulder and hand rig pivots to screen to get
  model-units-per-pixel, then samples the drawn polygon's half-width at the seven stations the
  arm shell is built from (`polygonSpanAtY`), and writes them to `organParams.armProfile`.
- `buildArmSkin` uses `armProfile` when present, else the authored radii.
- Verified: a drawn taper produced `0.10 · 0.31 · 0.38 · 0.39 · 0.32 · 0.20 · 0.12` — the shape drawn.

### 3. Why grab was not working
I was trusting MediaPipe's `Closed_Fist` **classifier label**. The user's reference implementation
(`pose-mirror`, `CombinedDetection.tsx`) uses raw MediaPipe hand keypoints via
`@tensorflow-models/hand-pose-detection` and never classifies gestures at all.

Fix: detect the fist **geometrically** from the 21 landmarks. A curled finger's tip sits closer to
the wrist than its own knuckle; the ratio is normalised by hand size (wrist→middle MCP) so it is
distance-invariant. `handCurl()` returns the fraction of curled fingers; `isFistHand()` fires at
≥0.6 (3 of 4). The classifier label is now only a secondary vote.
Verified: synthetic open hand → curl 0.00 (not a fist), closed hand → curl 1.00 (fist).


### Hand skeleton overlay in the preview
The reference app draws the 21 hand landmarks, their connections, and a handedness label. Mine
only drew the 33 body-pose points, so there was no way to tell whether the hand was being seen at
all — which is exactly what you need when a grab is not registering.

- `drawHandsPip()` draws the hand skeleton over the webcam preview: connections + landmark dots,
  coloured by handedness (left red / right blue, as in the reference), with a label at the wrist.
- The label shows the measured **curl percentage** and turns green with `FIST` when the geometric
  test fires, so grab detection is directly observable.
- Handedness is swapped for display because MediaPipe reports it for the un-mirrored image.
- `HAND_CONNECTIONS` is captured from `GestureRecognizer` at load time.
- The preview now repaints on gesture frames, not only pose frames, so the hand tracks smoothly.
- Verified by rendering a synthetic splayed hand into the preview canvas and counting drawn
  pixels (1481 red pixels, label "Left 0%" — correct for an open hand).


### Discoverability fix — the shape sliders were buried
The user could not find the new controls. They were present and functional, but sat at
**y ≈ 2300** inside a panel with an **878 px** viewport and a **2490 px** scroll height — below all
24 organ sections. Moved "Body Shape" and "Bone Thickness" to the **top** of the Tune & Reference
panel, so they are the first thing visible when it opens (now at y = 86, no scrolling).

Lesson: adding a control is not the same as making it findable. Check where a new control lands in
a scrolling container, not just that it exists in the DOM.


## Skin is now arrangeable and pinnable, like an organ

The white translucent shell (`skinMesh`) and the muscle layer can now be moved, rotated, scaled
and pinned through the **exact same** arrange pipeline as organs.

**Approach:** the skin is not an organ, so rather than forcing it into `organs`/`organInfo` (which
would put it in the sidebar and make system toggles hide it), a small side registry
`arrangeExtras` holds `bodySkin` and `bodyMuscle` with lazy getters — lazy because `rebuildBody()`
throws the group away and builds a new one on every shape change. Three helpers
(`arrangeObject`, `arrangeLabel`, `isArrangeTarget`) widen the gates in `selectArrangeOrgan`,
`pickArrangeOrganId`, `applyPinnedOrganPlacement`, `pinSelectedOrgan` and the toolbar labels.

**Click priority:** the skin wraps everything, so it is always the nearest raycast hit and would
have stolen every click from the organs. It is de-prioritised the same way `aorta` already was —
organs win, the shell is picked only when nothing else is under the cursor, and repeat-clicks
still cycle.

**Surviving rebuilds:** a pinned skin transform is re-applied after `assembleRig()` (via a
microtask) and after the trace-arm rebuild path, since `rebuildBody()` replaces the group.

**Verified end to end:** select → move + scale → pin → force a full rebuild via a shape slider →
transform identical; then a full page reload → still identical (round-trips through
`/api/settings`). Organ selection and the 12 existing organ pins are unaffected. The test pin was
removed afterwards so the shipped state is clean.

**Bug found while doing this:** there were two `const object = organId ? organs[organId] : null;`
lines; my first patch hit the wrong one, so pinning silently no-opped (the function returned early
before writing). Worth remembering — verify the patched line is the one that actually runs.


## Shape & Thickness moved into the CONTROLS sidebar
Third attempt at placement. The controls existed and worked, but the user could not find them:
first they were at the bottom of a 2490 px scrolling Tune panel; then at the top of that panel —
but the "Tune & Reference" button that opens it is bottom-right and is **covered by the arrange
toolbar** whenever Arrange mode is on, which is exactly when the user was looking.

Now they live in the CONTROLS sidebar directly under the SKIN / MUSCLE sliders, behind a
collapsible **"Shape & Thickness"** button: Shoulders, Waist, Bust, Arms, Legs, Arm bone, Leg bone,
plus a **Reset shape** button (which also clears a traced arm profile).

Both copies drive the same `organParams` keys and keep each other's readouts in sync, so the Tune
panel entries still work. Each sidebar change runs the rebuild, then `buildRig()` + `assembleRig()`
+ `restorePinnedOrganPlacements()` so the rig and any pinned skin survive.

**Bug introduced and fixed in the same pass:** the inserted markup opened a `<div>` it never
closed, which swallowed the rest of the sidebar and made the whole panel vanish. Caught because
the render showed no sidebar at all. Verified after the fix: 26 organ list items and the search
box still present.

**Note for future headless checks:** `#sidebar` is translated off-screen by default and slides in
on `:hover` (CSS line ~108/415), so it never appears in automated screenshots. Its absence in a
capture is not evidence that it is broken — assert on the DOM instead.


## "Select Skin" button — the skin was genuinely unclickable

The user reported they still could not move the skin. They were right, and my earlier verification
was wrong: I tested selection by calling `selectArrangeOrgan('bodySkin')` directly and never tested
an actual **click**.

Measured cause: `assembleRig()` moves limb skin into the rig pivots, so of **31** skin meshes only
**5** remain under `skinMesh`. Clicking an arm or leg therefore hits nothing in the clickable list,
and on the torso the shell is deliberately de-prioritised so an organ always wins. Net effect: the
skin could not be selected by clicking at all.

Fix: an explicit **"Select Skin"** button in the arrange toolbar. It turns arrange mode on if
needed and attaches the gizmo directly — no click-priority contest. Verified from a cold start:
button → arrange on → `bodySkin` selected → "Pin Body Skin" enabled → move → pin saved.

Also note the skin shell that can be moved is the **torso** group; limb shells ride the rig and are
shaped instead via the Shape & Thickness sliders and Trace Arm.

**Process lesson:** verifying a feature through its internal API is not verifying the feature. The
user interacts by clicking; the test must click.


## Shape settings now pin permanently, and Trace Arm tested as a user

### Pin Shape
`server.py` gained a `shape` section alongside `pinnedOrgans` and `pose`, merged the same way
(numbers and number-arrays, `null` deletes). In the app, `saveProjectShape()` posts the seven
multipliers **plus `armProfile`**, and `applyProjectShape()` restores them inside the boot settings
fetch before the pose rebuild, so the body is built once with the pinned shape already applied.

A **Pin Shape** button sits in the sidebar Shape & Thickness group (shows "Shape Pinned ✓").
**Reset shape** clears the multipliers, drops any traced arm, and saves the cleared state.

Verified: set arm bone 1.70 + shoulders 1.30 → Pin → server holds the values → full reload → both
slider copies read 1.70 / 1.30 and the geometry matches.

Gotcha hit during this: `server.py` was already running, so the first test wrote nothing. Python
does not hot-reload — restart the server after editing it.

### Trace Arm, driven as the user
Pressed the button, waited out the 850 ms settle, read the instructions, projected the real
`L_UpperArm` / `L_Hand` joints to screen (new `__ANATOMY_DEBUG__.jointToScreen` helper), drew a
closed outline around the actual on-screen arm with real pointer events, released.

Result: "Arm updated: 0.14 · 0.47 · 0.52 · 0.54 · 0.48 · 0.36 · 0.20" — matching the drawn shape —
overlay closed itself, arms visibly thickened. Then pinned it and reloaded: the traced profile came
back on its own (upper-arm half width 0.671 vs 0.375 authored).

**Behaviour worth knowing:** the arm radius profile is shared by both arms, so tracing one arm
reshapes both. Reasonable for a symmetric body, but it is not per-side.

Test state was reset afterwards: `armProfile` null, all multipliers 1.0, 12 organ pins untouched.


## Reference-matched arm traced and pinned (with a real bug found)

Traced the arm against the user's reference illustration, using vision to compare each iteration.

**Iteration 1** — targeted the reference's *shape* (deltoid bulge, elbow pinch, forearm belly, slim
wrist) but too tight: `[0.26, 0.34, 0.26, 0.185, 0.215, 0.105, 0.125]`. Silhouette was right, but
the bones stopped reading through the shell — the opposite of the reference.

**Iteration 2** — kept the shape, rescaled so the humerus still reads ~40% of arm width as it does
in the reference: `[0.34, 0.42, 0.35, 0.26, 0.30, 0.145, 0.16]`. Pinned profile on the server:
`[0.175, 0.418, 0.351, 0.261, 0.295, 0.150, 0.105]`.

### Bug found by looking, not by asserting
After iteration 1 the arm bones had vanished entirely — 0 bone meshes. Cause: `buildRig()` starts
with `bodyGroup.remove(rig.root)`, which takes every bone `assembleRig()` had parented into a pivot
with it. Trace-arm and the shape sliders called `rebuildBody(); buildRig(); assembleRig();` without
rebuilding the limb bones, so the bones were destroyed and never recreated.

Fixed by introducing **`rebuildBodyAndRig()`** (body + arm bones + leg bones + aorta + rig +
pin restore) and routing trace-arm, the sidebar shape sliders and shape-reset through it. Verified:
104 arm bone meshes present after a trace, and still 104 after a clean reload from the pin.

This is the same class of mistake as before — the numeric result ("Arm updated: …") looked correct
while the render was missing half its content. Only rendering and *looking* caught it.


## Arm thickness was shrinking the spine — compounding transform bug

The user reported the arm-thickness slider deforming the spine. It did, and the cause was worse
than a mis-scoped multiplier (the `abT`/`lbT` multipliers were correctly confined to
`rebuildArmBones` / `rebuildLegBones`).

**Measured:** moving the arm-bone slider four times shrank the spine's world width
`0.360 → 0.305 → 0.259 → 0.219 → 0.186` — each rebuild dividing x by exactly 1.18.

**Cause:** `assembleRig()` re-claimed organs with `attach()`. Organs are *not* rebuilt between
shape changes, but `buildRig()` detaches the previous rig root, so by the time an organ is
re-claimed its `matrixWorld` is stale and no longer includes `bodyGroup.scale.x = 1.18`.
`attach()` faithfully preserves that wrong world transform inside the new tree — which *is* under
the 1.18 scale — so it divided x by 1.18 again on every rebuild, compounding.

The ribcage looked fine only because it is pinned, so `restorePinnedOrganPlacements()` reset its
scale each time and masked the drift. The unpinned spine accumulated it.

**Fix:** organs and the skin/muscle shells are re-claimed with `add()`, not `attach()`. Their local
coordinates are already body-absolute and each inner group is net-identity, so `add()` places them
exactly and is idempotent however many times it runs. `attach()` is still correct for the tagged
limb pieces, which are rebuilt fresh each time and therefore always have a valid `matrixWorld`.

**Verified:** spine width holds at 0.425 and liver at 1.963 across five rebuilds; the arm slider
still works (arm bone width 0.42 → 0.56 at 2.0×) with the spine unchanged.

Rule of thumb worth keeping: `attach()` is only safe when the object's world matrix is currently
valid. For anything re-parented after its old parent was detached, use `add()` with known-good
local coordinates.


## Trace Arm was silently pinching both ends — end-station sampling bug

The user pointed out the traced arm still did not resemble the reference. They were right, and the
evidence was in my own output: I drew a profile asking for **0.34** at the shoulder and the trace
reported **0.15**. The hand end came back 0.09 instead of 0.17.

**Cause:** `applyTracedArmContour` sampled its seven stations at
`lerp(top + 2, bottom - 2, t)` — only 2 pixels in from the outline's extremes. A *closed* outline
pinches shut at its top and bottom, so those two samples read almost no width. Every traced arm
therefore tapered to a point at both the shoulder and the hand regardless of what was drawn, which
is exactly why it never matched the reference's full deltoid.

**Fix:** inset the sampling range by 7% of the outline's height, so the first and last stations
land on real width rather than the closing points.

**Result:** drawing `[0.34, 0.42, 0.35, 0.26, 0.30, 0.145, 0.17]` now returns
`0.34 · 0.42 · 0.35 · 0.26 · 0.30 · 0.14 · 0.21` — the middle five stations reproduce exactly.
Pinned and saved to the server.

**Remaining known difference from the reference:** the upper-arm and forearm are separate shells
(required so the elbow can articulate for motion capture), so a faint junction is visible at the
elbow where the reference has one continuous surface. The domed caps soften it but do not remove it.


## Per-part skin: each limb segment is now its own movable, pinnable piece

Removed the two deltoid blend spheres — however low their opacity, their silhouette read as a hard
circle drawn over each shoulder. The widened deltoid band in the torso profile and the full-width
top of the upper-arm shell carry that volume instead.

**Per-part selection.** Previously only the torso shell (`bodySkin`) could be selected, and only via
a button, because the rig scattered the limb shells into pivots as loose meshes. Now
`bundleShellParts()` regroups every tagged shell mesh into one group per joint at the end of
`rebuildBody()` (using `attach()`, since legs carry a pivot offset and rotation). That yields 13
skin parts — `skin:Head`, `skin:L_UpperArm`, `skin:L_Forearm`, `skin:L_Hand`, `skin:L_Thigh`,
`skin:L_Shin`, `skin:L_Foot` and the right-side equivalents — plus the same for muscle.

Each is a single Object3D, so it selects by mouse click, attaches to the gizmo, moves/rotates/scales,
and pins independently. `arrangeObject`/`arrangeLabel`/`isArrangeTarget` resolve `skin:*` and
`muscle:*` ids by live lookup (the parts are rebuilt on every shape change, so a registry would go
stale). Shell parts are de-prioritised in picking like the torso shell, so organs still win a click.

**Verified:** clicking on the forearm selects `skin:L_Forearm`; toolbar reads "Moving Left Hand
Skin" / "Pin Left Hand Skin"; forearm, right thigh and left hand were each moved to different
positions while `skin:L_Shin` stayed at the origin.

**Bug introduced and fixed in the same pass:** the regex that removed the deltoid block also ate the
enclosing `for (const side of [-1, 1]) {` header, leaving an unbalanced brace and a page that failed
to parse. Caught by a brace-depth check over the module body — worth doing after any regex-based
block removal.

**Test-harness note:** `__ANATOMY_DEBUG__.jointToScreen` is off by ~140px horizontally (it uses
`window.innerWidth` rather than the canvas rect), which is why several click tests missed. The
feature was fine; the aim was not. Scan across x when a click test finds nothing.


## Full-body framing + 360-degree turn tracking

**Framing:** the app's "home" camera was `frameReferenceOverview` — a deliberate atlas *crop* that
cut the head and feet. All home-view call sites (boot, deselect, panel close, debug reframe) now
use `frameBodyOverview`, which fits the whole body + plinth against both the vertical and
horizontal FOV. Starting Live Pose also reframes to the full figure. Verified: head y=150,
feet y=807 in a 900px viewport.

**Rotation:** turning around did nothing because (a) `tracker.yawTarget` was hard-set to 0 at
tracking start and never updated — the render loop actively pulled the body back to face front —
and (b) the pelvis solver clamps yaw at ±0.60 rad anyway. Now the hip line's direction gives the
user's facing: `yaw = atan2(-hipDir.z, hipDir.x)`, **unwrapped frame-to-frame** so a full turn
accumulates past the ±180° seam instead of snapping. The body root eases toward it; the
pelvis/chest solvers' yaw clamps were dropped to ±0.10/0.12 so gross rotation is not applied twice.
On stop, yaw state resets and the body eases back to face the viewer.

Verified with synthetic landmarks stepping 0→360° in 45° increments: `yawTarget` accumulated to
−360° (mirror-correct direction) and the body followed to −353° (eased). A 180° capture shows the
model's back — spine visible, still fully in frame.

Caveat for live use: MediaPipe's pose estimates get noisy when the person faces fully away (the
hips are inferred), so expect some wobble around 180° — the One Euro filter and the yaw ease absorb
most of it.


## Vertical scroll while zoomed
**Shift + scroll** now slides the view up and down the body (step scales with zoom so it feels
constant; clamped to y 0.3–11.2 so you cannot scroll into the void). Plain scroll still zooms;
right-drag pans too (`screenSpacePanning`), and `minDistance` lowered 5 → 2.5 for closer study.
Wheel listener runs in capture phase with `stopImmediatePropagation` so OrbitControls never
double-handles the event. Verified: target 5.49 → 0.30 (feet) → 11.2 (head), zoom distance
unchanged during shift+scroll.


## Positional arm retargeting (hand lands where YOUR hand is) — partly done

Researched approach, both parts standard: **normalized body-frame retargeting** (so differing
proportions do not matter) + **analytic two-bone IK** (law of cosines) to place the end effector.
This is what Unreal's IK Retargeter and mocap retargeting pipelines do — direction-only aiming can
never make "hand on chest" land on the chest, because the endpoint is wherever the avatar's own
arm length carries it.

Implemented:
- `buildUserTorsoFrame()` — orthonormal frame from the user's shoulders/hips, with scale
  (half shoulder span, torso length).
- `retargetToAvatar()` — wrist expressed as normalized (u, v, w) in that frame, then re-expanded in
  the avatar's own frame (uses `bodyGroup`'s world quaternion, so it still works when turned).
- `solveArmIK()` — two-joint IK in **delta form** (measure current triangle, compute the angles
  that would reach the target, apply only the difference). Stable and converges over frames. The
  user's real elbow supplies the bend plane, so the elbow still points where theirs does.
- Direction-aiming (`aimJoint`) is retained as a fallback when landmarks are not confident.

**Bug found and fixed:** `filteredPoint()` writes into the scratch vector it is handed, so holding
two of its results at once aliases them. `rs` (right shoulder) and `rh` (right hip) shared `_v2`,
so the torso frame's X axis was built from a **hip** instead of a shoulder — corrupting the whole
frame. Each landmark is now copied into its own vector immediately.

**Verified numerically after the fix:**
- arms hanging down → hand at y **4.48**, rest position is 4.47 (exact)
- hand one third down the torso → model hand at y **7.51**, which is exactly one third of the
  avatar's shoulder-to-pelvis span below its shoulders

**NOT finished:** the rendered arms still do not visually match the solved joints. The `L_Hand`
pivot reports (0.25, 7.29, 0.64) — correctly on the chest — while the drawn arm renders splayed out
to the side. So there is a remaining defect *between the solved pivot transforms and the geometry
that hangs off them*, not in the retargeting math. Prime suspect: `assembleRig()` re-claims tagged
limb pieces with `attach()`, which bakes the current world transform into their local transform —
if that runs while the arm is rotated, the offset becomes permanent. Organs and shells were already
switched to `add()` for exactly this reason; the tagged limb parts were not.

Also still open: `skin:L_Hand` / `skin:R_Hand` part groups are missing (11 of 13 bundled).


### Piecewise vertical scaling (fixed the head overshoot)
Scaling every axis by torso length sent "hand on head" to y 12.55 when the avatar's head is at
9.92 — because a person's head stands ~0.65 torso-lengths above the shoulders while this avatar's
sits only ~0.30 above. Now points ABOVE the shoulder line are scaled by
(avatar shoulder->head rise) / (user shoulder->head rise); points below still use torso length.
Result: hand-on-head now lands **0.80** from the head pivot (was 2.63 above it), hand-on-chest at
the correct height, both arms down exact at 4.48 / rest 4.47.

### STILL BROKEN: hand geometry is offset from the hand pivot
The solved `L_Hand` **pivot** is correct (0.49, 10.55 for hand-on-head). But the hand **geometry**
renders at about (-0.99, 11.89) — roughly 1.5 units adrift in x. So the arm chain solves correctly
and the drawn hand does not sit on it. Suspect the hand pieces are claimed by `assembleRig()` with
`attach()` (which bakes the current world transform into the local one) rather than following the
pivot cleanly — the same class of fault already fixed for organs and shells by switching to `add()`.
Related: `skin:L_Hand` / `skin:R_Hand` part groups are still missing from bundling (11 of 13).


### Root cause of the detached hand — FOUND, not yet fixed
Measured at REST (no tracking): `L_Hand` pivot sits at world x **1.47** while the hand geometry
sits at **3.25** — adrift by 1.78 before any pose is applied. The child group's local position
reads **2.65** where it should be ~1.27, i.e. 1.27 x 1.18^n.

Cause: `assembleRig()` re-claims tagged limb pieces with `attach()`. `buildRig()` first detaches the
old rig root, so those pieces' world matrices no longer include `bodyGroup.scale.x = 1.18`;
`attach()` then faithfully preserves that wrong world transform inside a parent that *does* carry
the scale, multiplying x by 1.18 again. It compounds once per rebuild — the same fault already
fixed for organs and shells by switching them to `add()`.

Attempted fix (REVERTED): rescuing every claimed piece back to `bodyGroup` before detaching the old
root. It halved the error (1.78 -> 1.13) but **duplicated geometry** (99 -> 198 hand meshes),
because the rescued pieces become direct children of `bodyGroup` and so survive
`detachFromBody(skinMesh)` in the next `rebuildBody()`, leaving strays alongside the fresh build.

Correct fix still to do: stop relying on `attach()` for limb pieces. They are rebuilt fresh on every
`rebuildBodyAndRig()`, so their transforms are already body-absolute at claim time — `add()` should
be correct for the shells, while the nested bone pivots (`forearmGroup`, `handPivot`, `shinPivot`,
`footPivot`) carry parent-relative offsets and need those baked into body space once at build time
rather than resolved by `attach()`.

Verified after revert: 99 hand meshes (no duplication), state is exactly as before the attempt.


### FIXED: rig joints ignored armAngle — the real cause of the detached hand
The offsets grew *down the chain* (upper arm 0.31, forearm 1.19, hand 1.78), which is not
compounding — it is a limb splaying outward while its joints stay on a straight vertical line.

`RIG_JOINTS` computed the elbow and wrist straight below the shoulder, but `buildArmSkin` builds the
arm with **armAngle** (19 deg outward in the saved pose) and **elbowAngle** already applied. So every
joint sat inboard of the limb it was supposed to rotate, and the hand ended up 1.78 clear of its own
wrist. Added `armJointPositions()`, which mirrors buildArmSkin's transform chain exactly (elbow bend
about the elbow, then the whole arm about the shoulder) and feeds the rig table.

Result: hand offset **1.78 -> 0.12**, forearm 1.19 -> 0.34. Joints now sit on their geometry.

Also replaced `attach()` in `assembleRig()` with an explicit resolve into bodyGroup space
(`inv(bodyGroup.matrixWorld) * node.matrixWorld`, decomposed after `add()`), which is idempotent and
cannot accumulate scale however many times it runs.

**Verified end to end:** hand-on-head places the hand geometry **0.88** from the head pivot with the
arm chain visibly connected through elbow and wrist; arms-down returns to rest exactly; mesh count
unchanged at 714 (no duplication from the earlier reverted attempt).


## Resource optimisation — measured, fixed, verified

Measured first with `renderer.info` (new `__ANATOMY_DEBUG__.gpuInfo()` hook) rather than guessing.

**Finding: a severe geometry leak.** Dragging one shape slider through 16 steps leaked **6,448
geometries** (1,113 -> 7,561) and grew the JS heap **105 -> 176 MB**. Every rebuild created fresh
BufferGeometry and detached the old meshes without ever calling `.dispose()`, so the GPU buffers
were never freed. A real slider drag fires hundreds of events — this would exhaust GPU memory.

**Fixes:**
1. `detachFromBody()` now disposes the geometry of everything it removes (`disposeGeometries()`).
   Materials are deliberately left alone: most are module-level and shared by the replacement
   meshes, so disposing them would blank the new build. Geometries are always per-rebuild.
2. `buildRig()` cannot blanket-dispose — organs live inside the old rig and are reused. It now
   marks everything reachable from `organs` / `skinMesh` / `muscleMesh` as keep, and frees only the
   orphaned limb shells and bone groups left behind by the previous build.
3. Shape sliders coalesce to **one rebuild per frame** (rAF) instead of one per `input` event.
4. Removed per-frame allocations from the tracking hot path (~60x/sec): shared scratch for
   `orientJoint`'s basis vectors and Euler, `aimJoint`'s identity quaternion, `retargetToAvatar`'s
   head vector, and `solveArmIK`'s six `.clone()` calls per arm per frame.

**Results:** geometries **6,448 leaked -> 0**, baseline count 1,113 -> **710**, materials 88 -> 88,
textures 63 -> 63, programs 39 -> 39. All flat across 21 rebuilds and during live tracking.

**Bonus fix found by the regression check:** clamping only the *distance* in the cosine law while
leaving the target point unclamped made the bend angles and the swing disagree about where the
target was, so an out-of-reach target (an arm at your side is further than the avatar can stretch)
oscillated — 4.51 -> 7.43 -> 5.48, settling a metre high. The target is now clamped to the reachable
sphere itself. Arms-down returns to **4.48** (rest 4.47) and hand-on-head holds at **0.80**.


## Second optimisation pass — full audit

Went back through the whole frame rather than assuming the first pass caught everything.

**Already fine (verified, not guessed):** textures are cached by `createOrganTexture` (count held at
63 across every rebuild); `setPixelRatio` is already clamped by the quality preset; materials do not
accumulate (88 -> 88); shader programs stable (39 -> 36).

**Found: the x-ray pass traversed every organ mesh on EVERY frame, forever.** Worse, the branch that
runs constantly is the *restore* branch — i.e. the normal, x-ray-off state — re-lerping ~700
materials toward opacities they had already reached. Now gated by `_xrayWatch`, which compares
`xrayMode` / `focusIsolation` / `selectedOrganId` each frame (three scalar compares) and re-enables
the traversal only while a fade is actually converging. Verified x-ray still dims (0.39) and
restores (1.0).

**Found: shadow casting was the single biggest frame cost.** 196 casters, and the organs and vessels
among them sit inside a translucent body where their shadows can never be seen — yet each is
re-rendered into the shadow map. `pruneShadowCasters()` now lets only the outer skin shell cast, and
runs at boot and at the end of every `assembleRig()`.

**Measured end to end:**
| | before | after |
|---|---|---|
| FPS | 47 | **74** |
| Triangles / frame | 2,020,103 | **1,379,359** |
| Draw calls | 2,012 | **1,804** |
| Shadow casters | 196 | **90** |

Visual check confirms the render is unchanged — organs, bones, shell and the ground shadow all
still present.

**Deliberately not done:** merging the 563 small meshes into batched geometry would cut draw calls
further, but it would destroy per-part selection and per-joint articulation, which the app depends
on. Not worth it.


## Camera preview is now a free-floating, resizable window
- **Drag** it anywhere by its header (buttons inside the header still work — the handler ignores
  pointerdowns that land on a `<button>`). Clamped so it can never be dragged off screen, and
  re-clamped if the browser window shrinks under it.
- **Resize** by the corner grip, or the **+ / −** buttons in the header (70 px steps).
  Range 170–720 px, locked to the canvas's 4:3 aspect. The canvas backing store stays at 320x240
  and only its CSS size scales, so making it bigger costs nothing to render.
- **Remembered** between sessions in `localStorage` under `anatomy.pip-window.v1`.
- Collapse (▾) and close (×) unchanged; the resize grip hides while collapsed.

Verified: drag (920,337) -> (240,190); grip resize 260 -> 404 px; two − then one + -> 264 -> 334 px;
canvas scaled to 334x251; state persisted; dragging to (5000,5000) clamped back on screen.


## Live-video jitter fixed — three input-handling defects

The user's recorded session showed the avatar trembling and arms jumping while they stood still,
plus legs stretching through the floor. All three causes were in input handling, not the solvers:

1. **One Euro filter corrupted by its own cache.** The per-frame cache keyed on
   `performance.now()`, which differs between calls, so it cleared itself constantly — every call
   re-advanced the filter with sub-millisecond dt, spiking its derivative and opening the adaptive
   cutoff so raw noise passed through. And it re-ran on every RENDER frame between camera frames.
   Now cached by the landmark array's identity (a new array only arrives with a new camera frame).
2. **Solver family flip-flop.** The 0.5 visibility gate had no hysteresis; a hand at the frame edge
   hovers around it, so the arm alternated between position-IK and direction-aim — two different
   answers. Now per-limb hysteresis (enter >0.65, leave <0.45); an untrusted limb eases to rest
   instead of switching solvers. IK targets additionally smoothed (0.35) with a 2 cm deadband.
3. **Legs driven by hallucinated landmarks.** Waist-up framing makes MediaPipe invent knees and
   ankles. Legs now require confident visibility or they ease to rest.

**Verified with realistic synthetic input (fresh array per frame, ±0.008 noise):** still-user hand
wobble **0.013**; flickering visibility max frame jump **0.015**; cropped legs deflection **0.000**;
arms-down 4.48 / hand-on-head 0.80 unchanged; ~60 fps.

**Harness note:** the cache advances once per NEW landmarks array, like real camera frames —
synthetic tests must allocate a fresh array per frame or the filter freezes.

## PROJECT MOVED — iCloud Desktop & Documents sync
At 14:15 on 2026-07-19 macOS moved the entire `~/Documents` tree into iCloud Drive. The project now
lives at `~/Library/Mobile Documents/com~apple~CloudDocs/Documents/HACKTHONS-2025/...`. Nothing was
lost (all of today's edits predate the move and are present; vendor/ intact at 49 MB). The server
was restarted from the new path. **Caution:** iCloud "Optimize Mac Storage" can evict local copies
of big files (the 9 MB pose model, 32 MB of wasm) — if the app ever fails to load offline, that is
why. Consider moving active dev projects outside the synced Documents folder.

## White translucent plate across the pelvis — FIXED (shader, not geometry)
The user reported a "white transparency" over the pelvic region. Root cause was **not** geometry: it
is the shell's Fresnel term in `bodySkinMat.onBeforeCompile`,
`anatomyAlpha = min(0.72, opacity * (0.32 + rim * 3.50))`. Face-on that is `0.18*0.32 = 0.058`;
edge-on it saturates to `0.72` — a **12x alpha swing**. The hip flare is broad and gently curved, so
from a camera at hip height it is edge-on across its *whole area* rather than at a thin sliver, and
the rim term turned it into an opaque white sheet seen through the belly.

Fix: fade the rim as the surface normal turns vertical.
`smoothstep(0.25, 0.80, abs(dot(normal, worldUpInViewSpace)))`, rim scaled by `1.0 - shelf`.
`viewMatrix * vec4(0,1,0,0)` supplies world up in view space, so it stays correct as the body rotates.

**Dead ends, so they are not retried:**
- *Removing the lathe's bottom cap* — that disc is only radius 0.28, far too small to span the hips.
  Reverted.
- *Reshaping the profile tail* so the hip→thigh transition descends instead of collapsing
  horizontally — just reshaped the plate into a bright funnel. Reverted; geometry is untouched.
- *Raising the Fresnel exponent* — measured, the plate's rim is **0.909–0.976**, actually *higher*
  than the silhouette edge itself (0.938). No falloff curve can separate them.
- *`fwidth()` screen-space gradient* ("thin sliver vs broad shelf") — measured worse: it dimmed the
  whole shell (waist control 68.0 -> 59.3) more than the plate.

**Measured result** (isolated torso, hip band vs an upper-torso control):
orig 119.0 / 68.0 -> final 79.8 / **68.0** — the control is bit-identical at every strength tested,
so the term only ever touches shelf-like surfaces. Full-body checked at front and rotated views:
head, shoulders, arms, legs all keep their outlines. Shoulder tops and knee caps also soften
slightly — same artifact class, and the shader term cannot be limited to the pelvis alone.

**Method note:** every numeric check I ran agreed with a wrong hypothesis until I rendered a
debug pass writing `rim` to red and `|n·up|` to green. Render the field before theorising about it.

## Batch: tutor, discoverability, correctness, quiz, blood flow — ALL DONE

### 1. Webcam errors were invisible — FIXED
`setTrackerStatus` wrote the message into `#pose-pip-status`, then the very next line hid the
whole PiP that contains it. A denied camera produced **no visible message at all**. Added a
`#top-stack` messaging layer (`showNotice`) independent of every mode and panel, plus
`TRACKER_ERROR_HINTS` pairing each error with the fix. getUserMedia's `NotFoundError` /
`NotReadableError` now separate from `NotAllowedError` instead of collapsing to one vague string.
**Verified end-to-end**: headless Chrome has no camera, so clicking Motion Capture reproduces the
real failure — the red banner and its hint now render.

### 2. Feet pitched toes-down while tracking — FIXED
`aimJoint` used one global `BIND_DIR (0,-1,0)` for every joint. Right for thighs/shins (hip→knee
points down), wrong for the foot, which runs **forward** from the ankle (bind geometry puts toes at
z +0.32, y -0.06). `aimJoint` now takes a per-joint bind axis; feet pass `FOOT_BIND_DIR`.
**Measured** with a synthetic neutral stance: the solver's own measured direction is
`(-0.09, -0.34, 0.94)`. Old vector demanded **69.9°** — past the 57.3° clamp, so it saturated
toes-down every frame. New vector needs **10.4°**. Shins/thighs stay at 0°.
*Trap for next time:* `toModelSpace` negates **all three** axes, so toes-toward-camera is
`z = -0.16` in MediaPipe space. My first synthetic test had the sign wrong and looked like a
failure at 56.6° — which was really the clamp.

### 3. Learn Mode covered 6 of 26 organs — FIXED
`ORGAN_REGIONS` 6 → **22**, spanning head/neck, thorax, both abdominal quadrants, retroperitoneum,
pelvis and three skeletal parts. Added `learnableRegions()`; `regionAt` now skips regions whose
organ is missing from the build (checked inline — it runs per frame and must not allocate).
Generalised the lung hack into `PAIRED_REGIONS`, resolving paired organs **by world position**.
**Verified**: 22/22 live, 0 dead, 0 centre misroutes — and it caught that `lungLeft` really must
map to `rightLung` (ids swapped) while kidneys are not swapped. Two ids I first guessed were wrong
(`adrenalGlands` → `adrenals`); checked against the real `organs` keys rather than assumed.

### 4. Narration had no captions — FIXED
`voice.speak(sentences, {title})` now mirrors every line to a caption bar with karaoke-style
highlighting, and **still runs the lesson when there is no speech engine at all** — paced by
reading speed (~70 ms/char, min 1.6 s) with a "no voice available" tag. Also falls back to timed
captions if the engine dies mid-lesson. Learn Mode therefore works muted, in a loud room, and for
anyone who cannot hear it. (Judges often watch muted.)

### 5. Instructions lived only in `title=` tooltips — FIXED
Hover-only means invisible on touch and to keyboard — the direct cause of the repeated "where are
the controls" problem. Added a **Help overlay** (`?` key, sidebar button, or corner button) and a
persistent **mode banner** that states the active mode's controls on screen. Every shortcut in it
was **read out of the code first**, not invented: M/R/S, `[`/`]`/`,`/`.`, Z, Esc, and the body
scrubber's arrow keys. `refreshModeBanner()` is polled from the render loop and guarded by an
html-equality check, so it cannot go stale no matter which control changed a mode, and costs
nothing.

### 6. Ask-anything voice tutor — BUILT
Hold **T** (or the mic button) while holding an organ, speak, release. Web Speech recognition in
the browser → `POST /api/ask` → Claude → spoken **and** captioned.
**The API key never touches the browser**: `server.py` adds it from `ANTHROPIC_API_KEY`. Without
the variable the endpoint returns a clean 503 and the UI explains what to do; the mic is not even
offered (`/api/tutor-status` is checked at boot), so there is no dead control. Model is Haiku 4.5 —
answers are short and spoken, so latency beats depth; override with `ANATOMY_TUTOR_MODEL`. The
prompt is given what the app already says about that organ, so speech and panel agree, and it is
told to defer to a clinician on personal-symptom questions.
**To enable:** `export ANTHROPIC_API_KEY=sk-ant-...` then restart the server.

### 7. Quiz Mode — BUILT
Names an organ, you find it on your own body and make a fist there. Reuses the whole Learn Mode
pipeline. Scores by **resolved organ**, not region id, so the swapped lung/kidney pairs score
correctly. Wrong answers name what you actually grabbed and reveal the right one on the model.
**Verified**: correct → score/streak/asked = 1/1/1; wrong → score held, streak reset 3 → 0.

### 8. Blood flow particles — BUILT
~574 particles on 69 `Points` objects. First attempt hand-guessed the vessel routes and the
particles floated outside the body — `bodyGroup` carries a 1.18 x-scale and the limb vessels sit
under moving pivots. Rewritten to read the **real** curves off `TubeGeometry.parameters.path`
(THREE retains them), bucketed by vessel parent so each `Points` inherits that parent's rig
rotation and can never drift off its tube. Vessels auto-discovered by material colour.
`depthTest:false` because the centreline is buried inside the vessel wall — invisible on the aorta
and vena cava otherwise; reads like an angiogram, which suits the translucent body.
**Verified**: 69 on / 0 off, still 69 objects after 10 toggles (build-once guard holds),
**0 geometry and 0 texture leaks** across 6 blood + 6 quiz cycles, 81 fps.

**TDZ caught again:** adding `quiz`/`tutor`/`captions` to `__ANATOMY_DEBUG__` crashed the module —
that object literal evaluates long before those consts initialise. Lazy getters, as with `tracker`.


## Gallbladder + intestines rebuilt from measured anatomy

Researched real dimensions first, then constrained the geometry to them rather than eyeballing.

### Gallbladder — real pear silhouette
Sources give 7-10 cm long, ~4 cm across, with fundus / body / infundibulum / neck, the **fundus**
being the widest part and close to spherical. The old mesh was widest across its MIDDLE and tapered
symmetrically to both ends — an ovoid, not a pear. Rebuilt as a swept variable-radius tube on a
curved axis (hangs down-forward-right, neck turns up and medially), with the fundus radius following
a **circular arc** so the blind end reads blunt and full, ~2:1 length:width.
*Two bugs caught by rendering:* a `q*q` neck falloff collapsed the last section into a spike (now
linear, holding calibre into the cystic duct); and the neck cap was added to the unscaled parent
group so it floated off the organ entirely (now a child of the sac, inheriting its scale).

### Small intestine — three failed models before one worked
1. Original: straight left-right rows in vertical lanes -> read as a stack of sausages.
2. Continuous coil (loop angle sweeping while its centre drifts) -> read as a **slinky**. Anything
   sharing one axis reads as a helix.
3. 13 hairpin folds over a 1.04 span -> **tore the surface**, because folds 0.087 apart cannot hold
   a tube 0.16 across. Self-intersection, not a shader bug.
4. Working model: real bowel gets density from filling a VOLUME (5-7 m in a ~20 cm box), so it is a
   3D serpentine over a 6 x 3 grid of (height level, depth layer):
   y spacing 0.208 and z spacing 0.210, both > the 0.16 tube diameter, so 18 runs are visible from
   the front with zero collisions. Each fold has its own tilt, length, centre, depth and **signed
   bow** on incommensurate periods, so nothing reads as parallel shelving.
   Calibre tapers jejunum -> ileum, with a per-vertex colour gradient (jejunum deeper red, ileum
   paler) and plicae circulares deepest proximally.
   *Watch:* the plicae ripple frequency must stay well under the tube segment count or it aliases
   into visible tearing. 260 half-cycles against 1500 segments did exactly that.

### Large intestine — anatomical calibre and real haustra
Measured internal diameters: cecum 4.4, ascending 4.5, transverse 3.7, descending 3.3, sigmoid
2.6 cm. The old radius table **broadened** the transverse, which is backwards; replaced with a
per-control-point calibre array normalised to the ascending limb, so the colon now narrows visibly
toward the sigmoid.
Haustra were 0.015 amplitude — effectively invisible, the colon read as a plain hose. Now scaled to
the **local** radius (an absolute amplitude is proportionally far larger on the narrow sigmoid and
beaded it into balloons), sparse proximally and strengthening distally, per the source.

### Why both looked dull
Not lighting — material. Bowel serosa is wet peritoneum, so it needs low roughness with a strong
**smooth** clearcoat; the old setup paired a weak clearcoat with a rough one (0.30 / 0.46) and
envMapIntensity 0.34-0.38, which is the recipe for "dusty". Now roughness ~0.34, clearcoat ~0.60 at
clearcoatRoughness 0.22, envMapIntensity ~0.85, plus slight transmission. Colon is hue-separated
from small bowel so the two stay distinguishable at equal brightness.

**Still open:** taeniae coli are modelled but still `visible = false` — they need to be flat ribbons
built on the tube's Frenet frames (3 bands at 120 degrees), not the round tube that read as wire.
The small-bowel mass could also fill more of the cavity.


## Rib cage: left and right ribs were fused into continuous hoops — FIXED

The user spotted that the ribs "are not a complete line, they do not touch". Correct, and the model
had it wrong in two compounding ways.

**1. True ribs swept a full half-circle.** `sweepFrac = 1.0` for pairs 1-7 meant `sin(angle)`
returned to 0 at the end, so left and right ribs met at x = 0. An explicit
`ribPts.push([side * 0.06, ...])` then pulled them the last step to the midline. Each pair rendered
as ONE unbroken hoop across the chest. Real ribs are separate bones that never touch: each ends at
its **costochondral junction** and costal cartilage carries on to the sternum.
Now `sweepFrac = 1 - asin(costochondralX[pair] / halfWidth) / PI`, solving for the sweep that ends
the bone exactly on the costochondral line (obliquely placed: 0.20 at rib 1 widening to 0.56 at
rib 7). The midline push is gone.

**2. The sternum was a rod, and cartilage was fake.** `createTube(..., P.sternumR = 0.040)` is about
1 cm across — far too thin to read as a breastbone, so nothing separated left from right. The
"cartilage" was not a separate span at all, just a recoloured overlay on the last 22% of the same
rib tube, which is why the bone still ran to the midline.
Sternum is now a broad flat plate (manubrium / body / xiphoid) built as a variable-radius tube whose
radius IS the half-width at each level, flattened with `scale.z = 0.32`. The path's z is pre-divided
by that factor so the forward tilt survives the flatten. Costal cartilage is now a real separate
span from each rib end to the sternum's lateral border, using shared `sternumProfile` /
`STERNAL_ATTACH` / `sternumZAt()` so cartilage always lands exactly on the plate edge.
Attachment levels were chosen against the computed rib-end heights so ribs 4-7 **ascend** medially
(the anterior end of a rib sits lower than its sternal attachment) rather than descending.

## Gallbladder position and proportion — FIXED

Measured, not eyeballed. The old placement put it 0.02 **in front of** the liver's anterior face and
ended 0.09 **above** the inferior border — a badge pinned to the front, never showing the one
landmark that identifies it: the fundus projecting past the inferior margin.

Sampled the liver's own geometry at the gallbladder's x band: inferior border runs y 6.49-6.62,
anterior face reaches z 0.41-0.52. Seated the organ against those numbers — fundus now 0.04 proud of
the margin, body 0.06 behind the liver face. Scale 0.68 -> 0.80, so length/liver-width is 0.348
(real GB 7-10 cm against a ~21 cm liver ~ 0.38).

**The real blocker:** editing the code changed nothing at first, because a saved pin in
`anatomy-settings.json` overrides the built default at load. Updated via `POST /api/settings` AND
aligned the code default so the two cannot disagree.

**Also:** the organ's long axis is oblique (down, forward and right along the fossa), not vertical.
Left near-vertical it was half-buried in the liver and only its silhouette showed — which is what
made it read as a flat green patch rather than a pear. Now `rotation.set(0.34, -0.12, 0.20)`.

## TDZ race exposed (third time this file has hit one)

Adding rib geometry pushed load past a threshold and surfaced
`ReferenceError: Cannot access 'selectedOrganId' before initialization`. Root cause: this module has
**top-level awaits** (the reference-atlas fetches), so evaluation is NOT one atomic synchronous run
— it suspends at each await and lets queued timers run. The 700 ms "atlas ready" timer could then
read a `let` declared ~5,000 lines further down while it was still in its temporal dead zone.
Declaration hoisted to just before its first use. Any timer or async callback in this file must only
touch bindings declared ABOVE it, not merely "somewhere in the module".


## Intestines rebuilt to match a reference anatomical model

### The dominant bug: createBowelTexture double sRGB-encodes every colour
`new THREE.Color(hex)` holds **linear** components under r162 ColorManagement, but the canvas is
tagged `SRGBColorSpace` and decoded to linear a SECOND time in the shader. Verified by reading the
live texture back: authored `#e8a68f` was stored as **(206.2, 97.0, 69.9)**; the linear prediction
is (205.8, 97.2, 70.0) and correct sRGB would be (232, 166, 143). Exact match to the linear
prediction — conclusive.

Effect: bowels rendered **21-27% dark**, and the **blue channel was crushed to x0.49**, which
dragged colon and small bowel into the same red-brown. That is the mechanical reason the two organs
looked like one tissue, and the true cause of the earlier "too dull" complaint that was papered over
with clearcoat and envMapIntensity. Fixed with `.convertLinearToSRGB()` before writing bytes;
verified the canvas now stores exactly the authored value.

**STILL OPEN — `createOrganTexture` has the identical bug** and feeds ~20 other organs. Measured:
the kidney texture stores (52, 13, 8), i.e. nearly black. Fixing it would brighten most of the atlas
at once, so it needs its own pass and a palette re-check. Not done here to keep scope to the
intestines.

### Colour must separate on HUE, not lightness
The two organs differed by 0-2 degrees of hue — the colon was just a washed-out small bowel, which
the eye reads as "same organ, further from the light". Re-authored: small bowel pink-red, colon
tan/khaki at clearly LOWER saturation.
*Trap hit on the way:* the first tan (rendered H33 S23% L73%) collided with the **pelvis bone**
(H33 S20% L65%) and the colon read as bone. Measured the offsets — scene lighting adds about +8
lightness and strips about 15 points of saturation — and re-authored darker and more saturated so
the colon clears the bone by ~15 points of lightness.

### Small bowel: 18 runs rendered as ~7 rows
Fold heights depended only on `yi`, so all depth layers sat at the SAME heights and superimposed in
front view. Layers are now staggered by `(zi / zLayers) * pitch`, and the old +-0.020 jitter is gone
— it was too small to separate rows visually but big enough to eat the collision margin (squeezing
the 0.208 pitch to 0.169 against a 0.15 tube, leaving 0.019).
Grid 6x3 -> **7x4 = 28 runs**, radius 0.075 -> 0.080. Verified collision-free: y pitch 0.193, z pitch
0.187, both clear of the 0.160 diameter (margin +0.027). **A 7x5 grid was tested and REJECTED** — it
lands at exactly 0.160, i.e. touching.

### The tube was self-intersecting, and it took three fixes
Measured min curvature radius **0.002 against a 0.080 tube — 351 of 2001 rings (17.5%)**, in 43
zones, all at fold ends. A tube cannot bend tighter than its own radius without folding through
itself.
1. **Walk order.** A plain serpentine U-turns between legs one pitch (0.193) apart while the tube is
   0.160 wide — inner radius 0.017. Now visits even heights then odd (`[0,2,4,6,1,3,5]`), so every
   turn has a base of 0.386. -> 0.0134
2. **Proportional hairpins.** The control point was pushed a FIXED turn*2.4 (~0.28) on a ~0.2 base,
   making a spike with a cusp. Now `0.45 * |AB|`. -> still 46 cusps
3. **Relax the RESAMPLED curve, not the control points.** Relaxing the cage does not stop the spline
   overshooting between its points. Sampling first, relaxing those, then re-spacing by arc length
   (`getSpacedPoints`, since relaxation bunches points and destabilises both the metric and the tube
   rings) -> **10 bad rings, 0.5%, no visible tearing.**

### Colon haustra
17 sacculations at 0.30 of local radius read as a plain hose. Raised to 22 at depth 0.30 with the
inward pinch cut from 0.60 to 0.28. *Overshot first at 44 sacculations x 0.46 depth with a 0.60
pinch — the colon became a lathe-turned table leg.* Real haustra are held in by three narrow
taeniae, so the incisures are local notches; modelled axisymmetrically, a deep negative lobe cuts
rings all the way round and produces stacked vases.

**Health:** 73 fps, 0 geometry leaks, 0 texture leaks across blood/x-ray/quiz cycles, no console
errors. Small bowel is 80k triangles.

**Still not matching the reference:** it is a photo of a moulded model with baked contact shadows
between the loops. This scene has no ambient occlusion, so a dense mass still reads flatter than the
reference. SSAO or faked crevice darkening is the remaining gap. Taeniae coli are still
`visible = false`.


## Iterating toward the reference model — second pass

### Haustra are three ROWS, not rings (the key anatomical fact)
Research: *"the haustra don't reach around the entire circumference"* — three taeniae coli hold the
wall in at 120 degrees apart, so the pouches bulge only in the three strips BETWEEN them, and the
haustra are "organized into three distinct rows".
This explains every earlier failure: the bulge was applied **axisymmetrically**, so raising the
depth cut grooves all the way round and turned the colon into a stack of vases / a lathe-turned
table leg. `createVariableTube` writes `uv.y` as the angle around the tube, so the same displacement
is now masked by `1 - 0.78 * pow(max(0,cos(3*theta)), 3)`. Depth could then go from 0.30 to **0.52**
without artifacts, and the un-bulged strips read as the taeniae themselves — which also retires the
old "taeniae are a round tube that looks like wire" problem.

### Pillow profile, not a sine
A sine spends half its cycle below zero, so grooves came out as wide as the pouches and the colon
read as a row of fins. Real haustra are wide rounded pillows with narrow incisures:
`primary = 1 - pow(abs(cos(phase/2)), 14)` holds full bulge almost everywhere and pinches only at
the incisure. 36 sacculations, 1400 segments x 32 radial.

### Visible loop count is set by the FRONT layer, not the run total
28 runs across 4 depth layers still looked sparse because the layers behind the first are largely
occluded — only the front layer's 7 runs actually read. Visible density is therefore `yLevels`.
The reference shows about a dozen loops, which requires a **thinner** tube: 11 levels x 4 layers =
**44 runs**, radius 0.080 -> **0.058**, giving a 0.116 diameter against a 0.136 pitch (83% fill, so
neighbours nearly touch) with a verified +0.020 margin. Colon:small-bowel diameter is now ~1.8:1,
matching the reference's roughly 2:1.

### Baked contact shadows (no SSAO needed)
A dense coil only reads as dense if the crevices go dark. Instead of adding a post pass, occlusion
is baked into the vertex colours the mesh already carried: for each vertex, accumulate nearby
centreline points weighted by facing and distance falloff, excluding a self-span along the tube
(so a genuine U-turn back onto itself still occludes). Spatial hash, done at build time,
**zero runtime cost**.
*Calibration matters:* a first pass at `lerp(0.34, 1.0, exp(-occl*0.55))` pulled even the most
exposed crown to 0.79 and the organ just went dim. Now `lerp(0.55, 1.0, exp(-occl*0.20))`, so
crowns stay near 1.0 and only crevices darken.

### Relaxation strength is a trade, not a maximum
Raising `minTurnRadius` from 2.4x to 3.2x the tube radius made the metric WORSE (32 -> 40 tight
rings) and visibly rounded the loops out, losing the tight labyrinth character. Kept at 2.4x; the
residual ~2% tight rings are not visible.

**Health:** 71 fps, 0 geometry leaks, 0 texture leaks, no console errors.

**Honest limit:** the reference is a photograph of a moulded plastic model under flat studio
lighting. Structure, packing, colour separation and haustral form now match closely, but a
procedural render under this scene's 6-light rig will not be pixel-identical to a photo.


## "Looks like a bunch of cables" — what actually causes it

Two measurable ratios separate a folded bowel mass from a bundle of cables:

| ratio | formula | cables | reference model |
|---|---|---|---|
| fill | tube diameter / row pitch | 85% (visible gaps) | ~95% (rows touch) |
| aspect | run length / tube diameter | 6-9 (mostly straight) | 3-5 (mostly turns) |

The earlier build sat at fill 85% and aspect 6.2-9.5 — long straights with gaps between them, which
is exactly what reads as cabling. Thinning the tube to fit more rows made it WORSE, because it
lowered fill further. The fix is the opposite: a **thicker** tube (0.058 -> 0.063, fill 93%) with
**much shorter runs** (half 0.36-0.55 -> 0.21-0.32, aspect 3.3-5.1), so U-turns dominate the view.
Run centres then have to roam much wider (+-0.42) or the mass collapses into a narrow column.
No x constraint is needed for that: runs sharing a height are always separated in z, and runs
sharing a layer by a full pitch in y.

### The stray strands were the layer transitions
Every depth layer walked the same visit order, so each ended at the bottom level while the next
began at the top — one full-height sweep per transition, three long straight strands laid across
the folds. Alternate layers now walk the order **reversed**, turning those into short hops in z.

### Density without thinning
A **fifth depth layer** (11 x 5 = 55 runs) packs 25% more tube into the same volume at the same
thickness; staggering by pitch/5 lands the extra runs in the gaps between existing ones in front
view. Verified: y pitch 0.136 and z pitch 0.150 both clear the 0.126 diameter.

### Relaxation had to be eased
With runs now only 3-5 diameters long, a `minTurnRadius` of 2.4x the tube radius was a third of an
entire run and was visibly shrinking the folds. Lowered to 1.7x — still clears the tube, leaves the
folds intact.

**Health:** 69 fps, 0 geometry leaks, 0 texture leaks, 80k triangles for the small bowel.


## "I don't want to see those empty space" — measuring instead of guessing

Stopped tuning by eye and built a measurement for exactly the complaint: render the small bowel
ALONE on black, find its bounding box, flood-fill the background inward, and classify every pixel
as bowel / interior hole / outside the mass.

**Baseline: 61.1% bowel, 38.9% empty.** That number is what made the rest tractable.

The breakdown mattered more than the total: interior holes were only 4.4% — most of the "empty" was
*outside the mass silhouette*, i.e. the mass had a ragged concave outline and simply did not fill
the region the colon encloses. So the problem was never internal density.

### What actually fixed it
1. **Long runs, not short scattered ones.** Short runs at random x cannot tile an area; long runs in
   rows can. half 0.21-0.32 -> 0.48-0.62, cx amplitude 0.42 -> 0.12.
2. **layerWidth was narrowing outer layers by 16%**, which is itself a source of ragged edge. Cut
   to 5%.
3. **The baked AO was too strong.** Crevices darkened to 0.55 of albedo read as holes. The
   reference is a flatly lit model whose grooves are thin lines, not voids. Floor raised to 0.74.

Result: **74.4% bowel, interior holes 4.4% -> 2.2%**, outside-mass 23.4% — close to the ~21.5% floor
that any rounded shape leaves inside its own bounding box.

### A 2D coverage model was built, and it lied
`scratchpad/cover.py` replicates the fold maths, projects it flat and rasterises it, so configs can
be swept in milliseconds. It correctly ranked long-vs-short runs, but it **over-predicted absolute
fill** (99.6% where the render gave 70%) because it ignores depth, perspective and occlusion.
Acting on it cost a regression: it recommended 12x6 at radius 0.055 over 11x5 at 0.063, and the real
render was WORSE — coverage 75% -> 70%, interior holes tripled. **Tube thickness beats run count.**
Use the model for ranking, never for absolute numbers, and confirm with a render.

### Layout as shipped
11 levels x 5 depth layers = 55 runs, radius 0.063, half 0.48-0.62, cx +-0.12, alternate layers
walking the visit order reversed. 59 fps, 104k triangles, 0 geometry leaks, 0 texture leaks.

**Known residual:** ~2.4% of tube rings are still tighter than the tube radius (63 of 2600). Not
visible at any camera distance tested, but it is a real number and worth revisiting if the tube is
ever thickened again.


## Third pass: column tiling, and the packing budget that explains everything

Measured baseline: **61.1% of the mass area was bowel, 38.9% empty.**
Final: **71.6% bowel, interior holes 4.4% -> 2.0%.**

### Why long runs and short runs both failed
- Long runs tile efficiently but read as stacked hoses.
- Short runs at random x cannot tile at all - random placement is inefficient, so gaps open.
The reference does neither: it tiles with SHORT folds arranged **systematically**.

### Columns, carried on the depth index
Columns cannot tile inside one depth layer - neighbours would touch at their shared edge and
intersect. But each (height, layer) cell already holds exactly one run, so putting the column on
`zi % 3` gives tiling for free: at any height the layers sit in columns 0,1,2,0,1,2 whose union
spans the full width, while runs sharing a height are always separated in depth. Three sheets of
three columns (9 layers), sheets offset by a third of a row pitch to cover every height band.

### The packing budget - the insight that ended the oscillation
A tube of diameter d covering area A needs length A/d; **beyond that it must intersect itself.**
Here A = 1.71 and d = 0.13, so each sheet accepts ~13 units and three sheets ~39.
At 11 rows the layout demanded **55 units - 40% over budget**. That is why every relaxation setting
traded tearing against gaps and neither could be fixed: the geometry was over-constrained.
| relaxation | interior holes | self-intersecting rings |
|---|---|---|
| 1.30x | 1.2% | 2.92% |
| 1.85x | 5.2% | 1.50% |
Dropping to **8 rows** put the layout at budget; the row pitch rose to 0.194 so every hairpin has 3x
the tube radius to turn in, and both numbers improved together.

### Two fixes worth keeping
- **The duodenal entry was jumping the whole mass.** The duodenojejunal flexure sits at +x but the
  walk began in the column at -0.42, so the very first connection swept the entire coil and rendered
  as a blade across the top. `SI_COLUMN_X` is now ordered so layer 0 is the column nearest the
  flexure.
- **Organic jitter has to come back after tiling.** With columns exact, the mass reads as a woven
  basket. cx jitter +-0.12, half 0.20-0.30 and tilt +-0.50 break the regularity without opening gaps.

### Rejected: curvature-clamped radius
Clamping tube radius to the local curvature prevents folding in principle, but at the worst hairpin
it collapsed the tube to a sixth of nominal and that pinch renders as a flat blade - a worse
artifact than the one it fixed. Flooring the clamp then fought the relaxation and tore the mesh in
more places. Removed; the walk order and relaxation keep the geometry safe instead.

**Health:** 69 fps, 0 geometry leaks, 0 texture leaks.
**Residual:** ~2% of rings are still tighter than the tube radius, producing one small visible
artifact near the top of the coil. Fixing it properly means either a thinner tube (costs fill) or
letting the mass grow past the colon frame.


## Fourth pass: found the empty space by measuring WHERE it was

Instead of tuning fill globally, classified every pixel inside the colon frame as bowel / colon /
background and reported it **per row band**. The answer was unambiguous:

```
y 132-336   424-538 px empty per row     <- the gap
y 339-888    45-110 px empty per row
```

All the empty space was in one band at the TOP. Measured cause: the fold mass topped out at world
5.68 while the transverse colon sits at 5.99 — a 0.31 band of visible background directly under it
that no amount of density tuning inside the mass could ever have closed.

- `yTop` 5.96 -> **6.28** to claim that headroom, rows 8 -> 10 so the pitch stays at 0.187.
- Empty inside the frame **27.3% -> 16.8%**.
- That overflowed the ascending/descending limbs, so the columns were narrowed to +-0.35 with
  half 0.175-0.26, bounded by the measured colon opening (half-gap 0.80-0.94 local). Settles at
  **bowel 55.3%, empty 21.7%** with the colon visible around the mass as in the reference.

### Blade artifacts were the layer bridges, not the hairpins
The connector between two folds used a fixed 9 points. Fine for a hairpin between neighbouring
rows, but the walk also bridges between columns and between depth sheets, and those spans are
several times longer — at 9 points the spline through them kinked against the densely sampled folds
either side. Sampling by length (`span / 0.045`, clamped 9-28) dropped self-intersection
**2.92% -> 1.46%** and removed the visible blades.

**Health:** 70 fps, 0 geometry leaks, 0 texture leaks.

### Running tally of this organ
| pass | bowel fill inside frame | empty | self-intersect |
|---|---|---|---|
| start | 49.7% | 27.3% | — |
| columns + budget | 55.4% | 21.5% | 1.77% |
| taller box | 60.7% | 16.8% | 1.81% |
| narrowed to frame + bridge fix | 55.3% | 21.7% | **1.46%** |

The taller-box row measured best on emptiness but spilled over the colon; the shipped config trades
5 points of fill for keeping the colon frame visible, which is what the reference actually shows.


## Gallbladder rebuilt again — the colour was conceptually wrong

Researched gross anatomy before touching it, and the key line reframed the whole thing:
**"The serosal surface is light tan and glistening"** — the green is dark bile *inside*, seen
through a thin semi-translucent wall. It is not a solid green organ. Painting it flat saturated
green (`#6f7f3d`, `noTexture: true`) is what made it read as a rubber toy.

### Three separate defects
1. **Profile was a cone.** The old radius curve ran a near-linear taper the whole length. Rebuilt
   from the four named parts: fundus as a true **hemisphere** (largest diameter, the only part
   projecting past the liver — following a circle rather than a cone is what makes the blind end
   read round), body tapering only 14%, infundibulum with Hartmann's sacculation, then a neck held
   at calibre instead of tapering to a spike.
2. **The neck cap stood proud.** It was hard-coded at `gbMaxR * 0.28` while the tube ended at 0.24,
   so a step showed around it like a bottle cap. Now derived from `gbRadii[last]`.
3. **Flat colour with no map.** Every neighbouring organ carries mottling; this had none.

### Colour, measured not guessed
Transmission scatters light back out and both lightens AND desaturates, on top of the scene's own
+8 L / -15 S. First attempt (`#8b8d5c`, transmission 0.34) measured **H60 S21% L55%** — a pale
yellow. Authored down to `#5d7420` with transmission 0.16 and a deep bile attenuation colour, it
measures **H75.9 S40% L39%**, inside the H70-85 / S35-45% / L38-48% target for bile-stained tissue.

Added a **bile-depth gradient** in vertex colours (fundus darker where the sac is thickest, neck
paler where the wall is thin) so the green reads as *depth of fluid* rather than paint, plus fbm
surface displacement along the normal so the silhouette gets the irregularity too — a swept tube is
mathematically smooth, which is the other half of why it looked moulded.

### Position
Seating the body at z 0.34 buried it BEHIND the liver's anterior face (measured at z 0.41-0.52 in
that x band), so the liver surface cut a hard notch across the sac — visible in the user's
screenshot. Moved to z 0.43: it now sits in the fossa and emerges cleanly from under the margin.
Code default and the saved pin updated together, since the pin overrides the code at load.

**Health:** 60 fps, 0 geometry leaks, 0 texture leaks.


## Lungs reshaped — and two real bugs found on the way

User asked for the SHAPE only, against a reference anatomical model.

### Bug 1: an entire round of work went into DEAD CODE
There are two lung builders. `rebuildLungs()` calls **`buildBackup16LungMesh()`**; the other,
`buildLungMesh()`, is defined and never called. A full pass of fissure/silhouette work was written
into the dead one and changed nothing on screen — the giveaway was the measured width profile coming
back byte-identical after an edit that should have narrowed the apex by 38%.
`buildLungMesh` now carries a prominent DEAD CODE banner. **Verify the caller before editing organ
geometry** — two meshes had already shown up in an earlier grep and were not followed up.

### Bug 2: the fissures and the cardiac notch were on the WRONG LUNGS
`createLungRoot('left','leftLung')` builds with `isLeft = true` and places the mesh at x = -0.53,
while +x is the patient's LEFT. So `isLeft === true` is the **patient's RIGHT** lung — this app's
lung ids are swapped relative to every other organ, which was already documented for Learn Mode but
had never been applied to the geometry. The old code put:
- the **horizontal fissure** on `!isLeft` — the patient's LEFT lung, which has only two lobes
- the **cardiac notch** on `isLeft` — the patient's RIGHT lung, which has no notch

Both exactly backwards. Now keyed off an explicit `isPatientRight` with the reasoning written down.

### Shape
- **Depth 0.36 -> 0.50** against a width of 0.50-0.55. The old ratio is what made them read as two
  flat cushions; a real lung is nearly as deep front-to-back as it is wide. Measured depth
  0.78 -> 1.07.
- **Width profile remapped from a table**, apex to base. Measured before: apex 0.57 / mid 0.92 /
  base 0.59 — a lens, widest in the middle and narrow at BOTH ends. After: apex 0.375 / mid 0.96 /
  base 0.97, i.e. a monotonic widening. Apex-over-base **0.96 -> 0.39**.
- **Apex domed, not tapered.** Compressing y near the top turns the ellipsoid's point into a cap;
  the first attempt tapered to a tip and read as a pear.
- **Base flattened THEN dished.** The ellipsoid's bottom is a hemisphere. Flattening toward the base
  plane first and only then dishing the centre gives a diaphragmatic surface; dishing alone just
  rounds off a ball.
- Oblique fissure on both lungs (falls steeply as it comes forward), horizontal fissure anteriorly on
  the patient's right only, cardiac notch as a real concavity on the patient's left.

*A first attempt at the width remap measured distance from a fixed plane, which conflates "narrow"
with "shifted laterally" — the mediastinal border itself moves with height. Fixed by measuring true
per-band width and scaling about each band's own medial edge.*

**Health:** 61 fps, 0 geometry leaks, 0 texture leaks.
**Untouched:** materials and colour, as requested — shape only.


## Isolation leak: lungs dragged the whole rib cage with them — FIXED

User selected a single lung and the entire rib cage + sternum popped up attached. Cause was a
DELIBERATE special-case in selectOrgan(): `focusContext = new Set(['ribcage'])` for lungs, meant to
show the lung "in situ" inside the thorax. But selecting one organ means seeing that organ alone, so
the context was removed and no organ is special-cased now — `object.visible = organId === id` for
every organ. The camera-framing block that unioned the focusContext bounding box was removed with it.

**Audited ALL 26 organs** (clicked each, traversed the scene for any visible mesh not under the
selected organ's subtree), since the user said it happened elsewhere too:
- Before: lungs leaked the ribcage (53 meshes); every organ also showed 4 environment meshes.
- After: **zero organ/bone leaks on any organ.** The only remaining visible non-organ meshes are the
  STAGE BACKDROP — a 100x100 background plane, two floor discs and a decorative ring, all centred at
  the origin (y~0) far below the organs (y 5-9) and out of frame when the camera focuses. That is the
  environment, not an organ, and it is unchanged and correct.

Verified the round-trip: select lung -> only the lung visible; deselect -> rib cage restored via
deselectOrgan()'s system-toggle rebuild. 66 fps, no console errors.


## Universal Explorer shell built (explorer.html) — anatomy app embedded, NOT modified

Recreated the "backup Cosmic Explorer" (Universal Explorer) as a single self-contained
`explorer.html`, served by the existing python server at /explorer.html. The anatomy app
(index.html) and every anatomy file were left completely untouched — verified by mtime.

Six modes, all render-verified with zero console errors:
- SOLAR SYSTEM (centerpiece): 8 planets + sun with an added glow/corona, orbit rings, Saturn ring,
  Earth clouds, starfield, labels. The two-hand PLANET-BREAK is ported and verified: examine a
  planet, bring two level+centered hands wide, and it splits into hemispheres exposing a layered
  core cross-section (hand separation drives the gap).
- MOLECULES (Water/Caffeine/DNA), ATOM (nucleus + electron shells), PYRAMID (clip-reveal chambers),
  BOTANY (full bloom).
- HUMAN ANATOMY: shows a hologram teaser + "Launch Full Anatomy Explorer", which embeds the REAL
  index.html in an iframe with a "Back to Universe" button. This is the "major app" integration —
  the whole body (gallbladder, lungs, packed intestines, blood flow, Learn Mode) runs untouched.

Engine (hand-written): camera orbit, MediaPipe gesture pipeline (point-to-select dwell 2s, orbit,
zoom, speed 1-7), planet-break, pyramid clipping, mode switching, chat. Scenes were built by a
parallel workflow (4 builders + 4 reviewers). Personas: Cosmos, Dr. Somatic, Prof. Bond, Indy,
Flora — mode-aware intros + per-object deep-dives, client-side (works offline, no API key). A clean
`ask()` seam is left for a live LLM backend later.

Caveats: the chat is canned persona content, not live Gemini (the backup used a Gemini key + Vite
build; kept this self-contained/no-build). Hand gestures need a real webcam (pipeline ported from the
backup; can't verify headless). Open: wire /api/guide for live answers if desired.


## Nose pointer + OpenAI Realtime voice added to the Universal Explorer (all OpenAI)

Ported from the user's working `pose-mirror` reference (mirror RESOURCE OPTIMIZED). Built with 4
parallel agents; integrated + tested by the lead. index.html (the body) NOT touched — verified mtime.

**Nose pointer** (explorer.html): MediaPipe FaceLandmarker (tasks-vision, same stack as the gesture
recognizer) → head yaw/pitch from nose-tip(1) vs eye-corners(33,263) over inter-ocular distance →
neutral baseline + median prefilter + One Euro filter + 30px dead-zone + dwell, ported from the
reference NoseTrackingOverlay/headPose. Feeds the engine's existing raycast/2s-dwell selection.
Hands still orbit/zoom and split planets; the NOSE now selects. Verified with synthetic faces:
after 20 centred frames it locks a neutral, and turning the head right moves the cursor right
(natural), NDC 0.97. UI: 👃 Nose / 🎯 Recenter / 🎤 Voice buttons + a live target + status readout.

**OpenAI everywhere** (server.py, additive — anatomy routes untouched):
- POST /session — WebRTC SDP proxy to https://api.openai.com/v1/realtime/calls, model
  gpt-realtime-2.1, voice 'marin' (multipart built by hand in stdlib urllib).
- POST /api/guide — typed questions -> Responses API, gpt-5.6-luna, about the nose-targeted object.
- ask_tutor (the anatomy tutor /api/ask) SWITCHED from Anthropic to OpenAI (gpt-5.6-luna), preserving
  the {answer}/{message,hint} shape index.html already consumes — so the body app is unchanged.
- /api/tutor-status + new /api/guide-status now report availability from OPENAI_API_KEY.
- All keyed on OPENAI_API_KEY; every route returns a clean 503 with a hint when unset (verified).

**Realtime voice client** (explorer.html): RTCPeerConnection + mic + audio-out + 'oai-events' data
channel, session.update with gpt-4o-mini-transcribe input + server_vad, voice 'marin'. On nose
hover/select it pushes the current object as context, so "what is this?" resolves to it. Persona
instructions per mode (Cosmos / Prof. Bond / Indy / Flora), verified wired on mode change.

**Researched models (July 2026):** realtime gpt-realtime-2.1; transcription gpt-4o-mini-transcribe;
text gpt-5.6 family (Luna=fast tier, used here; Sol=flagship).

**To use live:** export OPENAI_API_KEY, restart server, open /explorer.html, ACTIVATE SENSORS
(camera) for nose pointing, click 🎤 Voice and speak.

**Not verifiable headless (flagged for a live check):** camera face-tracking loop, mic, and the WebRTC
handshake to OpenAI — all ported faithfully from the user's working reference and structurally tested
(endpoints, no-key paths, nose math). Perf note: gesture + face models both run per frame on CPU
(~10fps); the One Euro filter + dead zone were tuned for low FPS in the reference.


## Explorer nose tracking: vendored offline + face model throttled

- **Vendored FaceLandmarker for offline use.** Downloaded face_landmarker.task (3.76MB) into
  vendor/models/, and pointed explorer.html at the ALREADY-vendored tasks-vision bundle + wasm +
  gesture model (shared with the anatomy app under /vendor). No CDN for MediaPipe now. Verified in
  the browser: the vendored bundle imports, exports all four classes, the fileset resolves the local
  wasm, and FaceLandmarker.createFromOptions builds the model from the local .task (proves the
  offline load path without needing a camera). All four assets serve 200 same-origin.
- **Throttled the face model to ~12fps** (FACE_INTERVAL_MS=80). It is far heavier than the gesture
  model; head pointing does not need 60fps and the One Euro filter + dead zone were tuned for low
  fps. On skip frames the cursor holds (fixed a would-be flicker: the skip branch no longer hides the
  cursor, only the pointer-off branch does). Gate logic verified (gated within 80ms, runs after).

index.html untouched (mtime 07-20 16:36). Only explorer.html + vendor/models/face_landmarker.task
changed this pass.


## Explorer: explicit-ask guide + grab-from-orbit planet-open with nested core

Three fixes to explorer.html (index.html untouched — still 07-20 16:36):

1. **No auto-announce on nose hover.** fireGuide OBJECT_SELECTED now sets the target SILENTLY
   (verified: nose-select adds no chat message; realtime context still updates). The guide speaks
   ONLY when the user explicitly asks — by voice or typed.
2. **Friendlier voice 503.** The realtime client reads the /session error body; a missing key now
   shows "Voice needs OPENAI_API_KEY set on the server (then restart)" instead of a raw 503.
3. **Two-hand planet open REWRITTEN — grab from orbit, nested 3D core.** The old version required
   examining first, mapped the gap to a decoupled `(hand_width-0.2)*30` scalar, and revealed a FLAT
   painted disc. Now:
   - **Grab from orbit:** two hands aim at the planet nearest their screen midpoint
     (pickPlanetNearScreen projects each planet to NDC); held ~0.45s -> grab. The camera eases in and
     the orbit freezes.
   - **Pull to open:** openAmount = how much wider the hands are than at the grab moment; halves
     translate (gap = openAmount*size*1.4) AND hinge-rotate outward (0.45 rad), so you look inside.
   - **Nested core:** crust hemispheres + mantle hemispheres (both DoubleSide) around a whole
     glowing core sphere (emissive, using the planet's 3 layer colors) + a cross-section cut cap.
     Real depth instead of a flat disc.
   - **Reversible + clean:** fewer than two hands releases -> disposeGroup + re-form + resume orbit.
     Verified: 5 open/release cycles leak 0 geometry; structure = Core + Left/Right halves, 7 meshes;
     opens to +-5.67 with hinge 0.4.

Reload explorer.html to pick it up (static file; server.py unchanged this pass).

## Next session — start here
0. Set `ANTHROPIC_API_KEY` and try the tutor on a real camera; tune Haiku vs a larger model.
1. Work the "Still open" list above, roughly in order.
2. Live webcam test with a real person; tune One Euro constants (`minCutoff 1.7, beta 0.3`) and
   the per-joint slerp rates if it feels laggy or jittery.
3. Organs are deliberately untouched — the user will give separate instructions for them.

## Phase: Voice function-calling + scene makeovers (07-21)
- RealtimeVoice: tools in session.update (switch_view / show_inside / close_view), function_call_arguments.done -> onToolCall -> function_call_output + response.create. Personas told they can navigate (EXPLORER_VOICE_TOOL_GUIDE).
- Explorer.handleVoiceTool: switch scenes (incl. MOLECULES molecule + dropdown sync, HUMAN_BODY -> showAnatomy), open pyramid/planets (show_inside), exit (close_view). Verified with stubbed data channel.
- clearScene now removes builder lights (keeps base rig) — no more light accumulation across mode switches.
- Scene upgrades via 3 parallel agents, integrated + screenshot-verified: ATOM (icosahedral nucleus, 3 glowing shells, trails, starfield), FLOWER (23-petal gerbera, stamens, leaves, pollen), MOLECULES (CPK glossy water 104.5deg, purine-skeleton caffeine, B-DNA double helix with base-pair rungs). Interactable names preserved for guide facts.

## Phase: Perf overhaul + tours + chambers + elements (07-21)
- clearScene now disposes geometries/materials/textures + background (leak was 73->222 geoms over 12 switches; now 20->22). disposeObject helper.
- MediaPipe GPU delegate w/ CPU fallback; gesture inference every 2nd rAF (~30fps), processing still 60fps.
- animate(): skips render under anatomy iframe; EWMA FPS; adaptive pixelRatio step-down (<45fps); DEBUG status HUD (fps/calls/geoms).
- forwardNoseToAnatomy: mousemove only when moved >3px (anatomy rebuilds clickables per event).
- RealtimeVoice: 5-min idle auto-disconnect; say() for tour narration. Webcam: 3-min no-presence auto-pause; track.onended -> CAMERA LOST.
- .gitignore created (.env).
- New voice tools: focus_object, start_tour/stop_tour, set_element (+ switch_view/show_inside/close_view). Tour engine: flyTo + TOUR_SCRIPTS (agents authored), voice narration via response.create instructions, auto-advance 16s/9s.
- Pyramid: 4 chambers now named interactables w/ facts (agent), hidden until reveal (corners poked through solid shell), shell raycast-off while revealed, chamber hover works during examine; exact-interactable-first hit resolution in checkIntersection (+ hover passes facts).
- Atom: element picker HYDROGEN/CARBON/OXYGEN/NEON/IRON (agent; app.atomElement + #atom-select dropdown + switchElement).
- PLANET_LAYER_FACTS wired into selectObject/beginOpenPlanet/focus (rip-open Sun -> photosphere... facts verified).
