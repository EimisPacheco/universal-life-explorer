#!/usr/bin/env python3
"""Fit smooth watertight liver and stomach envelopes from official references.

The liver source is the female HuBMAP HRA capsule.  The stomach source is the
BodyParts3D v4.0 adult-male mesh and is deliberately treated as morphology
only: its frame is reoriented, normalized, and never registered directly into
the HRA female body.

Each fit stores explicit left/right and posterior/anterior extrema on densely
sampled horizontal planes.  A shape-preserving PCHIP interpolant reconstructs
those tracks as elliptical rings.  This produces a solid organ (no crescent
hole), preserves the measured frontal contour, and cannot develop the folded
quads caused by connecting moving polar-ray origins.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Sequence

import numpy as np
from PIL import Image, ImageDraw

import fit_anatomical_lofts as atlas_fit
from mesh_analysis import Mesh, load_meshes


SCHEMA_VERSION = "1.0.0"
INTERIOR_SECTION_COUNT = 41
RENDER_SUBDIVISIONS = 5
RADIAL_SEGMENTS = 48
VALIDATION_RESOLUTION = 384


def _round(value: float) -> float:
    return round(float(value), 7)


def _round_vector(values: Sequence[float]) -> list[float]:
    return [_round(value) for value in values]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_liver(path: Path) -> Mesh:
    matches = [
        mesh for mesh in load_meshes(path)
        if mesh.name == "VH_F_capsule_of_the_liver"
    ]
    if len(matches) != 1:
        raise ValueError(f"expected one HRA liver capsule, found {len(matches)}")
    return matches[0]


def _load_stomach(path: Path) -> Mesh:
    meshes = load_meshes(path)
    if len(meshes) != 1:
        raise ValueError(f"expected one BodyParts3D stomach mesh, found {len(meshes)}")
    source = meshes[0]
    # BodyParts3D: +X anatomical left, +Y posterior, +Z superior.
    # Runtime fit frame: +X left, +Y superior, +Z anterior.
    vertices = np.column_stack(
        (source.vertices[:, 0], source.vertices[:, 2], -source.vertices[:, 1])
    )
    # The axis reflection reverses orientation; reverse winding for a coherent
    # watertight candidate and correct runtime normals.
    return Mesh("BodyParts3D_stomach_reoriented", vertices, source.faces[:, ::-1])


def _plane_segments(mesh: Mesh, y: float) -> np.ndarray:
    triangles = mesh.vertices[mesh.faces]
    low = triangles[:, :, 1].min(axis=1)
    high = triangles[:, :, 1].max(axis=1)
    diagonal = float(np.linalg.norm(np.ptp(mesh.vertices, axis=0)))
    tolerance = max(diagonal * 1e-12, 1e-12)
    candidates = triangles[(low <= y + tolerance) & (high >= y - tolerance)]
    segments: list[np.ndarray] = []
    for triangle in candidates:
        hits: list[np.ndarray] = []
        for start, end in ((0, 1), (1, 2), (2, 0)):
            a = triangle[start]
            b = triangle[end]
            delta = b[1] - a[1]
            if abs(delta) <= tolerance:
                continue
            if not ((a[1] <= y < b[1]) or (b[1] <= y < a[1])):
                continue
            amount = (y - a[1]) / delta
            hits.append((a + amount * (b - a))[[0, 2]])
        if len(hits) == 2 and np.linalg.norm(hits[1] - hits[0]) > tolerance:
            segments.append(np.asarray(hits, dtype=np.float64))
    if not segments:
        raise ValueError(f"plane y={y:.9f} did not intersect {mesh.name}")
    return np.asarray(segments)


def _pchip_slopes(x: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Fritsch-Carlson monotone slopes for scalar or vector tracks."""
    interval = np.diff(x)
    reshape = (-1,) + (1,) * (values.ndim - 1)
    delta = np.diff(values, axis=0) / interval.reshape(reshape)
    slopes = np.zeros_like(values)
    for index in range(1, len(x) - 1):
        same_direction = delta[index - 1] * delta[index] > 0.0
        left_weight = 2.0 * interval[index] + interval[index - 1]
        right_weight = interval[index] + 2.0 * interval[index - 1]
        denominator = (
            left_weight / np.where(delta[index - 1] != 0.0, delta[index - 1], 1.0)
            + right_weight / np.where(delta[index] != 0.0, delta[index], 1.0)
        )
        harmonic = (left_weight + right_weight) / denominator
        slopes[index] = np.where(same_direction, harmonic, 0.0)
    for index in (0, len(x) - 1):
        if index == 0:
            estimate = (
                (2.0 * interval[0] + interval[1]) * delta[0]
                - interval[0] * delta[1]
            ) / (interval[0] + interval[1])
            adjacent, following = delta[0], delta[1]
        else:
            estimate = (
                (2.0 * interval[-1] + interval[-2]) * delta[-1]
                - interval[-1] * delta[-2]
            ) / (interval[-1] + interval[-2])
            adjacent, following = delta[-1], delta[-2]
        estimate = np.where(np.sign(estimate) != np.sign(adjacent), 0.0, estimate)
        estimate = np.where(
            (np.sign(adjacent) != np.sign(following))
            & (np.abs(estimate) > 3.0 * np.abs(adjacent)),
            3.0 * adjacent,
            estimate,
        )
        slopes[index] = estimate
    return slopes


