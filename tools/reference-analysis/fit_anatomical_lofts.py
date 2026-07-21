#!/usr/bin/env python3
"""Fit compact deterministic polar lofts to selected HRA organ surfaces.

The fitter keeps the HRA common-body coordinates intact.  It intersects an
organ with anatomical +Y planes, casts rays in each X-Z section, and records
the outermost surface hit.  The resulting JSON is intentionally simple to
reconstruct in Three.js without shipping the official atlas mesh at runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw

from mesh_analysis import Mesh, combine_meshes, load_meshes


SCHEMA_VERSION = "1.0.0"
PLANE_COUNT = 21
ANGLE_COUNT = 48
PLANE_END_INSET = 0.002
SILHOUETTE_RESOLUTION = 320


@dataclass
class LoftFit:
    key: str
    source_path: Path
    source_meshes: list[Mesh]
    filter_description: dict


def _round_scalar(value: float) -> float:
    return round(float(value), 7)


def _round_vector(values: Sequence[float]) -> list[float]:
    return [_round_scalar(value) for value in values]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _portable_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def _lung_segments(meshes: Iterable[Mesh], side: str) -> tuple[list[Mesh], dict]:
    selected: list[Mesh] = []
    for mesh in meshes:
        name = mesh.name.lower()
        is_parenchyma_segment = "bronchopulmonary_seg" in name
        is_side = f"_{side}_" in name or (side == "left" and "_lingula_" in name)
        if is_parenchyma_segment and is_side:
            selected.append(mesh)
    if len(selected) != 10:
        raise ValueError(f"expected 10 {side} parenchyma segments, found {len(selected)}")
    return selected, {
        "include_case_insensitive_substring": "bronchopulmonary_seg",
        "side_rule": (
            "name contains _left_ or _lingula_"
            if side == "left"
            else "name contains _right_"
        ),
        "excluded_structures": ["bronchi", "bronchial cartilage", "hilum"],
        "matched_mesh_names": [mesh.name for mesh in selected],
    }


def _liver_capsule(meshes: Iterable[Mesh]) -> tuple[list[Mesh], dict]:
    selected = [mesh for mesh in meshes if mesh.name == "VH_F_capsule_of_the_liver"]
    if len(selected) != 1:
        raise ValueError(f"expected one liver capsule mesh, found {len(selected)}")
    return selected, {
        "exact_mesh_name": "VH_F_capsule_of_the_liver",
        "excluded_structures": [
            "segment meshes",
            "surface impressions",
            "ligaments",
            "porta hepatis",
        ],
        "matched_mesh_names": [mesh.name for mesh in selected],
    }


def _plane_segments(mesh: Mesh, y: float) -> np.ndarray:
    """Return X-Z line segments formed by intersecting triangles with y."""

    triangles = mesh.vertices[mesh.faces]
    low = triangles[:, :, 1].min(axis=1)
    high = triangles[:, :, 1].max(axis=1)
    diagonal = float(np.linalg.norm(np.ptp(mesh.vertices, axis=0)))
    tolerance = max(diagonal * 1e-12, 1e-14)
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
            # A half-open edge rule avoids counting a vertex twice.
            if not ((a[1] <= y < b[1]) or (b[1] <= y < a[1])):
                continue
            amount = (y - a[1]) / delta
            point = a + amount * (b - a)
            hits.append(point[[0, 2]])
        if len(hits) == 2 and np.linalg.norm(hits[1] - hits[0]) > tolerance:
            segments.append(np.asarray(hits, dtype=np.float64))
    if not segments:
        raise ValueError(f"plane y={y:.9f} did not intersect {mesh.name}")
    return np.asarray(segments, dtype=np.float64)


def _cross2(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    return left[..., 0] * right[..., 1] - left[..., 1] * right[..., 0]


def _fill_circular_missing(values: np.ndarray) -> np.ndarray:
    valid = np.flatnonzero(np.isfinite(values))
    if len(valid) < 3:
        raise ValueError("fewer than three polar rays hit the cross-section")
    if len(valid) == len(values):
        return values
    length = len(values)
    xp = np.concatenate((valid - length, valid, valid + length))
    fp = np.concatenate((values[valid], values[valid], values[valid]))
    missing = np.flatnonzero(~np.isfinite(values))
    values[missing] = np.interp(missing, xp, fp)
    return values


def _deep_interior_point(segments: np.ndarray) -> np.ndarray | None:
    """Find a deterministic well-inside point using an even/odd section test."""

    starts = segments[:, 0]
    vectors = segments[:, 1] - starts
    lengths_squared = np.einsum("ij,ij->i", vectors, vectors)
    points = segments.reshape(-1, 2)
    section_min = points.min(axis=0)
    section_max = points.max(axis=0)
    inset = 0.03 * (section_max - section_min)
    x_values = np.linspace(section_min[0] + inset[0], section_max[0] - inset[0], 31)
    z_values = np.linspace(section_min[1] + inset[1], section_max[1] - inset[1], 31)
    best_distance_squared = -1.0
    best: np.ndarray | None = None
    for z in z_values:
        z_crossing = (starts[:, 1] > z) != (segments[:, 1, 1] > z)
        denominators = vectors[:, 1]
        usable = z_crossing & (np.abs(denominators) > 1e-14)
        intersection_x = np.full(len(segments), np.inf, dtype=np.float64)
        intersection_x[usable] = (
            starts[usable, 0]
            + (z - starts[usable, 1]) * vectors[usable, 0] / denominators[usable]
        )
        for x in x_values:
            if int(np.count_nonzero(usable & (intersection_x > x))) % 2 == 0:
                continue
            candidate = np.asarray([x, z])
            amounts = np.clip(
                np.einsum("ij,ij->i", candidate - starts, vectors)
                / np.where(lengths_squared > 0.0, lengths_squared, 1.0),
                0.0,
                1.0,
            )
            closest = starts + amounts[:, None] * vectors
            distance_squared = float(np.min(np.sum((closest - candidate) ** 2, axis=1)))
            if distance_squared > best_distance_squared:
                best_distance_squared = distance_squared
                best = candidate
    return best


def _sample_section(segments: np.ndarray, angle_count: int) -> tuple[np.ndarray, np.ndarray]:
    points = segments.reshape(-1, 2)
    section_min = points.min(axis=0)
    section_max = points.max(axis=0)
    center = _deep_interior_point(segments)
    if center is None:
        center = (section_min + section_max) * 0.5
    starts = segments[:, 0]
    vectors = segments[:, 1] - segments[:, 0]
    relative = starts - center
    radii = np.full(angle_count, np.nan, dtype=np.float64)
    for index in range(angle_count):
        angle = 2.0 * math.pi * index / angle_count
        direction = np.asarray([math.cos(angle), math.sin(angle)])
        denominator = _cross2(np.broadcast_to(direction, vectors.shape), vectors)
        usable = np.abs(denominator) > 1e-14
        distance = np.full(len(vectors), np.nan, dtype=np.float64)
        segment_amount = np.full(len(vectors), np.nan, dtype=np.float64)
        distance[usable] = _cross2(relative[usable], vectors[usable]) / denominator[usable]
        segment_amount[usable] = _cross2(
            relative[usable], np.broadcast_to(direction, relative[usable].shape)
        ) / denominator[usable]
        hits = distance[
            usable
            & (distance >= -1e-12)
            & (segment_amount >= -1e-10)
            & (segment_amount <= 1.0 + 1e-10)
        ]
        if len(hits):
            radii[index] = max(float(hits.max()), 0.0)
    radii = _fill_circular_missing(radii)

    # A section can be non-star-shaped around its bounding-box center (most
    # noticeably near the basal right lung).  Circular interpolation of a
    # missing ray must never leave the actual section bounds.  Four axial
    # silhouette guards also retain the exact front/profile extrema even when
    # the anatomical extremum occurs at a different depth than the ray origin.
    for index in range(angle_count):
        angle = 2.0 * math.pi * index / angle_count
        direction = np.asarray([math.cos(angle), math.sin(angle)])
        limits: list[float] = []
        for axis in range(2):
            if direction[axis] > 1e-14:
                limits.append((section_max[axis] - center[axis]) / direction[axis])
            elif direction[axis] < -1e-14:
                limits.append((section_min[axis] - center[axis]) / direction[axis])
        radii[index] = min(radii[index], min(limits))
    radii[0] = section_max[0] - center[0]
    radii[angle_count // 4] = section_max[1] - center[1]
    radii[angle_count // 2] = center[0] - section_min[0]
    radii[3 * angle_count // 4] = center[1] - section_min[1]
    return center, radii


def _fit_sections(mesh: Mesh) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    source_min = mesh.vertices.min(axis=0)
    source_max = mesh.vertices.max(axis=0)
    fractions = np.linspace(PLANE_END_INSET, 1.0 - PLANE_END_INSET, PLANE_COUNT)
    plane_y = source_min[1] + fractions * (source_max[1] - source_min[1])
    centers: list[np.ndarray] = []
    radii: list[np.ndarray] = []
    for y in plane_y:
        segments = _plane_segments(mesh, float(y))
        center, section_radii = _sample_section(segments, ANGLE_COUNT)
        centers.append(center)
        radii.append(section_radii)
    return fractions, plane_y, np.asarray(centers), np.asarray(radii)


def _loft_mesh(
    key: str,
    source_bounds: tuple[np.ndarray, np.ndarray],
    plane_y: np.ndarray,
    centers: np.ndarray,
    radii: np.ndarray,
) -> tuple[Mesh, np.ndarray]:
    angles = np.arange(ANGLE_COUNT, dtype=np.float64) * (2.0 * math.pi / ANGLE_COUNT)
    cosine = np.cos(angles)
    sine = np.sin(angles)
    rings = np.empty((PLANE_COUNT, ANGLE_COUNT, 3), dtype=np.float64)
    rings[:, :, 0] = centers[:, 0, None] + radii * cosine[None, :]
    rings[:, :, 1] = plane_y[:, None]
    rings[:, :, 2] = centers[:, 1, None] + radii * sine[None, :]

    # Keep the fit centered in the official common frame.  Discrete angular and
    # plane sampling can offset its raw AABB by a fraction of a millimetre.
    source_min, source_max = source_bounds
    source_center_xz = ((source_min + source_max) * 0.5)[[0, 2]]
    ring_min = rings.reshape(-1, 3).min(axis=0)
    ring_max = rings.reshape(-1, 3).max(axis=0)
    ring_center_xz = ((ring_min + ring_max) * 0.5)[[0, 2]]
    xz_shift = source_center_xz - ring_center_xz
    rings[:, :, 0] += xz_shift[0]
    rings[:, :, 2] += xz_shift[1]

    vertices = rings.reshape(-1, 3).tolist()
    lower_cap = len(vertices)
    vertices.append([centers[0, 0] + xz_shift[0], source_min[1], centers[0, 1] + xz_shift[1]])
    upper_cap = len(vertices)
    vertices.append([centers[-1, 0] + xz_shift[0], source_max[1], centers[-1, 1] + xz_shift[1]])
    faces: list[list[int]] = []
    for layer in range(PLANE_COUNT - 1):
        start = layer * ANGLE_COUNT
        following = (layer + 1) * ANGLE_COUNT
        for angle in range(ANGLE_COUNT):
            next_angle = (angle + 1) % ANGLE_COUNT
            faces.append([start + angle, following + angle, following + next_angle])
            faces.append([start + angle, following + next_angle, start + next_angle])
    for angle in range(ANGLE_COUNT):
        next_angle = (angle + 1) % ANGLE_COUNT
        faces.append([lower_cap, next_angle, angle])
        top = (PLANE_COUNT - 1) * ANGLE_COUNT
        faces.append([upper_cap, top + angle, top + next_angle])
    return Mesh(key, np.asarray(vertices), np.asarray(faces)), xz_shift


def _surface_centroid(mesh: Mesh) -> np.ndarray:
    triangles = mesh.vertices[mesh.faces]
    doubled_areas = np.linalg.norm(
        np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]),
        axis=1,
    )
    total = doubled_areas.sum()
    return (triangles.mean(axis=1) * doubled_areas[:, None]).sum(axis=0) / total


def _raster_silhouette(mesh: Mesh, axes: tuple[int, int], bounds: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
    low, high = bounds
    projected_low = low[list(axes)]
    projected_high = high[list(axes)]
    dimensions = projected_high - projected_low
    padding = dimensions * 0.025
    projected_low -= padding
    projected_high += padding
    dimensions = projected_high - projected_low
    projected = mesh.vertices[:, list(axes)]
    pixels = (projected - projected_low) / dimensions * (SILHOUETTE_RESOLUTION - 1)
    # Image Y points down; flipping is immaterial to IoU but makes debug output anatomical.
    pixels[:, 1] = (SILHOUETTE_RESOLUTION - 1) - pixels[:, 1]
    image = Image.new("1", (SILHOUETTE_RESOLUTION, SILHOUETTE_RESOLUTION), 0)
    draw = ImageDraw.Draw(image)
    for face in mesh.faces:
        polygon = [tuple(pixels[int(index)]) for index in face]
        draw.polygon(polygon, fill=1)
    return np.asarray(image, dtype=bool)


def _silhouette_metrics(source: Mesh, reconstruction: Mesh, axes: tuple[int, int]) -> dict:
    source_min = source.vertices.min(axis=0)
    source_max = source.vertices.max(axis=0)
    bounds = (source_min.copy(), source_max.copy())
    source_mask = _raster_silhouette(source, axes, bounds)
    reconstruction_mask = _raster_silhouette(reconstruction, axes, bounds)
    intersection = np.logical_and(source_mask, reconstruction_mask).sum()
    union = np.logical_or(source_mask, reconstruction_mask).sum()
    iou = float(intersection / union) if union else 0.0

    edge_errors: list[float] = []
    for source_row, reconstruction_row in zip(source_mask, reconstruction_mask):
        source_columns = np.flatnonzero(source_row)
        reconstruction_columns = np.flatnonzero(reconstruction_row)
        if len(source_columns) and len(reconstruction_columns):
            edge_errors.extend(
                [
                    abs(int(source_columns[0]) - int(reconstruction_columns[0])),
                    abs(int(source_columns[-1]) - int(reconstruction_columns[-1])),
                ]
            )
        elif len(source_columns) or len(reconstruction_columns):
            edge_errors.extend([SILHOUETTE_RESOLUTION, SILHOUETTE_RESOLUTION])
    error = np.asarray(edge_errors, dtype=np.float64) / SILHOUETTE_RESOLUTION
    return {
        "resolution_px": SILHOUETTE_RESOLUTION,
        "intersection_over_union": _round_scalar(iou),
        "mean_edge_error_fraction": _round_scalar(error.mean() if len(error) else 1.0),
        "p95_edge_error_fraction": _round_scalar(
            np.percentile(error, 95) if len(error) else 1.0
        ),
    }


def _bounds_report(mesh: Mesh) -> dict:
    low = mesh.vertices.min(axis=0)
    high = mesh.vertices.max(axis=0)
    return {
        "min_m": _round_vector(low),
        "max_m": _round_vector(high),
        "dimensions_m": _round_vector(high - low),
        "center_m": _round_vector((low + high) * 0.5),
    }


def _fit_one(fit: LoftFit) -> dict:
    source = combine_meshes(fit.source_meshes, f"{fit.key}_source")
    source_min = source.vertices.min(axis=0)
    source_max = source.vertices.max(axis=0)
    fractions, plane_y, centers, radii = _fit_sections(source)
    reconstruction, xz_shift = _loft_mesh(
        fit.key, (source_min, source_max), plane_y, centers, radii
    )
    centers += xz_shift[None, :]

    source_dimensions = source_max - source_min
    reconstruction_min = reconstruction.vertices.min(axis=0)
    reconstruction_max = reconstruction.vertices.max(axis=0)
    reconstruction_dimensions = reconstruction_max - reconstruction_min
    dimension_error = np.abs(reconstruction_dimensions / source_dimensions - 1.0)
    source_center = (source_min + source_max) * 0.5
    reconstruction_center = (reconstruction_min + reconstruction_max) * 0.5

    sections = []
    for index in range(PLANE_COUNT):
        sections.append(
            {
                "index": index,
                "source_plane_fraction": _round_scalar(fractions[index]),
                "y_m": _round_scalar(plane_y[index]),
                "center_xz_m": _round_vector(centers[index]),
                "radii_m": _round_vector(radii[index]),
            }
        )

    front = _silhouette_metrics(source, reconstruction, (0, 1))
    profile = _silhouette_metrics(source, reconstruction, (2, 1))
    validation = {
        "aabb_dimension_error_fraction_xyz": _round_vector(dimension_error),
        "aabb_max_dimension_error_fraction": _round_scalar(dimension_error.max()),
        "aabb_center_error_m_xyz": _round_vector(reconstruction_center - source_center),
        "front_xy_silhouette": front,
        "profile_zy_silhouette": profile,
    }
    validation["passes_aabb_5_percent"] = bool(dimension_error.max() <= 0.05)

    return {
        "source_mesh_filter": fit.filter_description,
        "source_bounds": _bounds_report(source),
        "source_centroids_m": {
            "aabb": _round_vector(source_center),
            "vertex_mean": _round_vector(source.vertices.mean(axis=0)),
            "surface_area_weighted": _round_vector(_surface_centroid(source)),
        },
        "loft": {
            "lower_cap_y_m": _round_scalar(source_min[1]),
            "upper_cap_y_m": _round_scalar(source_max[1]),
            "sections": sections,
        },
        "reconstruction": {
            "vertex_count": int(len(reconstruction.vertices)),
            "triangle_count": int(len(reconstruction.faces)),
            "bounds": _bounds_report(reconstruction),
        },
        "validation": validation,
    }


def build_document(lung_path: Path, liver_path: Path, organs: Sequence[str]) -> dict:
    lung_meshes = load_meshes(lung_path) if "lungs" in organs else []
    liver_meshes = load_meshes(liver_path) if "liver" in organs else []
    fits: list[LoftFit] = []
    if "lungs" in organs:
        for side in ("left", "right"):
            selected, description = _lung_segments(lung_meshes, side)
            fits.append(LoftFit(f"{side}_lung", lung_path, selected, description))
    if "liver" in organs:
        selected, description = _liver_capsule(liver_meshes)
        fits.append(LoftFit("liver_capsule", liver_path, selected, description))

    source_files = {}
    for fit in fits:
        source_files[_portable_path(fit.source_path)] = {
            "sha256": _sha256(fit.source_path),
            "units": "meter",
        }
    document = {
        "schema_version": SCHEMA_VERSION,
        "generator": "tools/reference-analysis/fit_anatomical_lofts.py",
        "coordinate_frame": {
            "name": "HRA Visible Human Female common frame",
            "units": "meter",
            "x_positive": "anatomical left",
            "y_positive": "superior",
            "z_positive": "anterior",
        },
        "sampling": {
            "anatomical_y_plane_count": PLANE_COUNT,
            "plane_end_inset_fraction": PLANE_END_INSET,
            "polar_angle_count": ANGLE_COUNT,
            "polar_angle_radians": _round_vector(
                np.arange(ANGLE_COUNT) * (2.0 * math.pi / ANGLE_COUNT)
            ),
            "angle_zero": "+X (anatomical left)",
            "angle_direction": "+X toward +Z (anterior)",
            "radius_rule": "outermost positive ray hit across selected surface triangles",
            "section_center_rule": (
                "Deterministic 31x31 even/odd grid search; choose the inside point with "
                "maximum clearance from section segments, falling back to the X-Z AABB center."
            ),
            "silhouette_guards": (
                "The 0, 12, 24, and 36 samples retain each plane's exact +X, +Z, -X, "
                "and -Z extrema; missing non-star-shaped rays are circularly interpolated "
                "and clipped to the plane bounds."
            ),
        },
        "source_files": source_files,
        "official_source": {
            "publisher": "HuBMAP Human Reference Atlas",
            "funder": "National Institutes of Health",
            "license": "CC-BY-4.0",
            "lung_record": "https://doi.org/10.48539/HBM794.PKQV.978",
            "liver_record": "https://doi.org/10.48539/HBM798.JZZM.649",
        },
        "organs": {},
    }
    for fit in fits:
        document["organs"][fit.key] = _fit_one(fit)
    return document


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lung",
        type=Path,
        default=Path("reference-atlas/models/hra/lung-female-v1.3.glb"),
    )
    parser.add_argument(
        "--liver",
        type=Path,
        default=Path("reference-atlas/models/hra/liver-female-v1.1.glb"),
    )
    parser.add_argument(
        "--organs",
        choices=("lungs", "liver", "all"),
        default="all",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reference-atlas/fits/hra-female-lung-liver-lofts.json"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    organs = ("lungs", "liver") if args.organs == "all" else (args.organs,)
    document = build_document(args.lung.resolve(), args.liver.resolve(), organs)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    for key, organ in document["organs"].items():
        validation = organ["validation"]
        print(
            f"{key}: AABB max={validation['aabb_max_dimension_error_fraction']:.4f}, "
            f"front IoU={validation['front_xy_silhouette']['intersection_over_union']:.4f}, "
            f"profile IoU={validation['profile_zy_silhouette']['intersection_over_union']:.4f}"
        )
        if not validation["passes_aabb_5_percent"]:
            raise SystemExit(f"{key} reconstructed AABB exceeds 5% error")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
