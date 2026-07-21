#!/usr/bin/env python3
"""Build smooth, detail-preserving render tracks from the official HRA lung loft.

The source fit stores 21 rings as polar radii about a per-plane interior point.
Those interior points can move sharply between planes, so connecting equal
polar-angle indices produces twisted quads and visible transverse ridges.  This
post-fit keeps the measured ring boundary itself, smooths corresponding X-Z
point tracks in the anatomical Y direction, and interpolates the tracks with a
shape-preserving cubic (PCHIP).  The four silhouette extrema on every measured
plane are never moved.

The output is an integration artifact; it does not replace the official source
fit or ship the HRA GLB at runtime.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Sequence

import numpy as np
from PIL import Image, ImageDraw

import fit_anatomical_lofts as base_fit
from mesh_analysis import Mesh, combine_meshes, load_meshes


ANGLE_COUNT = 48
CARDINAL_INDICES = np.asarray([0, 12, 24, 36], dtype=np.int64)
DEFAULT_LEFT_FAIRING_PASSES = 1
DEFAULT_RIGHT_FAIRING_PASSES = 3
DEFAULT_FAIRING_WEIGHT = 0.12
DEFAULT_SUBDIVISIONS = 4
VALIDATION_RESOLUTION = 256


def _round_scalar(value: float) -> float:
    return round(float(value), 7)


def _round_vector(values: Sequence[float]) -> list[float]:
    return [_round_scalar(value) for value in values]


def _directions(document: dict) -> np.ndarray:
    angles = np.asarray(document["sampling"]["polar_angle_radians"], dtype=np.float64)
    if len(angles) != ANGLE_COUNT:
        raise ValueError(f"expected {ANGLE_COUNT} polar angles, found {len(angles)}")
    return np.column_stack((np.cos(angles), np.sin(angles)))


def _raw_point_sections(document: dict, organ_key: str) -> tuple[np.ndarray, np.ndarray]:
    directions = _directions(document)
    sections = document["organs"][organ_key]["loft"]["sections"]
    y = np.asarray([section["y_m"] for section in sections], dtype=np.float64)
    points: list[np.ndarray] = []
    for section in sections:
        center = np.asarray(section["center_xz_m"], dtype=np.float64)
        radii = np.asarray(section["radii_m"], dtype=np.float64)
        points.append(center + radii[:, None] * directions)
    return y, np.asarray(points)


def _matched_ellipse(points: np.ndarray, directions: np.ndarray) -> np.ndarray:
    low = points.min(axis=1)
    high = points.max(axis=1)
    center = (low + high) * 0.5
    half = np.maximum((high - low) * 0.5, 1e-8)
    cosine = directions[:, 0][None, :]
    sine = directions[:, 1][None, :]
    radius = 1.0 / np.sqrt(
        (cosine / half[:, 0, None]) ** 2 + (sine / half[:, 1, None]) ** 2
    )
    return center[:, None, :] + radius[:, :, None] * directions[None, :, :]


def _fair_tracks(
    raw_points: np.ndarray,
    passes: int,
    weight: float,
) -> np.ndarray:
    points = raw_points.copy()
    for _ in range(passes):
        filtered = np.concatenate(
            (
                points[:1],
                weight * points[:-2]
                + (1.0 - 2.0 * weight) * points[1:-1]
                + weight * points[2:],
                points[-1:],
            ),
            axis=0,
        )
        # Exact +X, +Z, -X and -Z guards preserve the measured frontal and
        # profile silhouettes at every official sampling plane.
        filtered[:, CARDINAL_INDICES] = raw_points[:, CARDINAL_INDICES]
        points = filtered
    return points


def _pchip_slopes(x: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Fritsch-Carlson shape-preserving slopes for vector-valued tracks."""

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
            adjacent = delta[0]
            following = delta[1]
        else:
            estimate = (
                (2.0 * interval[-1] + interval[-2]) * delta[-1]
                - interval[-1] * delta[-2]
            ) / (interval[-1] + interval[-2])
            adjacent = delta[-1]
            following = delta[-2]
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
    x: np.ndarray,
    values: np.ndarray,
    subdivisions: int,
) -> tuple[np.ndarray, np.ndarray]:
    slopes = _pchip_slopes(x, values)
    sample_x: list[float] = []
    sample_values: list[np.ndarray] = []
    for interval_index in range(len(x) - 1):
        interval = x[interval_index + 1] - x[interval_index]
        for subdivision in range(subdivisions):
            amount = subdivision / subdivisions
            amount2 = amount * amount
            amount3 = amount2 * amount
            value = (
                (2.0 * amount3 - 3.0 * amount2 + 1.0) * values[interval_index]
                + (amount3 - 2.0 * amount2 + amount)
                * interval
                * slopes[interval_index]
                + (-2.0 * amount3 + 3.0 * amount2) * values[interval_index + 1]
                + (amount3 - amount2) * interval * slopes[interval_index + 1]
            )
            sample_x.append(x[interval_index] + amount * interval)
            sample_values.append(value)
    sample_x.append(float(x[-1]))
    sample_values.append(values[-1])
    return np.asarray(sample_x), np.asarray(sample_values)


