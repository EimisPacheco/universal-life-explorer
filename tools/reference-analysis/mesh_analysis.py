#!/usr/bin/env python3
"""Dependency-light geometry measurements for anatomical reference meshes.

The implementation deliberately depends only on NumPy.  It handles the common,
uncompressed forms of OBJ, STL, and binary glTF (GLB) used by public anatomy
atlases, and produces deterministic measurements suitable for regression tests
and procedural-model fitting.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import struct
from collections import defaultdict, deque
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np


SCHEMA_VERSION = "1.0.0"


class MeshFormatError(ValueError):
    """Raised when a mesh is malformed or uses an unsupported encoding."""


@dataclass
class Mesh:
    """A single logical triangle mesh in source/world coordinates."""

    name: str
    vertices: np.ndarray
    faces: np.ndarray

    def __post_init__(self) -> None:
        self.vertices = np.asarray(self.vertices, dtype=np.float64)
        self.faces = np.asarray(self.faces, dtype=np.int64)
        if self.vertices.ndim != 2 or self.vertices.shape[1] != 3:
            raise MeshFormatError("vertices must have shape (N, 3)")
        if self.faces.ndim != 2 or self.faces.shape[1] != 3:
            raise MeshFormatError("faces must have shape (M, 3)")
        if len(self.vertices) == 0 or len(self.faces) == 0:
            raise MeshFormatError("mesh must contain vertices and triangle faces")
        if self.faces.min() < 0 or self.faces.max() >= len(self.vertices):
            raise MeshFormatError("face index is outside the vertex array")
        if not np.isfinite(self.vertices).all():
            raise MeshFormatError("mesh contains NaN or infinite coordinates")


@dataclass(frozen=True)
class SamplingOptions:
    silhouette_resolution: int = 48
    cross_section_resolution: int = 32
    slice_fractions: tuple[float, ...] = (0.10, 0.25, 0.50, 0.75, 0.90)
    max_boundary_samples: int = 96

    def __post_init__(self) -> None:
        if not 16 <= self.silhouette_resolution <= 256:
            raise ValueError("silhouette_resolution must be between 16 and 256")
        if not 16 <= self.cross_section_resolution <= 256:
            raise ValueError("cross_section_resolution must be between 16 and 256")
        if not self.slice_fractions or any(not 0.0 < x < 1.0 for x in self.slice_fractions):
            raise ValueError("slice fractions must lie strictly between 0 and 1")
        if self.max_boundary_samples < 8:
            raise ValueError("max_boundary_samples must be at least 8")


def _safe_name(value: str, fallback: str = "mesh") -> str:
    value = re.sub(r"\s+", " ", value.strip())
    return value or fallback


def _localize_mesh(name: str, vertices: np.ndarray, faces: Sequence[Sequence[int]]) -> Mesh:
    face_array = np.asarray(faces, dtype=np.int64)
    used = np.unique(face_array.reshape(-1))
    remap = np.full(len(vertices), -1, dtype=np.int64)
    remap[used] = np.arange(len(used), dtype=np.int64)
    return Mesh(name, vertices[used], remap[face_array])


def load_obj(path: Path) -> list[Mesh]:
    """Load triangle or polygon OBJ geometry, split by ``o`` records."""

    vertices: list[list[float]] = []
    object_faces: dict[str, list[list[int]]] = defaultdict(list)
    object_name = "default"
    group_name = "default"

    # Joining line continuations also makes hand-authored OBJ fixtures friendlier.
    text = path.read_text(encoding="utf-8", errors="replace").replace("\\\n", "")
    for line_number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        tag = fields[0]
        if tag == "v":
            if len(fields) < 4:
                raise MeshFormatError(f"{path}:{line_number}: incomplete vertex")
            vertices.append([float(fields[1]), float(fields[2]), float(fields[3])])
        elif tag == "o":
            object_name = _safe_name(" ".join(fields[1:]), "unnamed_object")
        elif tag == "g":
            group_name = _safe_name(" ".join(fields[1:]), "unnamed_group")
        elif tag == "f":
            if len(fields) < 4:
                raise MeshFormatError(f"{path}:{line_number}: face needs at least 3 vertices")
            polygon: list[int] = []
            for token in fields[1:]:
                raw_index = token.split("/", 1)[0]
                if not raw_index:
                    raise MeshFormatError(f"{path}:{line_number}: missing position index")
                index = int(raw_index)
                index = len(vertices) + index if index < 0 else index - 1
                if not 0 <= index < len(vertices):
                    raise MeshFormatError(f"{path}:{line_number}: invalid position index")
                polygon.append(index)
            target = object_name if object_name != "default" else group_name
            for i in range(1, len(polygon) - 1):
                object_faces[target].append([polygon[0], polygon[i], polygon[i + 1]])

    if not vertices or not object_faces:
        raise MeshFormatError(f"{path}: no mesh geometry found")
    vertex_array = np.asarray(vertices, dtype=np.float64)
    return [_localize_mesh(name, vertex_array, faces) for name, faces in object_faces.items() if faces]


def _looks_like_binary_stl(data: bytes) -> bool:
    if len(data) < 84:
        return False
    triangle_count = struct.unpack_from("<I", data, 80)[0]
    return 84 + triangle_count * 50 == len(data)


def load_stl(path: Path) -> list[Mesh]:
    """Load binary or ASCII STL. Duplicate facet vertices are welded later."""

    data = path.read_bytes()
    vertices: list[tuple[float, float, float]] = []
    faces: list[list[int]] = []
    if _looks_like_binary_stl(data):
        count = struct.unpack_from("<I", data, 80)[0]
        offset = 84
        for _ in range(count):
            values = struct.unpack_from("<12fH", data, offset)
            offset += 50
            start = len(vertices)
            vertices.extend((values[3:6], values[6:9], values[9:12]))
            faces.append([start, start + 1, start + 2])
    else:
        text = data.decode("utf-8", errors="replace")
        matches = re.findall(
            r"\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)", text
        )
        if len(matches) < 3 or len(matches) % 3:
            raise MeshFormatError(f"{path}: malformed or unsupported STL")
        vertices = [tuple(map(float, row)) for row in matches]
        faces = [[i, i + 1, i + 2] for i in range(0, len(vertices), 3)]
    return [Mesh(path.stem, np.asarray(vertices), np.asarray(faces))]


_GLTF_COMPONENTS: dict[int, tuple[np.dtype, int]] = {
    5120: (np.dtype("i1"), 1),
    5121: (np.dtype("u1"), 1),
    5122: (np.dtype("<i2"), 2),
    5123: (np.dtype("<u2"), 2),
    5125: (np.dtype("<u4"), 4),
    5126: (np.dtype("<f4"), 4),
}
_GLTF_TYPE_SIZE = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}


def _read_glb(path: Path) -> tuple[dict[str, Any], list[bytes]]:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise MeshFormatError(f"{path}: not a binary glTF file")
    version, declared_length = struct.unpack_from("<II", data, 4)
    if version != 2:
        raise MeshFormatError(f"{path}: only glTF 2.x is supported")
    if declared_length != len(data):
        raise MeshFormatError(f"{path}: GLB length field does not match file size")
    offset = 12
    json_chunk: bytes | None = None
    binary_chunks: list[bytes] = []
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        payload = data[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == 0x4E4F534A:
            json_chunk = payload
        elif chunk_type == 0x004E4942:
            binary_chunks.append(payload)
    if json_chunk is None:
        raise MeshFormatError(f"{path}: GLB has no JSON chunk")
    document = json.loads(json_chunk.decode("utf-8").rstrip(" \t\r\n\0"))
    unsupported = {"KHR_draco_mesh_compression", "EXT_meshopt_compression"}.intersection(
        document.get("extensionsUsed", [])
    )
    if unsupported:
        names = ", ".join(sorted(unsupported))
        raise MeshFormatError(f"{path}: compressed geometry extension(s) not supported: {names}")

    buffers: list[bytes] = []
    bin_index = 0
    for item in document.get("buffers", []):
        uri = item.get("uri")
        if uri:
            if uri.startswith("data:"):
                try:
                    buffers.append(base64.b64decode(uri.split(",", 1)[1]))
                except (ValueError, IndexError) as exc:
                    raise MeshFormatError(f"{path}: malformed data URI buffer") from exc
            else:
                referenced = (path.parent / uri).resolve()
                buffers.append(referenced.read_bytes())
        else:
            if bin_index >= len(binary_chunks):
                raise MeshFormatError(f"{path}: missing binary buffer chunk")
            buffers.append(binary_chunks[bin_index])
            bin_index += 1
    return document, buffers


def _glb_accessor(document: dict[str, Any], buffers: list[bytes], index: int) -> np.ndarray:
    accessor = document["accessors"][index]
    if "sparse" in accessor:
        raise MeshFormatError("sparse glTF accessors are not currently supported")
    if "bufferView" not in accessor:
        raise MeshFormatError("accessor without a bufferView is not supported")
    try:
        dtype, component_bytes = _GLTF_COMPONENTS[accessor["componentType"]]
        components = _GLTF_TYPE_SIZE[accessor["type"]]
    except KeyError as exc:
        raise MeshFormatError("unsupported glTF accessor component/type") from exc
    view = document["bufferViews"][accessor["bufferView"]]
    buffer = buffers[view["buffer"]]
    count = int(accessor["count"])
    base_offset = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    packed_stride = component_bytes * components
    stride = int(view.get("byteStride", packed_stride))
    if stride < packed_stride:
        raise MeshFormatError("glTF byteStride is smaller than an accessor element")
    if count == 0:
        return np.empty((0, components), dtype=dtype)
    final_byte = base_offset + (count - 1) * stride + packed_stride
    if final_byte > len(buffer):
        raise MeshFormatError("glTF accessor extends beyond its buffer")
    if stride == packed_stride:
        array = np.frombuffer(buffer, dtype=dtype, count=count * components, offset=base_offset)
        return array.reshape(count, components).copy()
    result = np.empty((count, components), dtype=dtype)
    for row in range(count):
        result[row] = np.frombuffer(
            buffer, dtype=dtype, count=components, offset=base_offset + row * stride
        )
    return result


def _quaternion_matrix(quaternion: Sequence[float]) -> np.ndarray:
    x, y, z, w = map(float, quaternion)
    length = math.sqrt(x * x + y * y + z * z + w * w)
    if length == 0:
        return np.eye(4)
    x, y, z, w = x / length, y / length, z / length, w / length
    matrix = np.eye(4)
    matrix[:3, :3] = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return matrix


def _node_matrix(node: dict[str, Any]) -> np.ndarray:
    if "matrix" in node:
        # glTF serializes matrices column-major.
        return np.asarray(node["matrix"], dtype=np.float64).reshape(4, 4).T
    translation = np.eye(4)
    translation[:3, 3] = node.get("translation", [0, 0, 0])
    rotation = _quaternion_matrix(node.get("rotation", [0, 0, 0, 1]))
    scale = np.eye(4)
    scale[range(3), range(3)] = node.get("scale", [1, 1, 1])
    return translation @ rotation @ scale


def _triangulate_indices(indices: np.ndarray, mode: int) -> np.ndarray:
    flat = np.asarray(indices, dtype=np.int64).reshape(-1)
    if mode == 4:  # TRIANGLES
        if len(flat) % 3:
            raise MeshFormatError("triangle primitive index count is not divisible by 3")
        return flat.reshape(-1, 3)
    if mode == 5:  # TRIANGLE_STRIP
        faces = []
        for i in range(len(flat) - 2):
            tri = [flat[i], flat[i + 1], flat[i + 2]]
            if i % 2:
                tri[0], tri[1] = tri[1], tri[0]
            if len(set(tri)) == 3:
                faces.append(tri)
        return np.asarray(faces, dtype=np.int64).reshape(-1, 3)
    if mode == 6:  # TRIANGLE_FAN
        faces = [[flat[0], flat[i], flat[i + 1]] for i in range(1, len(flat) - 1)]
        return np.asarray(faces, dtype=np.int64).reshape(-1, 3)
    raise MeshFormatError(f"glTF primitive mode {mode} is not a triangle surface")


def load_glb(path: Path) -> list[Mesh]:
    """Load uncompressed GLB triangle meshes with scene-node transforms applied."""

    document, buffers = _read_glb(path)
    nodes = document.get("nodes", [])
    scenes = document.get("scenes", [])
    if scenes:
        scene_index = int(document.get("scene", 0))
        roots = list(scenes[scene_index].get("nodes", []))
    else:
        child_nodes = {child for node in nodes for child in node.get("children", [])}
        roots = [i for i in range(len(nodes)) if i not in child_nodes]

    result: list[Mesh] = []

    def visit(node_index: int, parent_matrix: np.ndarray, ancestry: tuple[int, ...]) -> None:
        if node_index in ancestry:
            raise MeshFormatError("glTF node graph contains a cycle")
        node = nodes[node_index]
        world = parent_matrix @ _node_matrix(node)
        if "mesh" in node:
            mesh_index = int(node["mesh"])
            source_mesh = document["meshes"][mesh_index]
            vertex_chunks: list[np.ndarray] = []
            face_chunks: list[np.ndarray] = []
            offset = 0
            for primitive_index, primitive in enumerate(source_mesh.get("primitives", [])):
                attributes = primitive.get("attributes", {})
                if "POSITION" not in attributes:
                    if "KHR_draco_mesh_compression" in primitive.get("extensions", {}):
                        raise MeshFormatError("Draco-compressed primitive cannot be decoded")
                    continue
                positions = _glb_accessor(document, buffers, int(attributes["POSITION"]))
                if positions.shape[1] != 3:
                    raise MeshFormatError("POSITION accessor must be VEC3")
                if "indices" in primitive:
                    indices = _glb_accessor(document, buffers, int(primitive["indices"]))
                else:
                    indices = np.arange(len(positions), dtype=np.int64)
                faces = _triangulate_indices(indices, int(primitive.get("mode", 4)))
                homogeneous = np.column_stack([positions.astype(np.float64), np.ones(len(positions))])
                transformed = (world @ homogeneous.T).T[:, :3]
                vertex_chunks.append(transformed)
                face_chunks.append(faces + offset)
                offset += len(transformed)
            if vertex_chunks:
                node_name = node.get("name") or source_mesh.get("name") or f"mesh_{mesh_index}"
                result.append(
                    Mesh(
                        _safe_name(str(node_name)),
                        np.vstack(vertex_chunks),
                        np.vstack(face_chunks),
                    )
                )
        for child in node.get("children", []):
            visit(int(child), world, ancestry + (node_index,))

    for root in roots:
        visit(int(root), np.eye(4), ())
    if not result:
        raise MeshFormatError(f"{path}: no triangle mesh nodes found")
    return result


def load_meshes(path: str | Path) -> list[Mesh]:
    """Load all logical meshes from an OBJ, STL, or GLB file."""

    path = Path(path)
    extension = path.suffix.lower()
    if extension == ".obj":
        return load_obj(path)
    if extension == ".stl":
        return load_stl(path)
    if extension == ".glb":
        return load_glb(path)
    raise MeshFormatError(f"unsupported mesh extension {extension!r}; expected .obj, .stl, or .glb")


def combine_meshes(meshes: Sequence[Mesh], name: str = "aggregate") -> Mesh:
    """Combine logical meshes without altering source/world coordinates."""

    vertices: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    offset = 0
    for mesh in meshes:
        vertices.append(mesh.vertices)
        faces.append(mesh.faces + offset)
        offset += len(mesh.vertices)
    return Mesh(name, np.vstack(vertices), np.vstack(faces))


def weld_and_clean(mesh: Mesh) -> tuple[Mesh, dict[str, Any]]:
    """Weld coincident vertices and remove index/area-degenerate triangles."""

    vertices = mesh.vertices
    dimensions = np.ptp(vertices, axis=0)
    diagonal = float(np.linalg.norm(dimensions))
    tolerance = max(diagonal * 1e-9, 1e-12)
    quantized = np.rint(vertices / tolerance).astype(np.int64)
    mapping: dict[tuple[int, int, int], int] = {}
    remap = np.empty(len(vertices), dtype=np.int64)
    welded: list[np.ndarray] = []
    for index, key_array in enumerate(quantized):
        key = (int(key_array[0]), int(key_array[1]), int(key_array[2]))
        target = mapping.get(key)
        if target is None:
            target = len(welded)
            mapping[key] = target
            welded.append(vertices[index])
        remap[index] = target
    welded_array = np.asarray(welded, dtype=np.float64)
    faces = remap[mesh.faces]
    index_valid = (
        (faces[:, 0] != faces[:, 1])
        & (faces[:, 1] != faces[:, 2])
        & (faces[:, 2] != faces[:, 0])
    )
    faces = faces[index_valid]
    triangles = welded_array[faces]
    doubled_area = np.linalg.norm(
        np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]), axis=1
    )
    area_threshold = max(diagonal * diagonal * 1e-18, 1e-30)
    area_valid = doubled_area > area_threshold
    faces = faces[area_valid]
    if len(faces) == 0:
        raise MeshFormatError("all mesh triangles are degenerate")
    used = np.unique(faces.reshape(-1))
    final_remap = np.full(len(welded_array), -1, dtype=np.int64)
    final_remap[used] = np.arange(len(used))
    cleaned = Mesh(mesh.name, welded_array[used], final_remap[faces])
    diagnostics = {
        "weld_tolerance": tolerance,
        "vertices_welded": int(len(vertices) - len(welded_array)),
        "unused_vertices_removed": int(len(welded_array) - len(used)),
        "degenerate_faces_removed": int(len(mesh.faces) - len(faces)),
    }
    return cleaned, diagnostics


def topology_report(mesh: Mesh) -> tuple[dict[str, Any], list[list[tuple[int, int]]]]:
    """Return edge-manifold diagnostics and face adjacency."""

    edge_uses: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for face_index, face in enumerate(mesh.faces):
        for a, b in ((face[0], face[1]), (face[1], face[2]), (face[2], face[0])):
            a, b = int(a), int(b)
            key = (a, b) if a < b else (b, a)
            direction = 1 if (a, b) == key else -1
            edge_uses[key].append((face_index, direction))
    boundary = sum(len(uses) == 1 for uses in edge_uses.values())
    nonmanifold = sum(len(uses) > 2 for uses in edge_uses.values())
    inconsistent = sum(
        len(uses) == 2 and uses[0][1] == uses[1][1] for uses in edge_uses.values()
    )
    adjacency: list[list[tuple[int, int]]] = [[] for _ in range(len(mesh.faces))]
    for uses in edge_uses.values():
        if len(uses) == 2:
            (left, left_direction), (right, right_direction) = uses
            same_direction = int(left_direction == right_direction)
            adjacency[left].append((right, same_direction))
            adjacency[right].append((left, same_direction))

    component_count = 0
    visited = np.zeros(len(mesh.faces), dtype=bool)
    for seed in range(len(mesh.faces)):
        if visited[seed]:
            continue
        component_count += 1
        queue = [seed]
        visited[seed] = True
        while queue:
            current = queue.pop()
            for neighbor, _ in adjacency[current]:
                if not visited[neighbor]:
                    visited[neighbor] = True
                    queue.append(neighbor)
    report = {
        "unique_edge_count": len(edge_uses),
        "boundary_edge_count": boundary,
        "nonmanifold_edge_count": nonmanifold,
        "inconsistently_wound_edge_count": inconsistent,
        "connected_component_count": component_count,
        "is_edge_manifold": nonmanifold == 0,
        "is_watertight": boundary == 0 and nonmanifold == 0,
        "is_winding_consistent": inconsistent == 0 and nonmanifold == 0,
    }
    return report, adjacency


def orient_faces(mesh: Mesh, adjacency: list[list[tuple[int, int]]]) -> tuple[np.ndarray, list[np.ndarray], bool]:
    """Consistently orient each manifold-connected face component."""

    parity = np.full(len(mesh.faces), -1, dtype=np.int8)
    components: list[np.ndarray] = []
    conflict = False
    for seed in range(len(mesh.faces)):
        if parity[seed] >= 0:
            continue
        parity[seed] = 0
        members: list[int] = []
        queue: deque[int] = deque([seed])
        while queue:
            current = queue.popleft()
            members.append(current)
            for neighbor, same_direction in adjacency[current]:
                wanted = parity[current] ^ same_direction
                if parity[neighbor] < 0:
                    parity[neighbor] = wanted
                    queue.append(neighbor)
                elif parity[neighbor] != wanted:
                    conflict = True
        components.append(np.asarray(members, dtype=np.int64))
    faces = mesh.faces.copy()
    flip = np.flatnonzero(parity == 1)
    faces[flip, 1], faces[flip, 2] = faces[flip, 2].copy(), faces[flip, 1].copy()
    return faces, components, conflict


def _signed_volume(vertices: np.ndarray, faces: np.ndarray) -> float:
    triangles = vertices[faces]
    return float(
        np.einsum("ij,ij->i", triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2])).sum()
        / 6.0
    )


def volume_and_centroid(
    mesh: Mesh, topology: dict[str, Any], adjacency: list[list[tuple[int, int]]]
) -> tuple[float | None, np.ndarray | None, bool]:
    """Measure closed-component volume after repairing face orientation in memory."""

    if not topology["is_watertight"]:
        return None, None, False
    faces, components, conflict = orient_faces(mesh, adjacency)
    if conflict:
        return None, None, False
    total_volume = 0.0
    weighted_centroid = np.zeros(3)
    for component in components:
        component_faces = faces[component].copy()
        signed = _signed_volume(mesh.vertices, component_faces)
        if signed < 0:
            component_faces[:, [1, 2]] = component_faces[:, [2, 1]]
        triangles = mesh.vertices[component_faces]
        tetra_volumes = np.einsum(
            "ij,ij->i", triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2])
        ) / 6.0
        component_volume = float(tetra_volumes.sum())
        if component_volume <= np.finfo(float).eps:
            continue
        tetra_centroids = triangles.sum(axis=1) / 4.0
        component_centroid = np.sum(tetra_centroids * tetra_volumes[:, None], axis=0) / component_volume
        total_volume += component_volume
        weighted_centroid += component_centroid * component_volume
    if total_volume <= np.finfo(float).eps:
        return None, None, True
    return total_volume, weighted_centroid / total_volume, True


def surface_moments(mesh: Mesh) -> tuple[float, np.ndarray, np.ndarray, np.ndarray]:
    """Compute exact area/centroid and a surface-area PCA covariance."""

    triangles = mesh.vertices[mesh.faces]
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    areas = np.linalg.norm(cross, axis=1) * 0.5
    total_area = float(areas.sum())
    if total_area <= np.finfo(float).eps:
        raise MeshFormatError("mesh has zero surface area")
    sums = triangles.sum(axis=1)
    centroids = sums / 3.0
    surface_centroid = np.sum(centroids * areas[:, None], axis=0) / total_area

    second = np.zeros((3, 3), dtype=np.float64)
    for triangle, vertex_sum, area in zip(triangles, sums, areas, strict=True):
        diagonal_sum = sum(np.outer(vertex, vertex) for vertex in triangle)
        exact_triangle_second = (diagonal_sum + np.outer(vertex_sum, vertex_sum)) / 12.0
        second += area * exact_triangle_second
    covariance = second / total_area - np.outer(surface_centroid, surface_centroid)
    covariance = (covariance + covariance.T) * 0.5
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    order = np.argsort(eigenvalues)[::-1]
    eigenvalues = np.maximum(eigenvalues[order], 0.0)
    axes = eigenvectors[:, order].T
    # Resolve eigenvector sign ambiguity deterministically against world axes.
    for row in range(3):
        dominant = int(np.argmax(np.abs(axes[row])))
        if axes[row, dominant] < 0:
            axes[row] *= -1
    if np.linalg.det(axes) < 0:
        axes[2] *= -1
    return total_area, surface_centroid, eigenvalues, axes


def _grid_coordinates(points: np.ndarray, resolution: int, extent: float = 0.55) -> np.ndarray:
    return (points + extent) * ((resolution - 1) / (2 * extent))


def _draw_segment(mask: np.ndarray, first: np.ndarray, second: np.ndarray) -> None:
    delta = second - first
    steps = max(1, int(math.ceil(float(np.max(np.abs(delta))) * 1.5)))
    samples = first[None, :] + np.linspace(0.0, 1.0, steps + 1)[:, None] * delta[None, :]
    pixels = np.rint(samples).astype(int)
    valid = (
        (pixels[:, 0] >= 0)
        & (pixels[:, 0] < mask.shape[1])
        & (pixels[:, 1] >= 0)
        & (pixels[:, 1] < mask.shape[0])
    )
    pixels = pixels[valid]
    mask[pixels[:, 1], pixels[:, 0]] = True


def rasterize_projection(points_2d: np.ndarray, faces: np.ndarray, resolution: int) -> np.ndarray:
    """Conservative scanline union of projected surface triangles."""

    pixels = _grid_coordinates(points_2d, resolution)
    mask = np.zeros((resolution, resolution), dtype=bool)
    for face in faces:
        triangle = pixels[face]
        minimum_y = max(0, int(math.floor(float(triangle[:, 1].min()))) - 1)
        maximum_y = min(resolution - 1, int(math.ceil(float(triangle[:, 1].max()))) + 1)
        for row in range(minimum_y, maximum_y + 1):
            y = row + 0.5
            intersections: list[float] = []
            for first, second in ((triangle[0], triangle[1]), (triangle[1], triangle[2]), (triangle[2], triangle[0])):
                y1, y2 = float(first[1]), float(second[1])
                if (y1 <= y < y2) or (y2 <= y < y1):
                    t = (y - y1) / (y2 - y1)
                    intersections.append(float(first[0] + t * (second[0] - first[0])))
            if len(intersections) >= 2:
                left = max(0, int(math.ceil(min(intersections) - 0.5)))
                right = min(resolution - 1, int(math.floor(max(intersections) - 0.5)))
                if left <= right:
                    mask[row, left : right + 1] = True
        _draw_segment(mask, triangle[0], triangle[1])
        _draw_segment(mask, triangle[1], triangle[2])
        _draw_segment(mask, triangle[2], triangle[0])
    return mask


def _mask_payload(mask: np.ndarray) -> dict[str, Any]:
    occupied = np.argwhere(mask)
    if len(occupied):
        y_min, x_min = occupied.min(axis=0)
        y_max, x_max = occupied.max(axis=0)
        bbox: list[int] | None = [int(x_min), int(y_min), int(x_max), int(y_max)]
    else:
        bbox = None
    return {
        "resolution": [int(mask.shape[1]), int(mask.shape[0])],
        "origin": "bottom_left",
        "encoding": "rows_top_to_bottom_1bit_text",
        "occupied_pixel_count": int(mask.sum()),
        "occupied_fraction": float(mask.mean()),
        "occupied_bbox_pixels": bbox,
        "rows": ["".join("1" if value else "0" for value in row) for row in mask[::-1]],
    }


def _silhouettes(
    normalized_vertices: np.ndarray, faces: np.ndarray, resolution: int
) -> dict[str, Any]:
    views = {"xy": (0, 1), "xz": (0, 2), "yz": (1, 2)}
    return {
        name: _mask_payload(rasterize_projection(normalized_vertices[:, axes], faces, resolution))
        for name, axes in views.items()
    }


def _slice_segments(
    oriented_vertices: np.ndarray,
    faces: np.ndarray,
    axis: int,
    plane: float,
    epsilon: float,
) -> np.ndarray:
    triangles = oriented_vertices[faces]
    candidates = triangles[
        (triangles[:, :, axis].min(axis=1) <= plane + epsilon)
        & (triangles[:, :, axis].max(axis=1) >= plane - epsilon)
    ]
    other = [index for index in range(3) if index != axis]
    segments: list[np.ndarray] = []
    for triangle in candidates:
        points: list[np.ndarray] = []
        for first_index, second_index in ((0, 1), (1, 2), (2, 0)):
            first, second = triangle[first_index], triangle[second_index]
            first_distance = float(first[axis] - plane)
            second_distance = float(second[axis] - plane)
            if abs(first_distance) <= epsilon:
                points.append(first[other])
            if first_distance * second_distance < -(epsilon * epsilon):
                t = first_distance / (first_distance - second_distance)
                points.append(first[other] + t * (second[other] - first[other]))
        unique: list[np.ndarray] = []
        for point in points:
            if not any(np.linalg.norm(point - existing) <= epsilon for existing in unique):
                unique.append(np.asarray(point))
        if len(unique) >= 2:
            if len(unique) > 2:
                distances = np.array(
                    [[np.linalg.norm(a - b) for b in unique] for a in unique], dtype=float
                )
                left, right = np.unravel_index(int(np.argmax(distances)), distances.shape)
                pair = [unique[left], unique[right]]
            else:
                pair = unique
            if np.linalg.norm(pair[1] - pair[0]) > epsilon:
                segments.append(np.vstack(pair))
    if not segments:
        return np.empty((0, 2, 2), dtype=np.float64)
    return np.asarray(segments, dtype=np.float64)


def _rasterize_cross_section(segments: np.ndarray, resolution: int) -> np.ndarray:
    pixels = _grid_coordinates(segments.reshape(-1, 2), resolution).reshape(-1, 2, 2)
    mask = np.zeros((resolution, resolution), dtype=bool)
    # Even/odd fill against all contour segments; works for holes and components.
    for row in range(resolution):
        y = row + 0.5
        intersections: list[float] = []
        for first, second in pixels:
            y1, y2 = float(first[1]), float(second[1])
            if (y1 <= y < y2) or (y2 <= y < y1):
                t = (y - y1) / (y2 - y1)
                intersections.append(float(first[0] + t * (second[0] - first[0])))
        intersections.sort()
        for index in range(0, len(intersections) - 1, 2):
            left = max(0, int(math.ceil(intersections[index] - 0.5)))
            right = min(resolution - 1, int(math.floor(intersections[index + 1] - 0.5)))
            if left <= right:
                mask[row, left : right + 1] = True
    for first, second in pixels:
        _draw_segment(mask, first, second)
    return mask


def _boundary_samples(points: np.ndarray, maximum: int) -> list[list[float]]:
    if len(points) == 0:
        return []
    rounded = np.round(points, decimals=7)
    unique = np.unique(rounded, axis=0)
    center = unique.mean(axis=0)
    relative = unique - center
    order = np.lexsort(
        (np.linalg.norm(relative, axis=1), np.arctan2(relative[:, 1], relative[:, 0]))
    )
    unique = unique[order]
    if len(unique) > maximum:
        indices = np.floor(np.linspace(0, len(unique), maximum, endpoint=False)).astype(int)
        unique = unique[indices]
    return [[round(float(value), 7) for value in point] for point in unique]


def _cross_sections(
    oriented_vertices: np.ndarray,
    faces: np.ndarray,
    oriented_min: np.ndarray,
    oriented_max: np.ndarray,
    oriented_center: np.ndarray,
    uniform_scale: float,
    options: SamplingOptions,
) -> dict[str, Any]:
    output: dict[str, Any] = {}
    diagonal = float(np.linalg.norm(oriented_max - oriented_min))
    epsilon = max(diagonal * 1e-9, 1e-12)
    for axis in range(3):
        span = float(oriented_max[axis] - oriented_min[axis])
        slices: list[dict[str, Any]] = []
        other = [index for index in range(3) if index != axis]
        for fraction in options.slice_fractions:
            plane = float(oriented_min[axis] + fraction * span)
            segments = _slice_segments(oriented_vertices, faces, axis, plane, epsilon)
            if len(segments):
                normalized = (segments - oriented_center[other]) / uniform_scale
                flat = normalized.reshape(-1, 2)
                section_bounds = {
                    "min": flat.min(axis=0).tolist(),
                    "max": flat.max(axis=0).tolist(),
                    "dimensions": np.ptp(flat, axis=0).tolist(),
                }
                centroid = flat.mean(axis=0).tolist()
                mask = _rasterize_cross_section(normalized, options.cross_section_resolution)
                boundary = _boundary_samples(flat, options.max_boundary_samples)
            else:
                section_bounds = None
                centroid = None
                mask = np.zeros(
                    (options.cross_section_resolution, options.cross_section_resolution), dtype=bool
                )
                boundary = []
            slices.append(
                {
                    "fraction": float(fraction),
                    "plane_coordinate_native": plane,
                    "segment_count": int(len(segments)),
                    "bounds_normalized": section_bounds,
                    "centroid_normalized": centroid,
                    "boundary_samples_normalized": boundary,
                    "mask": _mask_payload(mask),
                }
            )
        output[f"pca_axis_{axis}"] = {
            "axis": axis,
            "in_plane_axes": other,
            "slices": slices,
        }
    return output


def _round_floats(value: Any, digits: int = 9) -> Any:
    if isinstance(value, np.ndarray):
        return _round_floats(value.tolist(), digits)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        if not math.isfinite(number):
            return None
        return round(number, digits)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, dict):
        return {key: _round_floats(item, digits) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_round_floats(item, digits) for item in value]
    return value


def analyze_mesh(
    mesh: Mesh,
    options: SamplingOptions | None = None,
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Analyze one logical mesh and return a JSON-serializable dictionary."""

    options = options or SamplingOptions()
    cleaned, cleaning = weld_and_clean(mesh)
    topology, adjacency = topology_report(cleaned)
    surface_area, surface_centroid, eigenvalues, axes = surface_moments(cleaned)
    volume, volume_centroid, orientation_repaired = volume_and_centroid(cleaned, topology, adjacency)

    minimum = cleaned.vertices.min(axis=0)
    maximum = cleaned.vertices.max(axis=0)
    dimensions = maximum - minimum
    bounds_center = (minimum + maximum) * 0.5
    oriented = (cleaned.vertices - surface_centroid) @ axes.T
    oriented_min = oriented.min(axis=0)
    oriented_max = oriented.max(axis=0)
    oriented_dimensions = oriented_max - oriented_min
    oriented_center = (oriented_min + oriented_max) * 0.5
    scale = float(max(float(oriented_dimensions.max()), np.finfo(float).eps))
    pca_normalized = (oriented - oriented_center) / scale

    world_scale = float(max(float(dimensions.max()), np.finfo(float).eps))
    world_normalized = (cleaned.vertices - bounds_center) / world_scale

    report: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "source": source or {"mesh_name": mesh.name},
        "mesh_name": mesh.name,
        "units": {
            "native": "source_units_unspecified",
            "note": "All physical measurements preserve source units; area and volume use squared/cubed source units.",
        },
        "counts": {
            "source_vertex_count": len(mesh.vertices),
            "source_face_count": len(mesh.faces),
            "analyzed_vertex_count": len(cleaned.vertices),
            "analyzed_face_count": len(cleaned.faces),
        },
        "cleaning": cleaning,
        "topology": topology,
        "bounds": {
            "min": minimum,
            "max": maximum,
            "dimensions": dimensions,
            "center": bounds_center,
            "diagonal": float(np.linalg.norm(dimensions)),
        },
        "centroids": {
            "vertex_mean": cleaned.vertices.mean(axis=0),
            "surface_area_weighted": surface_centroid,
            "volume_if_watertight": volume_centroid,
        },
        "surface_area": surface_area,
        "volume_if_watertight": volume,
        "volume_orientation_repaired_in_memory": orientation_repaired,
        "pca": {
            "basis": "exact_uniform_surface_moments",
            "eigenvalues": eigenvalues,
            "principal_axes_world": axes,
            "oriented_bounds": {
                "min": oriented_min,
                "max": oriented_max,
                "dimensions": oriented_dimensions,
                "center": oriented_center,
            },
        },
        "sampling": {
            "normalization": {
                "method": "uniform_scale_about_oriented_bounds_center",
                "pca_origin_world": surface_centroid,
                "pca_basis_world": axes,
                "oriented_bounds_center": oriented_center,
                "uniform_scale_native": scale,
                "normalized_extent": "largest dimension equals 1.0; aspect ratio is preserved",
            },
            "silhouettes": {
                "world_axis_aligned": _silhouettes(
                    world_normalized, cleaned.faces, options.silhouette_resolution
                ),
                "pca_axis_aligned": _silhouettes(
                    pca_normalized, cleaned.faces, options.silhouette_resolution
                ),
            },
            "cross_sections_pca": _cross_sections(
                oriented,
                cleaned.faces,
                oriented_min,
                oriented_max,
                oriented_center,
                scale,
                options,
            ),
        },
    }
    return _round_floats(report)