def _pchip_sample(
    x: np.ndarray, values: np.ndarray, subdivisions: int
) -> tuple[np.ndarray, np.ndarray]:
    slopes = _pchip_slopes(x, values)
    sample_x: list[float] = []
    sample_values: list[np.ndarray] = []
    for interval_index in range(len(x) - 1):
        width = x[interval_index + 1] - x[interval_index]
        for subdivision in range(subdivisions):
            amount = subdivision / subdivisions
            amount2, amount3 = amount * amount, amount * amount * amount
            value = (
                (2 * amount3 - 3 * amount2 + 1) * values[interval_index]
                + (amount3 - 2 * amount2 + amount) * width * slopes[interval_index]
                + (-2 * amount3 + 3 * amount2) * values[interval_index + 1]
                + (amount3 - amount2) * width * slopes[interval_index + 1]
            )
            sample_x.append(x[interval_index] + amount * width)
            sample_values.append(value)
    sample_x.append(float(x[-1]))
    sample_values.append(values[-1])
    return np.asarray(sample_x), np.asarray(sample_values)


def _fit_sections(mesh: Mesh) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    low = mesh.vertices.min(axis=0)
    high = mesh.vertices.max(axis=0)
    dimensions = high - low
    # Cosine distribution resolves the superior dome and sharp inferior margin
    # much more densely than a uniform grid for the same compact JSON size.
    interior_fractions = np.asarray([
        0.5 * (1.0 - math.cos(math.pi * i / (INTERIOR_SECTION_COUNT + 1)))
        for i in range(1, INTERIOR_SECTION_COUNT + 1)
    ])
    fractions = np.concatenate(([0.0], interior_fractions, [1.0]))
    measurements: list[list[float]] = []
    for fraction in interior_fractions:
        y = low[1] + fraction * dimensions[1]
        points = _plane_segments(mesh, y).reshape(-1, 2)
        x_min, z_min = points.min(axis=0)
        x_max, z_max = points.max(axis=0)
        measurements.append([
            (x_min - low[0]) / dimensions[0],
            (x_max - low[0]) / dimensions[0],
            (z_min - low[2]) / dimensions[2],
            (z_max - low[2]) / dimensions[2],
        ])
    measurements_array = np.asarray(measurements)
    # Cap centers inherit the nearest measured section; zero widths close the
    # manifold without forcing a spurious central axis.
    lower_center = np.asarray([
        measurements_array[0, :2].mean(), measurements_array[0, 2:].mean()
    ])
    upper_center = np.asarray([
        measurements_array[-1, :2].mean(), measurements_array[-1, 2:].mean()
    ])
    center = np.column_stack((
        measurements_array[:, :2].mean(axis=1),
        measurements_array[:, 2:].mean(axis=1),
    ))
    half = np.column_stack((
        (measurements_array[:, 1] - measurements_array[:, 0]) * 0.5,
        (measurements_array[:, 3] - measurements_array[:, 2]) * 0.5,
    ))
    centers = np.vstack((lower_center, center, upper_center))
    half_sizes = np.vstack((np.zeros(2), half, np.zeros(2)))
    return low, high, fractions, np.column_stack((centers, half_sizes))


