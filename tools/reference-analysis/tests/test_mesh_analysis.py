from __future__ import annotations

import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


TOOL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_ROOT))

from mesh_analysis import SamplingOptions, analyze_mesh, load_meshes  # noqa: E402


CUBE_VERTICES = np.asarray(
    [
        [-1, -1, -1],
        [1, -1, -1],
        [1, 1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
    ],
    dtype=np.float32,
)
CUBE_FACES = np.asarray(
    [
        [0, 2, 1], [0, 3, 2],
        [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4],
        [1, 2, 6], [1, 6, 5],
        [2, 3, 7], [2, 7, 6],
        [3, 0, 4], [3, 4, 7],
    ],
    dtype=np.uint16,
)


def write_obj(path: Path, vertices: np.ndarray = CUBE_VERTICES) -> None:
    lines = ["o cube"]
    lines.extend(f"v {x} {y} {z}" for x, y, z in vertices)
    lines.extend("f " + " ".join(str(int(index) + 1) for index in face) for face in CUBE_FACES)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_binary_stl(path: Path) -> None:
    payload = bytearray(b"test cube".ljust(80, b"\0"))
    payload.extend(struct.pack("<I", len(CUBE_FACES)))
    for face in CUBE_FACES:
        triangle = CUBE_VERTICES[face]
        payload.extend(struct.pack("<3f", 0.0, 0.0, 0.0))
        payload.extend(struct.pack("<9f", *triangle.reshape(-1)))
        payload.extend(struct.pack("<H", 0))
    path.write_bytes(payload)


def write_glb(path: Path) -> None:
    positions = CUBE_VERTICES.astype("<f4").tobytes()
    indices = CUBE_FACES.astype("<u2").tobytes()
    binary = positions + indices
    while len(binary) % 4:
        binary += b"\0"
    document = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(positions)},
            {"buffer": 0, "byteOffset": len(positions), "byteLength": len(indices)},
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(CUBE_VERTICES),
                "type": "VEC3",
            },
            {
                "bufferView": 1,
                "componentType": 5123,
                "count": int(CUBE_FACES.size),
                "type": "SCALAR",
            },
        ],
        "meshes": [
            {"name": "cube_mesh", "primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}
        ],
        "nodes": [
            {
                "name": "transformed_cube",
                "mesh": 0,
                "translation": [3, 4, 5],
                "scale": [2, 1, 0.5],
            }
        ],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    json_chunk = json.dumps(document, separators=(",", ":")).encode("utf-8")
    while len(json_chunk) % 4:
        json_chunk += b" "
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    glb = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    glb.extend(struct.pack("<II", len(json_chunk), 0x4E4F534A))
    glb.extend(json_chunk)
    glb.extend(struct.pack("<II", len(binary), 0x004E4942))
    glb.extend(binary)
    path.write_bytes(glb)


FAST_OPTIONS = SamplingOptions(
    silhouette_resolution=20,
    cross_section_resolution=16,
    slice_fractions=(0.25, 0.5, 0.75),
    max_boundary_samples=24,
)


class MeshAnalysisTests(unittest.TestCase):
    def test_obj_cube_exact_measurements_and_samples(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cube.obj"
            write_obj(path)
            mesh = load_meshes(path)[0]
            report = analyze_mesh(mesh, FAST_OPTIONS)
        self.assertEqual(report["counts"]["analyzed_vertex_count"], 8)
        self.assertEqual(report["counts"]["analyzed_face_count"], 12)
        self.assertTrue(report["topology"]["is_watertight"])
        self.assertAlmostEqual(report["surface_area"], 24.0, places=7)
        self.assertAlmostEqual(report["volume_if_watertight"], 8.0, places=7)
        np.testing.assert_allclose(report["bounds"]["dimensions"], [2, 2, 2], atol=1e-8)
        np.testing.assert_allclose(report["centroids"]["volume_if_watertight"], [0, 0, 0], atol=1e-8)
        self.assertGreater(
            report["sampling"]["silhouettes"]["world_axis_aligned"]["xy"]["occupied_fraction"],
            0.5,
        )
        middle = report["sampling"]["cross_sections_pca"]["pca_axis_0"]["slices"][1]
        self.assertGreater(middle["segment_count"], 0)
        self.assertTrue(middle["boundary_samples_normalized"])

    def test_binary_stl_is_welded_and_watertight(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cube.stl"
            write_binary_stl(path)
            report = analyze_mesh(load_meshes(path)[0], FAST_OPTIONS)
        self.assertEqual(report["counts"]["source_vertex_count"], 36)
        self.assertEqual(report["counts"]["analyzed_vertex_count"], 8)
        self.assertEqual(report["cleaning"]["vertices_welded"], 28)
        self.assertTrue(report["topology"]["is_watertight"])
        self.assertAlmostEqual(report["volume_if_watertight"], 8.0, places=7)

    def test_glb_scene_transform_is_applied(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cube.glb"
            write_glb(path)
            meshes = load_meshes(path)
            report = analyze_mesh(meshes[0], FAST_OPTIONS)
        self.assertEqual(meshes[0].name, "transformed_cube")
        np.testing.assert_allclose(report["bounds"]["min"], [1, 3, 4.5], atol=1e-8)
        np.testing.assert_allclose(report["bounds"]["max"], [5, 5, 5.5], atol=1e-8)
        np.testing.assert_allclose(report["bounds"]["dimensions"], [4, 2, 1], atol=1e-8)
        self.assertAlmostEqual(report["surface_area"], 28.0, places=7)
        self.assertAlmostEqual(report["volume_if_watertight"], 8.0, places=7)

    def test_cli_writes_valid_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mesh_path = root / "cube.obj"
            output_dir = root / "reports"
            write_obj(mesh_path)
            completed = subprocess.run(
                [
                    sys.executable,
                    str(TOOL_ROOT / "analyze_mesh.py"),
                    str(mesh_path),
                    "--output-dir",
                    str(output_dir),
                    "--silhouette-resolution",
                    "20",
                    "--cross-section-resolution",
                    "16",
                    "--slice-fractions",
                    "0.5",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            output = Path(completed.stdout.splitlines()[0])
            report = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(report["schema_version"], "1.0.0")
        self.assertEqual(report["source"]["format"], "obj")
        self.assertEqual(report["source"]["sha256"], report["source"]["sha256"].lower())

    def test_manifest_batch_normalizes_organ_to_united_body_bounds(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body_path = root / "body.obj"
            organ_path = root / "left-lung.obj"
            write_obj(body_path)
            write_obj(organ_path, CUBE_VERTICES * 0.5 + np.asarray([0.0, 0.25, 0.0]))
            manifest = {
                "name": "priority-organ-batch",
                "reference_mesh": "body.obj",
                "output_dir": "reports",
                "meshes": [
                    {
                        "path": "left-lung.obj",
                        "label": "left-lung",
                        "organ": "lung",
                        "atlas": "synthetic-test",
                    }
                ],
            }
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(TOOL_ROOT / "analyze_mesh.py"),
                    "--manifest",
                    str(manifest_path),
                    "--silhouette-resolution",
                    "20",
                    "--cross-section-resolution",
                    "16",
                    "--slice-fractions",
                    "0.5",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            outputs = [Path(line) for line in completed.stdout.splitlines()]
            organ_report = json.loads(
                next(path for path in outputs if path.name == "left-lung__mesh.analysis.json").read_text()
            )
            batch_report = json.loads(
                next(path for path in outputs if path.name == "batch.analysis.json").read_text()
            )
        registration = organ_report["registration_to_reference"]
        np.testing.assert_allclose(
            registration["ratios"]["dimensions_over_reference_dimensions"],
            [0.5, 0.5, 0.5],
            atol=1e-8,
        )
        np.testing.assert_allclose(
            registration["bounds_normalized_to_reference"]["center"],
            [0.5, 0.625, 0.5],
            atol=1e-8,
        )
        self.assertTrue(registration["containment"]["aabb_fully_inside_reference_aabb"])
        self.assertEqual(batch_report["kind"], "mesh_analysis_batch")
        self.assertEqual(batch_report["reports"][0]["source"]["manifest_metadata"]["organ"], "lung")

    def test_official_atlas_models_manifest_and_mismatched_frame_skip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body_path = root / "united.obj"
            organ_path = root / "liver.obj"
            secondary_path = root / "stomach.obj"
            write_obj(body_path)
            write_obj(organ_path, CUBE_VERTICES * 0.4)
            write_obj(secondary_path, CUBE_VERTICES * 100.0)
            manifest = {
                "canonical_frame": {"local_path": "united.obj", "units": "meter"},
                "models": [
                    {"local_path": "united.obj", "organ": "female_united_body", "units": "meter"},
                    {
                        "local_path": "liver.obj",
                        "organ": "liver",
                        "units": "meter",
                        "position_bbox_m": {"min": [-0.4, -0.4, -0.4], "max": [0.4, 0.4, 0.4]},
                    },
                    {
                        "local_path": "stomach.obj",
                        "organ": "stomach",
                        "units": "millimeter",
                        "coordinate_notes": "secondary morphology reference; must not be directly registered",
                    },
                ],
            }
            manifest_path = root / "atlas-manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            output_dir = root / "reports"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(TOOL_ROOT / "analyze_mesh.py"),
                    "--manifest",
                    str(manifest_path),
                    "--output-dir",
                    str(output_dir),
                    "--silhouette-resolution",
                    "20",
                    "--cross-section-resolution",
                    "16",
                    "--slice-fractions",
                    "0.5",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            outputs = [Path(line) for line in completed.stdout.splitlines()]
            liver = json.loads(next(path for path in outputs if path.name == "liver__mesh.analysis.json").read_text())
            stomach = json.loads(
                next(path for path in outputs if path.name == "stomach__mesh.analysis.json").read_text()
            )
            reference_outputs = [path for path in outputs if path.name == "united-body__reference.analysis.json"]
        self.assertEqual(len(reference_outputs), 1)
        self.assertEqual(liver["registration_to_reference"]["status"], "registered")
        self.assertEqual(liver["declared_bounds_validation"]["status"], "pass")
        self.assertEqual(stomach["registration_to_reference"]["status"], "skipped")
        self.assertIn("units", stomach["registration_to_reference"]["reason"])


if __name__ == "__main__":
    unittest.main()