def _triangle_normal(triangle: np.ndarray) -> np.ndarray:
    return np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])


def _normal_dot(first: np.ndarray, second: np.ndarray) -> float:
    left = _triangle_normal(first)
    right = _triangle_normal(second)
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    return float(np.dot(left, right) / max(denominator, 1e-20))


def _quad_options(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray) -> tuple[float, float]:
    first = _normal_dot(np.asarray((a, b, c)), np.asarray((a, c, d)))
    second = _normal_dot(np.asarray((a, b, d)), np.asarray((b, c, d)))
    return first, second


def _render_xyz(render_y: np.ndarray, render_xz: np.ndarray) -> np.ndarray:
    rings = np.empty((len(render_y), ANGLE_COUNT, 3), dtype=np.float64)
    rings[:, :, 0] = render_xz[:, :, 0]
    rings[:, :, 1] = render_y[:, None]
    rings[:, :, 2] = render_xz[:, :, 1]
    return rings


def _bad_quads(render_y: np.ndarray, render_xz: np.ndarray) -> list[tuple[int, int]]:
    rings = _render_xyz(render_y, render_xz)
    bad: list[tuple[int, int]] = []
    for ring_index in range(len(rings) - 1):
        for ray in range(ANGLE_COUNT):
            next_ray = (ray + 1) % ANGLE_COUNT
            a = rings[ring_index, ray]
            b = rings[ring_index + 1, ray]
            c = rings[ring_index + 1, next_ray]
            d = rings[ring_index, next_ray]
            if max(_quad_options(a, b, c, d)) <= 0.0:
                bad.append((ring_index, ray))
    return bad