def _reconstruct(mesh: Mesh, fractions: np.ndarray, tracks: np.ndarray) -> Mesh:
    low = mesh.vertices.min(axis=0)
    high = mesh.vertices.max(axis=0)
    dimensions = high - low
    render_fraction, render_tracks = _pchip_sample(
        fractions, tracks, RENDER_SUBDIVISIONS
    )
    vertices: list[list[float]] = []
    faces: list[list[int]] = []
    # Keep caps as single vertices; all remaining sections are non-degenerate.
    vertices.append([
        low[0] + render_tracks[0, 0] * dimensions[0],
        low[1],
        low[2] + render_tracks[0, 1] * dimensions[2],
    ])
    interior = render_tracks[1:-1]
    interior_fraction = render_fraction[1:-1]
    for fraction, track in zip(interior_fraction, interior):
        center_x, center_z, half_x, half_z = track
        for radial in range(RADIAL_SEGMENTS):
            angle = 2.0 * math.pi * radial / RADIAL_SEGMENTS
            vertices.append([
                low[0] + (center_x + math.cos(angle) * half_x) * dimensions[0],
                low[1] + fraction * dimensions[1],
                low[2] + (center_z + math.sin(angle) * half_z) * dimensions[2],
            ])
    upper_cap = len(vertices)
    vertices.append([
        low[0] + render_tracks[-1, 0] * dimensions[0],
        high[1],
        low[2] + render_tracks[-1, 1] * dimensions[2],
    ])
    ring_count = len(interior)
    for ring in range(ring_count - 1):
        base = 1 + ring * RADIAL_SEGMENTS
        following = base + RADIAL_SEGMENTS
        for radial in range(RADIAL_SEGMENTS):
            next_radial = (radial + 1) % RADIAL_SEGMENTS
            faces.extend((
                [base + radial, following + radial, following + next_radial],
                [base + radial, following + next_radial, base + next_radial],
            ))
    for radial in range(RADIAL_SEGMENTS):
        next_radial = (radial + 1) % RADIAL_SEGMENTS
        faces.append([0, 1 + next_radial, 1 + radial])
        last_ring = 1 + (ring_count - 1) * RADIAL_SEGMENTS
        faces.append([upper_cap, last_ring + radial, last_ring + next_radial])
    return Mesh(f"{mesh.name}_coefficient_envelope", np.asarray(vertices), np.asarray(faces))


def _metric(source: Mesh, candidate: Mesh, axes: tuple[int, int]) -> dict:
    atlas_fit.SILHOUETTE_RESOLUTION = VALIDATION_RESOLUTION
    return atlas_fit._silhouette_metrics(source, candidate, axes)


def _bounds(mesh: Mesh) -> dict:
    low = mesh.vertices.min(axis=0)
    high = mesh.vertices.max(axis=0)
    return {
        "min": _round_vector(low),
        "max": _round_vector(high),
        "dimensions": _round_vector(high - low),
    }


