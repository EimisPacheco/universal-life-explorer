#!/usr/bin/env python3
"""Fit a compact, front-readable procedural pelvis to the official HRA mesh.

This is deliberately a 2.5-D fit rather than a generic solid loft.  A pelvis is
recognized in frontal view primarily by its iliac wings, pelvic inlet,
acetabula, obturator foramina, sacrum, and pubic arch.  Collapsing all of those
features into one convex loft destroys the openings, so this fitter records
simplified frontal plates with true holes plus atlas-derived depth and landmark
coefficients.

The HRA v1.5 united female GLB is used by default.  Its selected pelvis meshes
are also checked against the smaller standalone HRA pelvis v1.2 GLB; in the
current official files the vertex and face arrays are bit-for-bit identical.
No source triangles are copied into the output JSON.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw

from mesh_analysis import Mesh, combine_meshes, load_meshes


SCHEMA_VERSION = "1.0.0"
RASTER_RESOLUTION = 768
VALIDATION_PANEL_SIZE = 320
CONTOUR_TOLERANCE_M = 0.0010
BONE_SEAM_TOLERANCE_M = 0.0001
JOINT_NEIGHBORHOOD_TOLERANCE_M = 0.002
MIN_HOLE_AREA_M2 = 0.0000015

AXIAL_NAMES = ("VH_F_sacrum", "VH_F_coccyx")
PARTS = ("ilium", "ischium", "pubis")
SIDES = ("left", "right")


def _mesh_name(part: str, side: str) -> str:
    suffix = "L" if side == "left" else "R"
    return f"VH_F_{part}_compact_bone_{suffix}"


def _round_scalar(value: float) -> float:
    return round(float(value), 7)


def _round_vector(values: Sequence[float]) -> list[float]:
    return [_round_scalar(value) for value in values]


def _round_points(points: np.ndarray) -> list[list[float]]:
    return [_round_vector(point) for point in points]


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


def _bounds_report(mesh: Mesh) -> dict:
    low = mesh.vertices.min(axis=0)
    high = mesh.vertices.max(axis=0)
    return {
        "min_m": _round_vector(low),
        "max_m": _round_vector(high),
        "dimensions_m": _round_vector(high - low),
        "center_m": _round_vector((low + high) * 0.5),
    }


def _surface_centroid(mesh: Mesh) -> np.ndarray:
    triangles = mesh.vertices[mesh.faces]
    doubled_areas = np.linalg.norm(
        np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]),
        axis=1,
    )
    total = float(doubled_areas.sum())
    return (triangles.mean(axis=1) * doubled_areas[:, None]).sum(axis=0) / total


def _projection_bounds(meshes: Iterable[Mesh]) -> tuple[np.ndarray, np.ndarray]:
    combined = combine_meshes(list(meshes), "pelvis_projection_bounds")
    low = combined.vertices[:, :2].min(axis=0)
    high = combined.vertices[:, :2].max(axis=0)
    padding = (high - low) * 0.035
    return low - padding, high + padding


def _world_to_pixels(
    xy: np.ndarray,
    bounds: tuple[np.ndarray, np.ndarray],
    resolution: int,
) -> np.ndarray:
    low, high = bounds
    pixels = (xy - low) / (high - low) * (resolution - 1)
    pixels[:, 1] = (resolution - 1) - pixels[:, 1]
    return pixels


def _pixels_to_world(
    pixels: np.ndarray,
    bounds: tuple[np.ndarray, np.ndarray],
    resolution: int,
) -> np.ndarray:
    low, high = bounds
    result = pixels.astype(np.float64).copy()
    result[:, 1] = (resolution - 1) - result[:, 1]
    result = low + result / (resolution - 1) * (high - low)
    return result


def _raster_mask(
    meshes: Iterable[Mesh],
    bounds: tuple[np.ndarray, np.ndarray],
    resolution: int,
) -> np.ndarray:
    image = Image.new("1", (resolution, resolution), 0)
    draw = ImageDraw.Draw(image)
    for mesh in meshes:
        pixels = _world_to_pixels(mesh.vertices[:, :2], bounds, resolution)
        for face in mesh.faces:
            draw.polygon([tuple(pixels[int(index)]) for index in face], fill=1)
    return np.asarray(image, dtype=bool)


def _shift(mask: np.ndarray, row: int, column: int) -> np.ndarray:
    result = np.zeros_like(mask)
    source_rows = slice(max(0, -row), min(mask.shape[0], mask.shape[0] - row))
    source_columns = slice(max(0, -column), min(mask.shape[1], mask.shape[1] - column))
    target_rows = slice(max(0, row), min(mask.shape[0], mask.shape[0] + row))
    target_columns = slice(max(0, column), min(mask.shape[1], mask.shape[1] + column))
    result[target_rows, target_columns] = mask[source_rows, source_columns]
    return result


def _close_one_pixel(mask: np.ndarray) -> np.ndarray:
    neighborhood = tuple((row, column) for row in (-1, 0, 1) for column in (-1, 0, 1))
    dilated = np.zeros_like(mask)
    for row, column in neighborhood:
        dilated |= _shift(mask, row, column)
    eroded = np.ones_like(mask)
    for row, column in neighborhood:
        eroded &= _shift(dilated, row, column)
    return eroded


def _boundary_loops(mask: np.ndarray) -> list[np.ndarray]:
    """Return oriented closed pixel-corner loops around a 1-bit mask."""

    above = _shift(mask, 1, 0)
    below = _shift(mask, -1, 0)
    left = _shift(mask, 0, 1)
    right = _shift(mask, 0, -1)
    edges: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    for row, column in np.argwhere(mask & ~above):
        edges.add(((int(column), int(row)), (int(column + 1), int(row))))
    for row, column in np.argwhere(mask & ~right):
        edges.add(((int(column + 1), int(row)), (int(column + 1), int(row + 1))))
    for row, column in np.argwhere(mask & ~below):
        edges.add(((int(column + 1), int(row + 1)), (int(column), int(row + 1))))
    for row, column in np.argwhere(mask & ~left):
        edges.add(((int(column), int(row + 1)), (int(column), int(row))))

    outgoing: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for start, end in edges:
        outgoing[start].append(end)
    for ends in outgoing.values():
        ends.sort()

    direction_index = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}
    turn_priority = {1: 0, 0: 1, 3: 2, 2: 3}
    unused = set(edges)
    loops: list[np.ndarray] = []
    while unused:
        first = min(unused)
        start, current = first
        unused.remove(first)
        points = [start, current]
        previous = start
        while current != start:
            candidates = [end for end in outgoing.get(current, ()) if (current, end) in unused]
            if not candidates:
                points = []
                break
            incoming = (current[0] - previous[0], current[1] - previous[1])
            incoming_index = direction_index[incoming]

            def candidate_key(end: tuple[int, int]) -> tuple[int, tuple[int, int]]:
                outgoing_direction = (end[0] - current[0], end[1] - current[1])
                turn = (direction_index[outgoing_direction] - incoming_index) % 4
                return turn_priority[turn], end

            following = min(candidates, key=candidate_key)
            unused.remove((current, following))
            previous, current = current, following
            points.append(current)
            if len(points) > len(edges) + 2:
                points = []
                break
        if len(points) >= 5:
            loops.append(np.asarray(points[:-1], dtype=np.float64))
    return loops


def _polygon_area(points: np.ndarray) -> float:
    following = np.roll(points, -1, axis=0)
    return 0.5 * float(np.sum(points[:, 0] * following[:, 1] - following[:, 0] * points[:, 1]))


def _polygon_centroid(points: np.ndarray) -> np.ndarray:
    following = np.roll(points, -1, axis=0)
    cross = points[:, 0] * following[:, 1] - following[:, 0] * points[:, 1]
    area_six = 3.0 * float(cross.sum())
    if abs(area_six) < 1e-14:
        return points.mean(axis=0)
    return np.asarray(
        [
            np.sum((points[:, 0] + following[:, 0]) * cross) / area_six,
            np.sum((points[:, 1] + following[:, 1]) * cross) / area_six,
        ]
    )


def _rdp(points: np.ndarray, tolerance: float) -> np.ndarray:
    if len(points) <= 2:
        return points
    start = points[0]
    end = points[-1]
    segment = end - start
    length_squared = float(segment @ segment)
    if length_squared <= 1e-20:
        distances = np.linalg.norm(points - start, axis=1)
    else:
        amounts = np.clip(((points - start) @ segment) / length_squared, 0.0, 1.0)
        closest = start + amounts[:, None] * segment
        distances = np.linalg.norm(points - closest, axis=1)
    index = int(np.argmax(distances))
    if distances[index] <= tolerance:
        return points[[0, -1]]
    left = _rdp(points[: index + 1], tolerance)
    right = _rdp(points[index:], tolerance)
    return np.vstack((left[:-1], right))


def _simplify_closed(points: np.ndarray, tolerance: float) -> np.ndarray:
    if len(points) < 8:
        return points
    first = int(np.argmin(points[:, 0]))
    second = int(np.argmax(points[:, 0]))
    if first == second:
        first = int(np.argmin(points[:, 1]))
        second = int(np.argmax(points[:, 1]))
    if first > second:
        first, second = second, first
    chain_a = points[first : second + 1]
    chain_b = np.vstack((points[second:], points[: first + 1]))
    simplified_a = _rdp(chain_a, tolerance)
    simplified_b = _rdp(chain_b, tolerance)
    result = np.vstack((simplified_a[:-1], simplified_b[:-1]))
    return result if len(result) >= 4 else points


def _contour_model(
    meshes: list[Mesh],
    bounds: tuple[np.ndarray, np.ndarray],
    resolution: int,
) -> tuple[dict, np.ndarray, np.ndarray]:
    source_mask = _raster_mask(meshes, bounds, resolution)
    extraction_mask = _close_one_pixel(source_mask)
    loops_px = _boundary_loops(extraction_mask)
    loops = [_pixels_to_world(loop, bounds, resolution) for loop in loops_px]
    loops = [loop for loop in loops if abs(_polygon_area(loop)) >= MIN_HOLE_AREA_M2]
    if not loops:
        raise ValueError("no frontal contour survived pelvis mask extraction")
    loops.sort(key=lambda loop: abs(_polygon_area(loop)), reverse=True)
    outer = _simplify_closed(loops[0], CONTOUR_TOLERANCE_M)
    outer_sign = math.copysign(1.0, _polygon_area(loops[0]))
    holes: list[np.ndarray] = []
    for loop in loops[1:]:
        if math.copysign(1.0, _polygon_area(loop)) == outer_sign:
            continue
        holes.append(_simplify_closed(loop, CONTOUR_TOLERANCE_M * 0.8))
    holes.sort(key=lambda loop: abs(_polygon_area(loop)), reverse=True)

    reconstruction = Image.new("1", (resolution, resolution), 0)
    draw = ImageDraw.Draw(reconstruction)
    outer_px = _world_to_pixels(outer, bounds, resolution)
    draw.polygon([tuple(point) for point in outer_px], fill=1)
    for hole in holes:
        hole_px = _world_to_pixels(hole, bounds, resolution)
        draw.polygon([tuple(point) for point in hole_px], fill=0)
    reconstruction_mask = np.asarray(reconstruction, dtype=bool)
    model = {
        "outer_contour_xy_m": _round_points(outer),
        "outer_contour_point_count": int(len(outer)),
        "holes_xy_m": [_round_points(hole) for hole in holes],
        "hole_point_counts": [int(len(hole)) for hole in holes],
    }
    return model, source_mask, reconstruction_mask


def _silhouette_metrics(source: np.ndarray, reconstruction: np.ndarray) -> dict:
    intersection = int(np.logical_and(source, reconstruction).sum())
    union = int(np.logical_or(source, reconstruction).sum())
    source_count = int(source.sum())
    reconstruction_count = int(reconstruction.sum())
    iou = intersection / union if union else 0.0
    dice = 2.0 * intersection / (source_count + reconstruction_count) if source_count + reconstruction_count else 0.0
    return {
        "resolution_px": int(source.shape[0]),
        "intersection_over_union": _round_scalar(iou),
        "dice_coefficient": _round_scalar(dice),
        "source_only_fraction": _round_scalar((source_count - intersection) / source_count if source_count else 0.0),
        "reconstruction_only_fraction": _round_scalar(
            (reconstruction_count - intersection) / reconstruction_count if reconstruction_count else 0.0
        ),
    }


def _depth_profile(mesh: Mesh, count: int = 9) -> list[dict]:
    low = mesh.vertices[:, 1].min()
    high = mesh.vertices[:, 1].max()
    edges = np.linspace(low, high, count + 1)
    result: list[dict] = []
    for index in range(count):
        inclusive = index == count - 1
        selected = mesh.vertices[
            (mesh.vertices[:, 1] >= edges[index])
            & ((mesh.vertices[:, 1] <= edges[index + 1]) if inclusive else (mesh.vertices[:, 1] < edges[index + 1]))
        ]
        if not len(selected):
            continue
        result.append(
            {
                "y_fraction": _round_scalar((index + 0.5) / count),
                "y_center_m": _round_scalar((edges[index] + edges[index + 1]) * 0.5),
                "posterior_z_m": _round_scalar(selected[:, 2].min()),
                "anterior_z_m": _round_scalar(selected[:, 2].max()),
                "median_z_m": _round_scalar(np.median(selected[:, 2])),
            }
        )
    return result


def _nearest_squared(source: np.ndarray, target: np.ndarray, chunk: int = 300) -> np.ndarray:
    result = np.empty(len(source), dtype=np.float64)
    for start in range(0, len(source), chunk):
        distances = (
            (source[start : start + chunk, None, :] - target[None, :, :]) ** 2
        ).sum(axis=2)
        result[start : start + chunk] = distances.min(axis=1)
    return result


def _nearest_points(
    source: np.ndarray, target: np.ndarray, chunk: int = 300
) -> tuple[np.ndarray, np.ndarray]:
    distances_out = np.empty(len(source), dtype=np.float64)
    indices_out = np.empty(len(source), dtype=np.int64)
    for start in range(0, len(source), chunk):
        distances = (
            (source[start : start + chunk, None, :] - target[None, :, :]) ** 2
        ).sum(axis=2)
        indices = distances.argmin(axis=1)
        indices_out[start : start + chunk] = indices
        distances_out[start : start + chunk] = distances[np.arange(len(indices)), indices]
    return distances_out, indices_out


def _acetabulum(parts: list[Mesh]) -> dict:
    tolerance_squared = BONE_SEAM_TOLERANCE_M**2
    shared: list[np.ndarray] = []
    for index, mesh in enumerate(parts):
        others = [candidate.vertices for other, candidate in enumerate(parts) if other != index]
        near_both = np.ones(len(mesh.vertices), dtype=bool)
        for other in others:
            near_both &= _nearest_squared(mesh.vertices, other) <= tolerance_squared
        shared.extend(mesh.vertices[near_both])
    if not shared:
        raise ValueError("could not find the three-bone acetabular junction")
    shared_points = np.asarray(shared)
    center = shared_points.mean(axis=0)

    seam_points: list[np.ndarray] = []
    for first, second in ((0, 1), (0, 2), (1, 2)):
        distances, indices = _nearest_points(parts[first].vertices, parts[second].vertices)
        selected = distances <= tolerance_squared
        seam_points.extend(
            (parts[first].vertices[selected] + parts[second].vertices[indices[selected]]) * 0.5
        )
    seams = np.asarray(seam_points)
    relative_xy = seams[:, :2] - center[:2]
    distance_xy = np.linalg.norm(relative_xy, axis=1)
    local = relative_xy[distance_xy <= 0.026]
    if len(local) < 16:
        raise ValueError("too few local acetabular seam samples")
    radius_xy = np.quantile(np.abs(local), 0.95, axis=0)
    local_vertices = np.concatenate([part.vertices for part in parts])
    local_vertices = local_vertices[
        np.linalg.norm(local_vertices[:, :2] - center[:2], axis=1) <= max(radius_xy) * 1.35
    ]
    return {
        "derivation": (
            "Center is the mean surface point within 0.1 mm of ilium, ischium, and pubis. "
            "Rim radii are the 95th-percentile absolute XY offsets of local pairwise bone seams."
        ),
        "triradiate_center_m": _round_vector(center),
        "rim_radius_xy_m": _round_vector(radius_xy),
        "suggested_front_overlay_z_m": _round_scalar(np.quantile(local_vertices[:, 2], 0.90)),
        "shared_junction_sample_count": int(len(shared_points)),
        "pairwise_seam_sample_count": int(len(seams)),
    }


def _iliac_crest(ilium: Mesh, side: str, count: int = 11) -> dict:
    low = ilium.vertices[:, 0].min()
    high = ilium.vertices[:, 0].max()
    edges = np.linspace(low, high, count + 1)
    points: list[np.ndarray] = []
    for index in range(count):
        selected = ilium.vertices[
            (ilium.vertices[:, 0] >= edges[index])
            & (
                (ilium.vertices[:, 0] <= edges[index + 1])
                if index == count - 1
                else (ilium.vertices[:, 0] < edges[index + 1])
            )
        ]
        if not len(selected):
            continue
        maximum_y = selected[:, 1].max()
        crown = selected[selected[:, 1] >= maximum_y - 0.0010]
        points.append(np.asarray([crown[:, 0].mean(), maximum_y, crown[:, 2].mean()]))
    path = np.asarray(points)
    lateral_index = int(np.argmax(path[:, 0]) if side == "left" else np.argmin(path[:, 0]))
    return {
        "superior_envelope_xyz_m": _round_points(path),
        "anterior_superior_iliac_spine_proxy_m": _round_vector(path[lateral_index]),
        "derivation": "Eleven-bin superior envelope of the official compact ilium surface.",
    }


def _foramen_landmark(contour: list[list[float]]) -> dict:
    points = np.asarray(contour, dtype=np.float64)
    low = points.min(axis=0)
    high = points.max(axis=0)
    return {
        "center_xy_m": _round_vector(_polygon_centroid(points)),
        "bounds_xy_m": {"min": _round_vector(low), "max": _round_vector(high)},
        "dimensions_xy_m": _round_vector(high - low),
        "area_m2": _round_scalar(abs(_polygon_area(points))),
        "contour_xy_m": contour,
    }


def _contact_landmark(first: Mesh, second: Mesh) -> dict:
    distances, indices = _nearest_points(first.vertices, second.vertices)
    selected = distances <= JOINT_NEIGHBORHOOD_TOLERANCE_M**2
    points = (first.vertices[selected] + second.vertices[indices[selected]]) * 0.5
    if not len(points):
        nearest = int(np.argmin(distances))
        points = np.asarray([(first.vertices[nearest] + second.vertices[indices[nearest]]) * 0.5])
    return {
        "center_m": _round_vector(points.mean(axis=0)),
        "bounds": {
            "min_m": _round_vector(points.min(axis=0)),
            "max_m": _round_vector(points.max(axis=0)),
        },
        "contact_sample_count": int(len(points)),
        "contact_tolerance_m": JOINT_NEIGHBORHOOD_TOLERANCE_M,
    }


def _source_selection(meshes: list[Mesh]) -> dict[str, Mesh]:
    by_name = {mesh.name: mesh for mesh in meshes}
    required = list(AXIAL_NAMES) + [_mesh_name(part, side) for side in SIDES for part in PARTS]
    missing = [name for name in required if name not in by_name]
    if missing:
        raise ValueError(f"source is missing pelvis meshes: {', '.join(missing)}")
    return {name: by_name[name] for name in required}


def _identity_check(primary: dict[str, Mesh], standalone_path: Path | None) -> dict:
    if standalone_path is None or not standalone_path.exists():
        return {"performed": False, "reason": "standalone comparison file unavailable"}
    comparison = _source_selection(load_meshes(standalone_path))
    meshes = {}
    all_identical = True
    for name, source in primary.items():
        other = comparison[name]
        vertices_identical = bool(np.array_equal(source.vertices, other.vertices))
        faces_identical = bool(np.array_equal(source.faces, other.faces))
        all_identical &= vertices_identical and faces_identical
        meshes[name] = {
            "vertices_identical": vertices_identical,
            "faces_identical": faces_identical,
        }
    return {
        "performed": True,
        "comparison_path": _portable_path(standalone_path),
        "comparison_sha256": _sha256(standalone_path),
        "all_selected_mesh_arrays_identical": bool(all_identical),
        "meshes": meshes,
    }


def _resize_mask(mask: np.ndarray, size: int) -> np.ndarray:
    image = Image.fromarray(mask.astype(np.uint8) * 255)
    image = image.resize((size, size), resample=Image.Resampling.NEAREST)
    return np.asarray(image) > 0


def _validation_panel(source: np.ndarray, reconstruction: np.ndarray, label: str) -> Image.Image:
    source = _resize_mask(source, VALIDATION_PANEL_SIZE)
    reconstruction = _resize_mask(reconstruction, VALIDATION_PANEL_SIZE)
    rgb = np.zeros((VALIDATION_PANEL_SIZE, VALIDATION_PANEL_SIZE, 3), dtype=np.uint8)
    overlap = source & reconstruction
    rgb[overlap] = (238, 238, 238)
    rgb[source & ~reconstruction] = (235, 67, 67)
    rgb[reconstruction & ~source] = (57, 118, 235)
    image = Image.fromarray(rgb)
    ImageDraw.Draw(image).text((8, 8), label, fill=(255, 230, 120))
    return image


def build_document(
    source_path: Path,
    standalone_path: Path | None,
    validation_path: Path,
) -> dict:
    source_meshes = load_meshes(source_path)
    selected = _source_selection(source_meshes)
    selected_list = list(selected.values())
    bounds = _projection_bounds(selected_list)
    full_mesh = combine_meshes(selected_list, "pelvis_compact_and_axial")

    model_masks: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    hip_models: dict[str, dict] = {}
    for side in SIDES:
        parts = [selected[_mesh_name(part, side)] for part in PARTS]
        combined = combine_meshes(parts, f"{side}_hip_bone")
        front, source_mask, reconstruction_mask = _contour_model(parts, bounds, RASTER_RESOLUTION)
        ilium_front, _, _ = _contour_model([parts[0]], bounds, RASTER_RESOLUTION)
        holes = front.pop("holes_xy_m")
        hole_counts = front.pop("hole_point_counts")
        if not holes:
            raise ValueError(f"{side} hip projection did not preserve the obturator foramen")
        obturator = _foramen_landmark(holes[0])
        front["holes"] = [
            {
                "name": "obturator_foramen",
                "point_count": hole_counts[0],
                "contour_xy_m": holes[0],
            }
        ]
        model_masks[f"{side}_hip_bone"] = (source_mask, reconstruction_mask)
        hip_models[side] = {
            "laterality": side,
            "source_mesh_names": [part.name for part in parts],
            "source_bounds": _bounds_report(combined),
            "source_surface_centroid_m": _round_vector(_surface_centroid(combined)),
            "frontal_plate": front,
            "depth_profile_by_superior_fraction": _depth_profile(combined),
            "landmarks": {
                "iliac_wing": {
                    "source_bounds": _bounds_report(parts[0]),
                    "source_surface_centroid_m": _round_vector(_surface_centroid(parts[0])),
                    "frontal_outer_contour_xy_m": ilium_front["outer_contour_xy_m"],
                    "frontal_contour_point_count": ilium_front["outer_contour_point_count"],
                },
                "iliac_crest": _iliac_crest(parts[0], side),
                "acetabulum": _acetabulum(parts),
                "obturator_foramen": obturator,
            },
            "validation": _silhouette_metrics(source_mask, reconstruction_mask),
        }

    axial_models: dict[str, dict] = {}
    for key, name in (("sacrum", "VH_F_sacrum"), ("coccyx", "VH_F_coccyx")):
        mesh = selected[name]
        front, source_mask, reconstruction_mask = _contour_model([mesh], bounds, RASTER_RESOLUTION)
        holes = front.pop("holes_xy_m")
        hole_counts = front.pop("hole_point_counts")
        front["holes"] = [
            {
                "name": f"projected_{key}_opening_{index + 1}",
                "point_count": hole_counts[index],
                "contour_xy_m": contour,
            }
            for index, contour in enumerate(holes)
        ]
        model_masks[key] = (source_mask, reconstruction_mask)
        axial_models[key] = {
            "source_mesh_name": name,
            "source_bounds": _bounds_report(mesh),
            "source_surface_centroid_m": _round_vector(_surface_centroid(mesh)),
            "frontal_plate": front,
            "depth_profile_by_superior_fraction": _depth_profile(mesh, 7),
            "validation": _silhouette_metrics(source_mask, reconstruction_mask),
        }

    full_source = _raster_mask(selected_list, bounds, RASTER_RESOLUTION)
    full_reconstruction = np.zeros_like(full_source)
    for source_mask, reconstruction_mask in model_masks.values():
        full_reconstruction |= reconstruction_mask

    sacrum = selected["VH_F_sacrum"]
    pubis_left = selected[_mesh_name("pubis", "left")]
    pubis_right = selected[_mesh_name("pubis", "right")]
    landmarks = {
        "midsagittal_x_m": _round_scalar(
            (
                hip_models["left"]["landmarks"]["acetabulum"]["triradiate_center_m"][0]
                + hip_models["right"]["landmarks"]["acetabulum"]["triradiate_center_m"][0]
            )
            * 0.5
        ),
        "left_sacroiliac_joint": _contact_landmark(sacrum, selected[_mesh_name("ilium", "left")]),
        "right_sacroiliac_joint": _contact_landmark(sacrum, selected[_mesh_name("ilium", "right")]),
        "pubic_symphysis": _contact_landmark(pubis_left, pubis_right),
    }

    panels = []
    for label in ("left_hip_bone", "right_hip_bone", "sacrum", "coccyx"):
        panels.append(_validation_panel(*model_masks[label], label))
    panels.append(_validation_panel(full_source, full_reconstruction, "complete_pelvis"))
    validation_image = Image.new(
        "RGB", (VALIDATION_PANEL_SIZE * len(panels), VALIDATION_PANEL_SIZE), "black"
    )
    for index, panel in enumerate(panels):
        validation_image.paste(panel, (index * VALIDATION_PANEL_SIZE, 0))
    validation_path.parent.mkdir(parents=True, exist_ok=True)
    validation_image.save(validation_path)

    low = full_mesh.vertices.min(axis=0)
    high = full_mesh.vertices.max(axis=0)
    return {
        "schema_version": SCHEMA_VERSION,
        "generator": "tools/reference-analysis/fit_pelvis_front.py",
        "coordinate_frame": {
            "name": "HRA Visible Human Female common frame",
            "units": "meter",
            "x_positive": "anatomical left",
            "y_positive": "superior",
            "z_positive": "anterior",
            "view": "front projection from +Z toward -Z",
            "screen_laterality": "patient left (+X) appears on image right in a conventional anterior view",
        },
        "official_source": {
            "publisher": "HuBMAP Human Reference Atlas",
            "funder": "National Institutes of Health",
            "license": "CC-BY-4.0",
            "primary_record": "https://doi.org/10.48539/HBM352.BTSQ.586",
            "standalone_pelvis_record": "https://doi.org/10.48539/HBM427.CCRP.887",
        },
        "source_file": {
            "path": _portable_path(source_path),
            "sha256": _sha256(source_path),
            "selected_mesh_names": list(selected),
            "selection_rule": "compact ilium/ischium/pubis for both sides plus sacrum and coccyx; nested spongy meshes excluded",
            "standalone_coordinate_identity_check": _identity_check(selected, standalone_path),
        },
        "source_bounds": _bounds_report(full_mesh),
        "normalization": {
            "xy_min_m": _round_vector(low[:2]),
            "xy_dimensions_m": _round_vector((high - low)[:2]),
            "formula": "u=(x-min_x)/width; v=(y-min_y)/height; preserve z separately",
        },
        "fit": {
            "kind": "frontal contour plates with true holes and sampled depth profiles",
            "raster_resolution_px": RASTER_RESOLUTION,
            "contour_simplification_tolerance_m": CONTOUR_TOLERANCE_M,
            "minimum_preserved_hole_area_m2": MIN_HOLE_AREA_M2,
            "hip_bones": hip_models,
            "axial_bones": axial_models,
            "shared_landmarks": landmarks,
        },
        "validation": {
            "complete_front_silhouette": _silhouette_metrics(full_source, full_reconstruction),
            "image": _portable_path(validation_path),
            "image_legend": "white overlap; red official source only; blue procedural reconstruction only",
            "gate": {
                "minimum_iou": 0.95,
                "passes": bool(
                    _silhouette_metrics(full_source, full_reconstruction)["intersection_over_union"] >= 0.95
                ),
            },
        },
        "integration_recipe": {
            "priority_order": [
                "Create each hip as a THREE.Shape from outer_contour_xy_m.",
                "Add obturator_foramen as a THREE.Path hole before ExtrudeGeometry.",
                "Extrude shallowly and bend/offset Z using depth_profile_by_superior_fraction; do not extrude through the full atlas depth.",
                "Add acetabular rims as elliptical torus or beveled rings at the fitted centers and radii.",
                "Create sacrum and coccyx as separate tapered plates so their midline silhouette remains visible.",
                "Place patient-left geometry at +X; do not mirror the already bilateral coefficient set.",
            ],
            "recommended_visual_depth": (
                "Use approximately 12-18 mm plate depth for the hip surfaces and 16-24 mm for the sacrum, "
                "then apply the sampled median-Z profile. Full source AABB depth is anatomical curvature, not slab thickness."
            ),
            "occlusion_note": (
                "Render pelvic bone behind bowel/bladder but keep acetabular rims and iliac crests visible. "
                "Avoid torus-only obturator rings: the fitted outer plates and actual holes carry the recognizable anatomy."
            ),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("reference-atlas/models/hra/united-female-v1.5.glb"),
        help="Official HRA female GLB containing the pelvis meshes.",
    )
    parser.add_argument(
        "--standalone-verification",
        type=Path,
        default=Path("reference-atlas/models/hra/pelvis-female-v1.2.glb"),
        help="Optional smaller official pelvis GLB used for array-identity verification.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reference-atlas/fits/hra-female-pelvis-front.json"),
    )
    parser.add_argument(
        "--validation-image",
        type=Path,
        default=Path("reference-atlas/fits/pelvis-silhouette-validation.png"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    standalone = args.standalone_verification.resolve() if args.standalone_verification else None
    validation = args.validation_image.resolve()
    document = build_document(source, standalone, validation)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    for side in SIDES:
        score = document["fit"]["hip_bones"][side]["validation"]["intersection_over_union"]
        print(f"{side}_hip_bone: front IoU={score:.4f}")
    score = document["validation"]["complete_front_silhouette"]["intersection_over_union"]
    print(f"complete_pelvis: front IoU={score:.4f}")
    if not document["validation"]["gate"]["passes"]:
        raise SystemExit("complete pelvis silhouette did not pass the 95% IoU gate")
    print(args.output)
    print(args.validation_image)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