@lru_cache(maxsize=64)
def _file_sha256(resolved_path: str) -> str:
    digest = hashlib.sha256()
    with open(resolved_path, "rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def source_metadata(path: str | Path, part_name: str, part_index: int, aggregate: bool = False) -> dict[str, Any]:
    path = Path(path)
    resolved = str(path.resolve())
    digest = _file_sha256(resolved)
    return {
        "path": resolved,
        "filename": path.name,
        "format": path.suffix.lower().lstrip("."),
        "sha256": digest,
        "logical_mesh_name": part_name,
        "logical_mesh_index": part_index,
        "aggregate": aggregate,
    }


def validate_declared_bounds(report: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any] | None:
    """Compare measured bounds to optional atlas-declared metre/mm bounds."""

    declared_key = next(
        (key for key in ("position_bbox_m", "position_bbox_mm", "position_bbox") if key in metadata),
        None,
    )
    if declared_key is None:
        return None
    declared = metadata[declared_key]
    if not isinstance(declared, dict) or "min" not in declared or "max" not in declared:
        return {
            "status": "invalid_metadata",
            "declared_key": declared_key,
            "reason": "declared bounds require min and max arrays",
        }
    expected_min = np.asarray(declared["min"], dtype=float)
    expected_max = np.asarray(declared["max"], dtype=float)
    measured_min = np.asarray(report["bounds"]["min"], dtype=float)
    measured_max = np.asarray(report["bounds"]["max"], dtype=float)
    if expected_min.shape != (3,) or expected_max.shape != (3,):
        return {
            "status": "invalid_metadata",
            "declared_key": declared_key,
            "reason": "declared min/max must each contain three coordinates",
        }
    errors = np.concatenate([measured_min - expected_min, measured_max - expected_max])
    scale = max(float(np.linalg.norm(expected_max - expected_min)), 1.0)
    tolerance = scale * 1e-6
    return _round_floats(
        {
            "status": "pass" if float(np.max(np.abs(errors))) <= tolerance else "mismatch",
            "declared_key": declared_key,
            "tolerance_native": tolerance,
            "max_absolute_error_native": float(np.max(np.abs(errors))),
            "rms_error_native": float(np.sqrt(np.mean(errors * errors))),
            "min_error_native": measured_min - expected_min,
            "max_error_native": measured_max - expected_max,
        }
    )


def registration_to_reference(
    report: dict[str, Any], reference_report: dict[str, Any]
) -> dict[str, Any]:
    """Express a mesh's bounds and centroids in a reference body's unit box.

    This is intentionally based on world-axis bounds rather than PCA axes: an
    organ and a united-body mesh must remain in the same registered atlas frame
    for the resulting values to describe anatomical placement.
    """

    bounds = report["bounds"]
    reference_bounds = reference_report["bounds"]
    minimum = np.asarray(bounds["min"], dtype=float)
    maximum = np.asarray(bounds["max"], dtype=float)
    dimensions = np.asarray(bounds["dimensions"], dtype=float)
    reference_minimum = np.asarray(reference_bounds["min"], dtype=float)
    reference_maximum = np.asarray(reference_bounds["max"], dtype=float)
    reference_dimensions = np.asarray(reference_bounds["dimensions"], dtype=float)
    valid = np.abs(reference_dimensions) > np.finfo(float).eps

    def safe_ratio(numerator: np.ndarray) -> list[float | None]:
        result: list[float | None] = []
        for value, denominator, usable in zip(numerator, reference_dimensions, valid, strict=True):
            result.append(float(value / denominator) if usable else None)
        return result

    normalized_minimum = safe_ratio(minimum - reference_minimum)
    normalized_maximum = safe_ratio(maximum - reference_minimum)
    normalized_center = safe_ratio(np.asarray(bounds["center"], dtype=float) - reference_minimum)
    dimension_ratios = safe_ratio(dimensions)
    overlap = np.maximum(0.0, np.minimum(maximum, reference_maximum) - np.maximum(minimum, reference_minimum))
    overlap_ratios = [
        float(value / dimension) if dimension > np.finfo(float).eps else None
        for value, dimension in zip(overlap, dimensions, strict=True)
    ]

    centroid_coordinates: dict[str, list[float | None] | None] = {}
    for name, centroid in report.get("centroids", {}).items():
        centroid_coordinates[name] = (
            safe_ratio(np.asarray(centroid, dtype=float) - reference_minimum)
            if centroid is not None
            else None
        )

    reference_diagonal = float(reference_bounds.get("diagonal", 0.0))
    reference_box_volume = float(np.prod(reference_dimensions))
    mesh_box_volume = float(np.prod(dimensions))
    reference_surface_area = reference_report.get("surface_area")
    reference_mesh_volume = reference_report.get("volume_if_watertight")
    result = {
        "status": "registered",
        "reference": {
            "mesh_name": reference_report.get("mesh_name"),
            "source": reference_report.get("source"),
        },
        "coordinate_convention": (
            "0 is the reference AABB minimum and 1 is its maximum on each world axis; "
            "values outside [0,1] lie outside the reference bounds"
        ),
        "bounds_normalized_to_reference": {
            "min": normalized_minimum,
            "max": normalized_maximum,
            "center": normalized_center,
            "dimensions": dimension_ratios,
        },
        "centroids_normalized_to_reference": centroid_coordinates,
        "ratios": {
            "dimensions_over_reference_dimensions": dimension_ratios,
            "diagonal_over_reference_diagonal": (
                float(bounds["diagonal"] / reference_diagonal)
                if reference_diagonal > np.finfo(float).eps
                else None
            ),
            "aabb_volume_over_reference_aabb_volume": (
                mesh_box_volume / reference_box_volume
                if reference_box_volume > np.finfo(float).eps
                else None
            ),
            "surface_area_over_reference_surface_area": (
                float(report["surface_area"] / reference_surface_area)
                if reference_surface_area and reference_surface_area > np.finfo(float).eps
                else None
            ),
            "closed_volume_over_reference_closed_volume": (
                float(report["volume_if_watertight"] / reference_mesh_volume)
                if report.get("volume_if_watertight") is not None
                and reference_mesh_volume is not None
                and reference_mesh_volume > np.finfo(float).eps
                else None
            ),
        },
        "containment": {
            "aabb_fully_inside_reference_aabb": bool(
                np.all(minimum >= reference_minimum) and np.all(maximum <= reference_maximum)
            ),
            "center_inside_reference_aabb": bool(
                np.all(np.asarray(bounds["center"]) >= reference_minimum)
                and np.all(np.asarray(bounds["center"]) <= reference_maximum)
            ),
            "per_axis_overlap_fraction_of_mesh_bounds": overlap_ratios,
        },
    }
    return _round_floats(result)


def dumps_report(report: dict[str, Any], indent: int | None = 2) -> str:
    """Serialize a report with stable key order and no non-standard NaN values."""

    return json.dumps(report, indent=indent, sort_keys=True, allow_nan=False) + "\n"