def _fit_document_entry(mesh: Mesh, source: dict) -> tuple[dict, Mesh]:
    low, high, fractions, tracks = _fit_sections(mesh)
    candidate = _reconstruct(mesh, fractions, tracks)
    sections = []
    for fraction, track in zip(fractions, tracks):
        center_x, center_depth, half_width, half_depth = track
        sections.append({
            "vertical_fraction": _round(fraction),
            "center_x_fraction": _round(center_x),
            "center_depth_fraction": _round(center_depth),
            "half_width_fraction": _round(max(0.0, half_width)),
            "half_depth_fraction": _round(max(0.0, half_depth)),
            "left_x_fraction": _round(center_x + half_width),
            "right_x_fraction": _round(center_x - half_width),
            "anterior_fraction": _round(center_depth + half_depth),
            "posterior_fraction": _round(center_depth - half_depth),
        })
    front = _metric(mesh, candidate, (0, 1))
    profile = _metric(mesh, candidate, (2, 1))
    entry = {
        "source": source,
        "source_bounds_fit_frame": _bounds(mesh),
        "fit_frame": {
            "x": "+X anatomical left",
            "y": "+Y superior",
            "z": "+Z anterior",
            "normalization": "independent min-max normalization per fit-frame axis",
        },
        "coefficient_model": {
            "type": "PCHIP-interpolated asymmetric elliptical rings",
            "cap_rule": "single vertex at each exact vertical source bound",
            "section_count_including_caps": len(sections),
            "sections": sections,
        },
        "validation": {
            "front_xy_silhouette": front,
            "profile_zy_silhouette": profile,
            "passes_front_95_percent_iou": bool(front["intersection_over_union"] >= 0.95),
            "passes_profile_95_percent_iou": bool(profile["intersection_over_union"] >= 0.95),
        },
    }
    return entry, candidate


def _mask(mesh: Mesh, axes: tuple[int, int]) -> np.ndarray:
    low = mesh.vertices.min(axis=0)
    high = mesh.vertices.max(axis=0)
    atlas_fit.SILHOUETTE_RESOLUTION = VALIDATION_RESOLUTION
    return atlas_fit._raster_silhouette(mesh, axes, (low, high))


def _validation_panel(
    source: Mesh, candidate: Mesh, axes: tuple[int, int], title: str
) -> Image.Image:
    source_mask = _mask(source, axes)
    candidate_mask = atlas_fit._raster_silhouette(
        candidate, axes, (source.vertices.min(axis=0), source.vertices.max(axis=0))
    )
    rgb = np.zeros((VALIDATION_RESOLUTION, VALIDATION_RESOLUTION, 3), dtype=np.uint8)
    rgb[np.logical_and(source_mask, candidate_mask)] = (236, 236, 236)
    rgb[np.logical_and(source_mask, ~candidate_mask)] = (255, 70, 45)
    rgb[np.logical_and(~source_mask, candidate_mask)] = (40, 135, 255)
    panel = Image.fromarray(rgb)
    ImageDraw.Draw(panel).text((8, 8), title, fill=(255, 255, 255))
    return panel


