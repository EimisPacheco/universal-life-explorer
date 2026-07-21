# Medical reference atlas

This directory contains official medical 3D references for geometric measurement, organ-landmark extraction, and procedural reconstruction. The models are not imported into the runtime anatomy app.

## Primary reference system

The Human Reference Atlas (HRA) female set is the canonical coordinate frame. The HRA models are anatomically modeled, reviewed by organ experts, published by HuBMAP, funded by the National Institutes of Health, and released under CC BY 4.0. Individual organ coordinates align with `models/hra/united-female-v1.5.glb`; do not recenter them independently.

HRA axes are +X anatomical left, +Y superior, and +Z anterior, in meters. The downloaded united-body mesh is 1.666348242 m tall by POSITION bounds.

## Included first batch

- Female lungs, HRA v1.3
- Female liver, HRA v1.1
- Female large intestine, HRA v1.2
- Female small intestine, HRA v1.1
- Female pelvis, HRA v1.2
- Female united-body registration reference, HRA v1.5
- Stomach fallback, BodyParts3D v4.0 adult male

HRA does not currently provide a standalone stomach reference in the selected release. The BodyParts3D stomach is therefore a morphology-only fallback. It uses a different subject, units, axes, and atlas frame and must be landmark-scaled and registered before comparison.

## Licenses and attribution

HRA assets: Creative Commons Attribution 4.0 International. Cite each DOI stored in `manifest.json` and attribute the HuBMAP Human Reference Atlas 3D Reference Object Library.

BodyParts3D: the current database page states CC BY 4.0 and requires the attribution: “BodyParts3D © The Database Center for Life Science licensed under CC Attribution 4.0 International.” The extracted OBJ still embeds an older CC BY-SA 2.1 Japan notice. Preserve that notice and attribution unless legal review confirms that the updated license supersedes it for this archived object.

Exact URLs, hashes, units, coordinates, identifiers, and bounds are recorded in `manifest.json`. Original official metadata pages and archives are retained in `source-metadata/` for provenance.