def _repair_folds(
    y: np.ndarray,
    raw_points: np.ndarray,
    fair_points: np.ndarray,
    subdivisions: int,
    max_iterations: int = 12,
) -> tuple[np.ndarray, int]:
    """Blend only folded neighborhoods toward their matched ellipse."""

    points = fair_points.copy()
    ellipse = _matched_ellipse(raw_points, _directions_from_points(raw_points))
    for iteration in range(max_iterations + 1):
        render_y, render_xz = _pchip_sample(y, points, subdivisions)
        bad = _bad_quads(render_y, render_xz)
        if not bad:
            return points, iteration
        if iteration == max_iterations:
            raise RuntimeError(f"fold repair did not converge; {len(bad)} bad quads remain")

        blend = np.zeros(points.shape[:2], dtype=np.float64)
        for render_ring, ray in bad:
            source_interval = min(render_ring // subdivisions, len(y) - 2)
            for section in range(
                max(0, source_interval - 1), min(len(y), source_interval + 3)
            ):
                section_weight = 0.12 if section in (source_interval - 1, source_interval + 2) else 0.24
                for ray_offset, ray_weight in (
                    (-2, 0.25),
                    (-1, 0.60),
                    (0, 1.00),
                    (1, 1.00),
                    (2, 0.60),
                    (3, 0.25),
                ):
                    affected_ray = (ray + ray_offset) % ANGLE_COUNT
                    if affected_ray in CARDINAL_INDICES:
                        continue
                    blend[section, affected_ray] = max(
                        blend[section, affected_ray], section_weight * ray_weight
                    )
        points = points * (1.0 - blend[:, :, None]) + ellipse * blend[:, :, None]
        points[:, CARDINAL_INDICES] = raw_points[:, CARDINAL_INDICES]
    raise AssertionError("unreachable")


def _directions_from_points(points: np.ndarray) -> np.ndarray:
    # The source artifact always has 48 evenly spaced polar rays.  Recreating
    # the directions here keeps fold repair independent of module-global state.
    angles = np.arange(points.shape[1], dtype=np.float64) * (2.0 * math.pi / points.shape[1])
    return np.column_stack((np.cos(angles), np.sin(angles)))


def _build_mesh(
    name: str,
    render_y: np.ndarray,
    render_xz: np.ndarray,
    lower_cap_y: float,
    upper_cap_y: float,
) -> tuple[Mesh, np.ndarray]:
    rings = _render_xyz(render_y, render_xz)
    vertices = rings.reshape(-1, 3).tolist()
    faces: list[list[int]] = []
    diagonals = np.zeros((len(rings) - 1, ANGLE_COUNT), dtype=np.uint8)
    for ring_index in range(len(rings) - 1):
        for ray in range(ANGLE_COUNT):
            next_ray = (ray + 1) % ANGLE_COUNT
            a = ring_index * ANGLE_COUNT + ray
            b = (ring_index + 1) * ANGLE_COUNT + ray
            c = (ring_index + 1) * ANGLE_COUNT + next_ray
            d = ring_index * ANGLE_COUNT + next_ray
            first, second = _quad_options(
                rings[ring_index, ray],
                rings[ring_index + 1, ray],
                rings[ring_index + 1, next_ray],
                rings[ring_index, next_ray],
            )
            if second > first:
                faces.extend(((a, b, d), (b, c, d)))
                diagonals[ring_index, ray] = 1
            else:
                faces.extend(((a, b, c), (a, c, d)))

    lower_cap = len(vertices)
    vertices.append([render_xz[0, :, 0].mean(), lower_cap_y, render_xz[0, :, 1].mean()])
    upper_cap = len(vertices)
    vertices.append([render_xz[-1, :, 0].mean(), upper_cap_y, render_xz[-1, :, 1].mean()])
    top = (len(rings) - 1) * ANGLE_COUNT
    for ray in range(ANGLE_COUNT):
        next_ray = (ray + 1) % ANGLE_COUNT
        faces.append([lower_cap, next_ray, ray])
        faces.append([upper_cap, top + ray, top + next_ray])
    return Mesh(name, np.asarray(vertices), np.asarray(faces)), diagonals


def _polygon_mask(points: np.ndarray, low: np.ndarray, high: np.ndarray) -> np.ndarray:
    pixels = (points - low) / np.maximum(high - low, 1e-12) * (VALIDATION_RESOLUTION - 1)
    image = Image.new("1", (VALIDATION_RESOLUTION, VALIDATION_RESOLUTION), 0)
    ImageDraw.Draw(image).polygon([tuple(point) for point in pixels], fill=1)
    return np.asarray(image, dtype=bool)


def _mean_section_iou(raw: np.ndarray, candidate: np.ndarray) -> float:
    all_points = np.concatenate((raw.reshape(-1, 2), candidate.reshape(-1, 2)), axis=0)
    low = all_points.min(axis=0)
    high = all_points.max(axis=0)
    scores: list[float] = []
    for raw_section, candidate_section in zip(raw, candidate):
        raw_mask = _polygon_mask(raw_section, low, high)
        candidate_mask = _polygon_mask(candidate_section, low, high)
        intersection = np.logical_and(raw_mask, candidate_mask).sum()
        union = np.logical_or(raw_mask, candidate_mask).sum()
        scores.append(float(intersection / union))
    return float(np.mean(scores))


def _strict_segment_intersection(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray) -> bool:
    def cross(origin: np.ndarray, first: np.ndarray, second: np.ndarray) -> float:
        left = first - origin
        right = second - origin
        return float(left[0] * right[1] - left[1] * right[0])

    return cross(a, b, c) * cross(a, b, d) < 0.0 and cross(c, d, a) * cross(c, d, b) < 0.0


def _self_intersection_count(render_xz: np.ndarray) -> int:
    return len(_self_intersections(render_xz))


def _self_intersections(render_xz: np.ndarray) -> list[tuple[int, int, int]]:
    intersections: list[tuple[int, int, int]] = []
    for ring_index, polygon in enumerate(render_xz):
        for first in range(ANGLE_COUNT):
            a = polygon[first]
            b = polygon[(first + 1) % ANGLE_COUNT]
            for second in range(first + 2, ANGLE_COUNT):
                if (second + 1) % ANGLE_COUNT == first:
                    continue
                c = polygon[second]
                d = polygon[(second + 1) % ANGLE_COUNT]
                if _strict_segment_intersection(a, b, c, d):
                    intersections.append((ring_index, first, second))
    return intersections


def _surface_normal_jumps(rings: np.ndarray) -> np.ndarray:
    angular_tangent = np.roll(rings, -1, axis=1) - np.roll(rings, 1, axis=1)
    vertical_tangent = np.zeros_like(rings)
    vertical_tangent[1:-1] = rings[2:] - rings[:-2]
    normals = np.cross(angular_tangent, vertical_tangent)
    normals /= np.maximum(np.linalg.norm(normals, axis=2, keepdims=True), 1e-12)
    dot = np.sum(normals[2:-2] * normals[3:-1], axis=2)
    return np.degrees(np.arccos(np.clip(dot, -1.0, 1.0)))


def _validation_metrics(
    source: Mesh,
    raw_points: np.ndarray,
    anchor_points: np.ndarray,
    mesh: Mesh,
    render_y: np.ndarray,
    render_xz: np.ndarray,
    repair_iterations: int,
) -> dict:
    source_low = source.vertices.min(axis=0)
    source_high = source.vertices.max(axis=0)
    mesh_low = mesh.vertices.min(axis=0)
    mesh_high = mesh.vertices.max(axis=0)
    dimension_error = np.abs((mesh_high - mesh_low) / (source_high - source_low) - 1.0)
    rings = _render_xyz(render_y, render_xz)
    normal_jumps = _surface_normal_jumps(rings)
    bad = _bad_quads(render_y, render_xz)
    cardinal_error = np.abs(
        anchor_points[:, CARDINAL_INDICES] - raw_points[:, CARDINAL_INDICES]
    )
    return {
        "front_xy_silhouette": base_fit._silhouette_metrics(source, mesh, (0, 1)),
        "profile_zy_silhouette": base_fit._silhouette_metrics(source, mesh, (2, 1)),
        "aabb_dimension_error_fraction_xyz": _round_vector(dimension_error),
        "aabb_max_dimension_error_fraction": _round_scalar(dimension_error.max()),
        "mean_measured_section_iou": _round_scalar(_mean_section_iou(raw_points, anchor_points)),
        "anchor_point_rms_displacement_mm": _round_scalar(
            np.sqrt(np.mean(np.sum((anchor_points - raw_points) ** 2, axis=2))) * 1000.0
        ),
        "cardinal_extrema_max_error_m": _round_scalar(cardinal_error.max()),
        "normal_jump_degrees_mean": _round_scalar(normal_jumps.mean()),
        "normal_jump_degrees_p95": _round_scalar(np.percentile(normal_jumps, 95)),
        "normal_jump_over_45_degrees_fraction": _round_scalar(np.mean(normal_jumps > 45.0)),
        "folded_quad_count_best_diagonal": len(bad),
        "render_ring_self_intersection_count": _self_intersection_count(render_xz),
        "fold_repair_iterations": repair_iterations,
    }


def _catmull_sample(x: np.ndarray, values: np.ndarray, subdivisions: int) -> tuple[np.ndarray, np.ndarray]:
    sample_x: list[float] = []
    sample_values: list[np.ndarray] = []
    for index in range(len(x) - 1):
        p0 = values[max(0, index - 1)]
        p1 = values[index]
        p2 = values[index + 1]
        p3 = values[min(len(values) - 1, index + 2)]
        for subdivision in range(subdivisions):
            amount = subdivision / subdivisions
            amount2 = amount * amount
            amount3 = amount2 * amount
            value = 0.5 * (
                2.0 * p1
                + (-p0 + p2) * amount
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * amount2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * amount3
            )
            sample_x.append(x[index] + amount * (x[index + 1] - x[index]))
            sample_values.append(value)
    sample_x.append(float(x[-1]))
    sample_values.append(values[-1])
    return np.asarray(sample_x), np.asarray(sample_values)


def _current_ellipse_baseline(
    raw_points: np.ndarray,
    y: np.ndarray,
    subdivisions: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    low = raw_points.min(axis=1)
    high = raw_points.max(axis=1)
    section_values = np.column_stack(((low + high) * 0.5, (high - low) * 0.5))
    for _ in range(3):
        section_values = np.concatenate(
            (
                section_values[:1],
                0.18 * section_values[:-2]
                + 0.64 * section_values[1:-1]
                + 0.18 * section_values[2:],
                section_values[-1:],
            ),
            axis=0,
        )
    render_y, render_values = _catmull_sample(y, section_values, subdivisions)
    directions = _directions_from_points(raw_points)
    center = render_values[:, :2]
    half = np.maximum(render_values[:, 2:], 1e-8)
    radius = 1.0 / np.sqrt(
        (directions[:, 0][None, :] / half[:, 0, None]) ** 2
        + (directions[:, 1][None, :] / half[:, 1, None]) ** 2
    )
    render_xz = center[:, None, :] + radius[:, :, None] * directions[None, :, :]

    anchor_center = section_values[:, :2]
    anchor_half = section_values[:, 2:]
    anchor_radius = 1.0 / np.sqrt(
        (directions[:, 0][None, :] / anchor_half[:, 0, None]) ** 2
        + (directions[:, 1][None, :] / anchor_half[:, 1, None]) ** 2
    )
    anchor_xz = anchor_center[:, None, :] + anchor_radius[:, :, None] * directions[None, :, :]
    return render_y, render_xz, anchor_xz


def _lung_source_mesh(lung_glb: Path, side: str) -> Mesh:
    meshes = load_meshes(lung_glb)
    selected = []
    for mesh in meshes:
        name = mesh.name.lower()
        if "bronchopulmonary_seg" not in name:
            continue
        if f"_{side}_" in name or (side == "left" and "_lingula_" in name):
            selected.append(mesh)
    if len(selected) != 10:
        raise ValueError(f"expected ten {side} lung segment meshes, found {len(selected)}")
    return combine_meshes(selected, f"{side}_lung_source")


def _overlap_image(source_mask: np.ndarray, candidate_mask: np.ndarray) -> Image.Image:
    image = np.zeros((*source_mask.shape, 3), dtype=np.uint8)
    overlap = np.logical_and(source_mask, candidate_mask)
    image[np.logical_and(source_mask, ~candidate_mask)] = (255, 64, 64)
    image[np.logical_and(candidate_mask, ~source_mask)] = (64, 128, 255)
    image[overlap] = (235, 235, 235)
    return Image.fromarray(image)


def _validation_panel(
    rows: list[tuple[str, Mesh, Mesh, np.ndarray, np.ndarray]],
    output: Path,
) -> None:
    panel_size = VALIDATION_RESOLUTION
    header = 22
    columns = 5
    canvas = Image.new("RGB", (columns * panel_size, len(rows) * (panel_size + header)), "black")
    draw = ImageDraw.Draw(canvas)
    for row_index, (name, source, candidate, raw, anchors) in enumerate(rows):
        source_low = source.vertices.min(axis=0)
        source_high = source.vertices.max(axis=0)
        for column, (label, axes) in enumerate((('front XY', (0, 1)), ('profile ZY', (2, 1)))):
            bounds = (source_low.copy(), source_high.copy())
            source_mask = base_fit._raster_silhouette(source, axes, bounds)
            candidate_mask = base_fit._raster_silhouette(candidate, axes, bounds)
            panel = _overlap_image(source_mask, candidate_mask)
            x = column * panel_size
            y = row_index * (panel_size + header) + header
            canvas.paste(panel, (x, y))
            draw.text((x + 5, y - header + 5), f"{name} - {label}", fill="white")

        all_points = np.concatenate((raw.reshape(-1, 2), anchors.reshape(-1, 2)), axis=0)
        low = all_points.min(axis=0)
        high = all_points.max(axis=0)
        for offset, section_index in enumerate((5, 10, 15), start=2):
            raw_mask = _polygon_mask(raw[section_index], low, high)
            candidate_mask = _polygon_mask(anchors[section_index], low, high)
            panel = _overlap_image(raw_mask, candidate_mask)
            x = offset * panel_size
            y = row_index * (panel_size + header) + header
            canvas.paste(panel, (x, y))
            draw.text((x + 5, y - header + 5), f"{name} - section {section_index}", fill="white")
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)


def build_artifact(
    source_document: dict,
    lung_glb: Path,
    subdivisions: int,
    fairing_passes_by_side: dict[str, int],
    fairing_weight: float,
) -> tuple[dict, list[tuple[str, Mesh, Mesh, np.ndarray, np.ndarray]]]:
    artifact = {
        "schema_version": "1.0.0",
        "generator": "tools/reference-analysis/fit_smooth_lung_tracks.py",
        "coordinate_frame": source_document["coordinate_frame"],
        "official_source": source_document["official_source"],
        "source_fit": "reference-atlas/fits/hra-female-lung-liver-lofts.json",
        "algorithm": {
            "representation": "direct X-Z boundary point tracks at anatomical Y planes",
            "ray_count": ANGLE_COUNT,
            "axial_fairing": {
                "passes_by_side": fairing_passes_by_side,
                "weights": [fairing_weight, 1.0 - 2.0 * fairing_weight, fairing_weight],
                "locked_ray_indices": CARDINAL_INDICES.tolist(),
            },
            "interpolation": {
                "method": "Fritsch-Carlson PCHIP independently on X and Z point tracks",
                "subdivisions_per_measured_interval": subdivisions,
            },
            "fold_repair": (
                "Iteratively blend only neighborhoods whose two possible quad diagonals both "
                "have non-positive triangle-normal agreement toward the section's matched ellipse; "
                "never move measured cardinal extrema."
            ),
            "triangulation": "choose per-quad diagonal with the higher adjacent-triangle normal dot product",
        },
        "organs": {},
    }
    validation_rows: list[tuple[str, Mesh, Mesh, np.ndarray, np.ndarray]] = []
    for side in ("left", "right"):
        organ_key = f"{side}_lung"
        y, raw_points = _raw_point_sections(source_document, organ_key)
        side_fairing_passes = fairing_passes_by_side[side]
        fair_points = _fair_tracks(raw_points, side_fairing_passes, fairing_weight)
        anchor_points, repair_iterations = _repair_folds(
            y, raw_points, fair_points, subdivisions
        )
        render_y, render_xz = _pchip_sample(y, anchor_points, subdivisions)
        loft = source_document["organs"][organ_key]["loft"]
        candidate, diagonals = _build_mesh(
            organ_key,
            render_y,
            render_xz,
            loft["lower_cap_y_m"],
            loft["upper_cap_y_m"],
        )
        source = _lung_source_mesh(lung_glb, side)
        metrics = _validation_metrics(
            source,
            raw_points,
            anchor_points,
            candidate,
            render_y,
            render_xz,
            repair_iterations,
        )

        baseline_y, baseline_xz, baseline_anchors = _current_ellipse_baseline(
            raw_points, y, subdivisions
        )
        baseline, _ = _build_mesh(
            f"{organ_key}_ellipse_baseline",
            baseline_y,
            baseline_xz,
            loft["lower_cap_y_m"],
            loft["upper_cap_y_m"],
        )
        baseline_metrics = _validation_metrics(
            source,
            raw_points,
            baseline_anchors,
            baseline,
            baseline_y,
            baseline_xz,
            0,
        )

        sections = []
        for index, (section_y, points) in enumerate(zip(y, anchor_points)):
            sections.append(
                {
                    "index": index,
                    "y_m": _round_scalar(section_y),
                    "ring_xz_m": [_round_vector(point) for point in points],
                }
            )
        artifact["organs"][organ_key] = {
            "source_bounds": source_document["organs"][organ_key]["source_bounds"],
            "lower_cap_y_m": loft["lower_cap_y_m"],
            "upper_cap_y_m": loft["upper_cap_y_m"],
            "sections": sections,
            "render_ring_count": len(render_y),
            "axial_fairing_passes": side_fairing_passes,
            "adaptive_diagonal_one_fraction": _round_scalar(diagonals.mean()),
            "validation": metrics,
            "current_ellipse_baseline": baseline_metrics,
        }
        validation_rows.append((side, source, candidate, raw_points, anchor_points))
    return artifact, validation_rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-fit",
        type=Path,
        default=Path("reference-atlas/fits/hra-female-lung-liver-lofts.json"),
    )
    parser.add_argument(
        "--lung",
        type=Path,
        default=Path("reference-atlas/models/hra/lung-female-v1.3.glb"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reference-atlas/fits/hra-female-lung-smooth-tracks.json"),
    )
    parser.add_argument(
        "--validation-image",
        type=Path,
        default=Path("reference-atlas/fits/smooth-lung-track-validation.png"),
    )
    parser.add_argument("--subdivisions", type=int, default=DEFAULT_SUBDIVISIONS)
    parser.add_argument(
        "--left-fairing-passes", type=int, default=DEFAULT_LEFT_FAIRING_PASSES
    )
    parser.add_argument(
        "--right-fairing-passes", type=int, default=DEFAULT_RIGHT_FAIRING_PASSES
    )
    parser.add_argument("--fairing-weight", type=float, default=DEFAULT_FAIRING_WEIGHT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_document = json.loads(args.source_fit.read_text(encoding="utf-8"))
    artifact, validation_rows = build_artifact(
        source_document,
        args.lung,
        args.subdivisions,
        {"left": args.left_fairing_passes, "right": args.right_fairing_passes},
        args.fairing_weight,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    _validation_panel(validation_rows, args.validation_image)
    for organ_key, organ in artifact["organs"].items():
        validation = organ["validation"]
        baseline = organ["current_ellipse_baseline"]
        print(
            f"{organ_key}: front={validation['front_xy_silhouette']['intersection_over_union']:.4f}, "
            f"profile={validation['profile_zy_silhouette']['intersection_over_union']:.4f}, "
            f"section-IoU={validation['mean_measured_section_iou']:.4f}, "
            f"normal-p95={validation['normal_jump_degrees_p95']:.2f} deg, "
            f"folds={validation['folded_quad_count_best_diagonal']} "
            f"(ellipse section-IoU={baseline['mean_measured_section_iou']:.4f})"
        )
        if validation["folded_quad_count_best_diagonal"] != 0:
            raise SystemExit(f"{organ_key} still contains folded quads")
        if validation["render_ring_self_intersection_count"] != 0:
            raise SystemExit(f"{organ_key} contains a self-intersecting render ring")
    print(args.output)
    print(args.validation_image)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