def _write_validation(
    path: Path,
    liver: tuple[Mesh, Mesh],
    stomach: tuple[Mesh, Mesh],
) -> None:
    panels = [
        _validation_panel(*liver, (0, 1), "HRA liver — front XY"),
        _validation_panel(*liver, (2, 1), "HRA liver — profile ZY"),
        _validation_panel(*stomach, (0, 1), "BodyParts3D stomach — front XY"),
        _validation_panel(*stomach, (2, 1), "BodyParts3D stomach — profile ZY"),
    ]
    output = Image.new("RGB", (VALIDATION_RESOLUTION * 2, VALIDATION_RESOLUTION * 2))
    for index, panel in enumerate(panels):
        output.paste(panel, ((index % 2) * VALIDATION_RESOLUTION, (index // 2) * VALIDATION_RESOLUTION))
    path.parent.mkdir(parents=True, exist_ok=True)
    output.save(path)


def build_document(liver_path: Path, stomach_path: Path) -> tuple[dict, tuple[Mesh, Mesh], tuple[Mesh, Mesh]]:
    liver = _load_liver(liver_path)
    stomach = _load_stomach(stomach_path)
    liver_entry, liver_candidate = _fit_document_entry(liver, {
        "atlas": "HuBMAP Human Reference Atlas",
        "release_model": "female liver v1.1",
        "exact_mesh_name": "VH_F_capsule_of_the_liver",
        "path": liver_path.as_posix(),
        "sha256": _sha256(liver_path),
        "units": "meter",
        "license": "CC BY 4.0",
        "role": "registered female anatomical measurement source",
    })
    stomach_entry, stomach_candidate = _fit_document_entry(stomach, {
        "atlas": "BodyParts3D v4.0 PART-OF tree",
        "representation_id": "BP9480",
        "fma": "FMA:7148",
        "path": stomach_path.as_posix(),
        "sha256": _sha256(stomach_path),
        "units": "millimeter before normalization",
        "license": "CC BY 4.0 current database; preserve embedded legacy notice",
        "role": "adult-male morphology-only fallback; not registered to HRA female frame",
    })
    document = {
        "schema_version": SCHEMA_VERSION,
        "method": {
            "interior_section_count": INTERIOR_SECTION_COUNT,
            "section_distribution": "cosine-spaced horizontal planes",
            "interpolation": "Fritsch-Carlson shape-preserving cubic (PCHIP)",
            "runtime_cross_section": "ellipse through four measured cardinal extrema",
            "render_subdivisions_used_for_validation": RENDER_SUBDIVISIONS,
            "radial_segments_used_for_validation": RADIAL_SEGMENTS,
            "validation_resolution_px": VALIDATION_RESOLUTION,
        },
        "organs": {
            "liver_hra_female": liver_entry,
            "stomach_bodyparts3d_morphology": stomach_entry,
        },
        "integration_targets": {
            "liver_hra_female": {
                "targetMin": [-1.14, 5.90, -0.32],
                "targetSize": [1.87, 1.45, 1.16],
                "note": "drop-in replacement for the current liver target box; remove hand-authored silhouette deformPoint",
            },
            "stomach_bodyparts3d_morphology": {
                "targetMin": [-0.28, 5.74, 0.42],
                "targetSize": [1.10, 1.00, 0.58],
                "note": "landmark-scaled morphology target only; tune as a unit, never register BodyParts3D millimeters directly to HRA meters",
            },
        },
        "attribution": [
            "HuBMAP Human Reference Atlas, CC BY 4.0.",
            "BodyParts3D © The Database Center for Life Science licensed under CC Attribution 4.0 International.",
        ],
    }
    return document, (liver, liver_candidate), (stomach, stomach_candidate)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--liver",
        type=Path,
        default=Path("reference-atlas/models/hra/liver-female-v1.1.glb"),
    )
    parser.add_argument(
        "--stomach",
        type=Path,
        default=Path("reference-atlas/models/bodyparts3d/stomach-bodyparts3d-v4.0-99.obj"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reference-atlas/fits/official-abdominal-envelopes.json"),
    )
    parser.add_argument(
        "--validation-image",
        type=Path,
        default=Path("reference-atlas/fits/official-abdominal-envelope-validation.png"),
    )
    args = parser.parse_args()
    document, liver_pair, stomach_pair = build_document(args.liver, args.stomach)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    _write_validation(args.validation_image, liver_pair, stomach_pair)
    for key, fit in document["organs"].items():
        validation = fit["validation"]
        print(
            f"{key}: front IoU={validation['front_xy_silhouette']['intersection_over_union']:.4f}, "
            f"profile IoU={validation['profile_zy_silhouette']['intersection_over_union']:.4f}"
        )
    if not all(
        organ["validation"][gate]
        for organ in document["organs"].values()
        for gate in ("passes_front_95_percent_iou", "passes_profile_95_percent_iou")
    ):
        raise SystemExit("one or more abdominal envelope fits failed the 95% IoU gate")


if __name__ == "__main__":
    main()
