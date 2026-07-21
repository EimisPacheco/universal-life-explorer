from __future__ import annotations

import sys
import unittest
from pathlib import Path


TOOLS = Path(__file__).resolve().parents[1]
ROOT = TOOLS.parents[1]
sys.path.insert(0, str(TOOLS))

import fit_abdominal_envelopes as abdominal_fit  # noqa: E402


class AbdominalEnvelopeFitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.document, _, _ = abdominal_fit.build_document(
            ROOT / "reference-atlas/models/hra/liver-female-v1.1.glb",
            ROOT / "reference-atlas/models/bodyparts3d/stomach-bodyparts3d-v4.0-99.obj",
        )

    def test_official_liver_preserves_front_and_profile_silhouettes(self) -> None:
        validation = self.document["organs"]["liver_hra_female"]["validation"]
        self.assertGreaterEqual(
            validation["front_xy_silhouette"]["intersection_over_union"], 0.95
        )
        self.assertGreaterEqual(
            validation["profile_zy_silhouette"]["intersection_over_union"], 0.98
        )

    def test_stomach_is_solid_high_fidelity_morphology_fit(self) -> None:
        stomach = self.document["organs"]["stomach_bodyparts3d_morphology"]
        self.assertIn("morphology-only", stomach["source"]["role"])
        self.assertGreaterEqual(
            stomach["validation"]["front_xy_silhouette"]["intersection_over_union"],
            0.98,
        )
        sections = stomach["coefficient_model"]["sections"]
        self.assertEqual(sections[0]["half_width_fraction"], 0.0)
        self.assertEqual(sections[-1]["half_width_fraction"], 0.0)
        self.assertTrue(all(section["half_depth_fraction"] >= 0 for section in sections))


if __name__ == "__main__":
    unittest.main()
