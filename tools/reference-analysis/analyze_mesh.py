#!/usr/bin/env python3
"""Command-line entry point for anatomical reference mesh analysis."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from mesh_analysis import (
    MeshFormatError,
    SamplingOptions,
    analyze_mesh,
    combine_meshes,
    dumps_report,
    load_meshes,
    registration_to_reference,
    source_metadata,
    validate_declared_bounds,
)


def _slug(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-.")
    return value or "mesh"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Measure OBJ, STL, and uncompressed GLB reference meshes and emit "
            "deterministic per-mesh JSON reports."
        )
    )
    parser.add_argument("inputs", nargs="*", type=Path, help="mesh file(s) to analyze")
    parser.add_argument(
        "--output-dir", type=Path, default=Path("analysis-output"), help="JSON output directory"
    )
    parser.add_argument(
        "--silhouette-resolution", type=int, default=48, metavar="PIXELS"
    )
    parser.add_argument(
        "--cross-section-resolution", type=int, default=32, metavar="PIXELS"
    )
    parser.add_argument(
        "--slice-fractions",
        default="0.10,0.25,0.50,0.75,0.90",
        help="comma-separated normalized PCA slice positions",
    )
    parser.add_argument(
        "--aggregate",
        choices=("auto", "always", "never"),
        default="auto",
        help="also analyze all logical meshes combined (auto: only for multi-mesh files)",
    )
    parser.add_argument("--compact", action="store_true", help="write compact JSON")
    parser.add_argument(
        "--manifest",
        type=Path,
        help="batch JSON manifest containing meshes and an optional body reference",
    )
    reference = parser.add_mutually_exclusive_group()
    reference.add_argument(
        "--reference-mesh",
        type=Path,
        help="united/body mesh whose world bounds define normalized organ placement",
    )
    reference.add_argument(
        "--reference-report",
        type=Path,
        help="existing analyzer JSON report whose bounds define normalized placement",
    )
    parser.add_argument(
        "--batch-output",
        default="batch.analysis.json",
        help="summary JSON filename written inside --output-dir",
    )
    parser.add_argument(
        "--no-batch-output", action="store_true", help="do not write the batch summary JSON"
    )
    return parser


def _parse_fractions(value: str) -> tuple[float, ...]:
    try:
        fractions = tuple(float(item.strip()) for item in value.split(",") if item.strip())
    except ValueError as exc:
        raise argparse.ArgumentTypeError("slice fractions must be numbers") from exc
    if not fractions or any(not 0.0 < fraction < 1.0 for fraction in fractions):
        raise argparse.ArgumentTypeError("slice fractions must lie strictly between 0 and 1")
    return fractions


def _manifest_inputs(args: argparse.Namespace) -> tuple[list[dict], dict]:
    entries: list[dict] = [{"path": str(path)} for path in args.inputs]
    document: dict = {}
    if args.manifest:
        manifest_path = args.manifest.resolve()
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
        base = manifest_path.parent
        # ``models``/``local_path`` also accepts the project's provenance-rich
        # official-atlas manifest without requiring a second bookkeeping file.
        raw_entries = document.get("meshes", document.get("models", []))
        if not isinstance(raw_entries, list):
            raise ValueError("manifest 'meshes' must be a list")
        for raw in raw_entries:
            item = {"path": raw} if isinstance(raw, str) else dict(raw)
            if "path" not in item and "local_path" in item:
                item["path"] = item["local_path"]
            if "path" not in item:
                raise ValueError("every manifest mesh entry requires 'path' or 'local_path'")
            path = Path(item["path"])
            item["path"] = str(path if path.is_absolute() else (base / path).resolve())
            entries.append(item)
        if document.get("output_dir") and args.output_dir == Path("analysis-output"):
            output = Path(document["output_dir"])
            args.output_dir = output if output.is_absolute() else (base / output).resolve()
        if args.reference_mesh is None and args.reference_report is None:
            if document.get("reference_mesh"):
                path = Path(document["reference_mesh"])
                args.reference_mesh = path if path.is_absolute() else (base / path).resolve()
            elif document.get("reference_report"):
                path = Path(document["reference_report"])
                args.reference_report = path if path.is_absolute() else (base / path).resolve()
            elif document.get("canonical_frame", {}).get("local_path"):
                path = Path(document["canonical_frame"]["local_path"])
                args.reference_mesh = path if path.is_absolute() else (base / path).resolve()
        if document.get("batch_output") and args.batch_output == "batch.analysis.json":
            args.batch_output = str(document["batch_output"])
    if not entries:
        raise ValueError("provide mesh inputs or a --manifest containing meshes")
    return entries, document


def _registration_skip_reason(entry: dict, manifest: dict, input_path: Path, args: argparse.Namespace) -> str | None:
    explicit = entry.get("register_to_reference")
    if explicit is False:
        return "manifest entry explicitly sets register_to_reference=false"
    if args.reference_mesh and input_path.resolve() == args.reference_mesh.resolve():
        return "mesh is the united-body reference itself"
    canonical_units = str(manifest.get("canonical_frame", {}).get("units", "")).strip().lower()
    organ_units = str(entry.get("units", "")).strip().lower()
    if canonical_units and organ_units and canonical_units != organ_units:
        return f"source units ({organ_units}) differ from canonical reference units ({canonical_units})"
    coordinate_notes = str(entry.get("coordinate_notes", "")).lower()
    if "must not be directly registered" in coordinate_notes:
        return "source provenance states that this model is not registered to the canonical frame"
    return None


def _reference_report(args: argparse.Namespace, options: SamplingOptions) -> tuple[dict | None, Path | None]:
    if args.reference_report:
        path = args.reference_report.resolve()
        return json.loads(path.read_text(encoding="utf-8")), path
    if args.reference_mesh:
        path = args.reference_mesh.resolve()
        parts = load_meshes(path)
        reference = combine_meshes(parts, f"{path.stem}_united_reference")
        return (
            analyze_mesh(
                reference,
                options,
                source=source_metadata(path, reference.name, -1, aggregate=True),
            ),
            None,
        )
    return None, None


def run(args: argparse.Namespace) -> list[Path]:
    options = SamplingOptions(
        silhouette_resolution=args.silhouette_resolution,
        cross_section_resolution=args.cross_section_resolution,
        slice_fractions=_parse_fractions(args.slice_fractions),
    )
    entries, manifest = _manifest_inputs(args)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    reference_report, existing_reference_path = _reference_report(args, options)
    written: list[Path] = []
    summary_entries: list[dict] = []
    if reference_report is not None and existing_reference_path is None:
        reference_output = args.output_dir / "united-body__reference.analysis.json"
        reference_output.write_text(
            dumps_report(reference_report, None if args.compact else 2), encoding="utf-8"
        )
        written.append(reference_output)
    for entry_index, entry in enumerate(entries):
        input_path = Path(entry["path"]).resolve()
        # The reference is emitted once as united-body__reference.analysis.json.
        # Do not spend another full analysis pass on the same large GLB.
        if args.reference_mesh and input_path == args.reference_mesh.resolve():
            continue
        meshes = load_meshes(input_path)
        for index, mesh in enumerate(meshes):
            metadata = {key: value for key, value in entry.items() if key != "path"}
            source = source_metadata(input_path, mesh.name, index, aggregate=False)
            if metadata:
                source["manifest_metadata"] = metadata
            report = analyze_mesh(
                mesh,
                options,
                source=source,
            )
            declared_bounds = validate_declared_bounds(report, metadata)
            if declared_bounds is not None:
                report["declared_bounds_validation"] = declared_bounds
            skip_reason = _registration_skip_reason(entry, manifest, input_path, args)
            if reference_report is not None and skip_reason is None:
                report["registration_to_reference"] = registration_to_reference(
                    report, reference_report
                )
            elif reference_report is not None:
                report["registration_to_reference"] = {
                    "status": "skipped",
                    "reason": skip_reason,
                }
            prefix = _slug(str(entry.get("label", input_path.stem)))
            suffix = _slug(mesh.name) if len(meshes) > 1 else "mesh"
            output = args.output_dir / f"{prefix}__{suffix}.analysis.json"
            if output.exists() and any(path == output for path in written):
                output = args.output_dir / f"{prefix}-{entry_index}__{suffix}.analysis.json"
            output.write_text(dumps_report(report, None if args.compact else 2), encoding="utf-8")
            written.append(output)
            summary_entries.append(
                {
                    "output": str(output.resolve()),
                    "mesh_name": report["mesh_name"],
                    "source": report["source"],
                    "bounds": report["bounds"],
                    "registration_to_reference": report.get("registration_to_reference"),
                }
            )
        include_aggregate = args.aggregate == "always" or (
            args.aggregate == "auto" and len(meshes) > 1
        )
        if include_aggregate:
            aggregate = combine_meshes(meshes, f"{input_path.stem}_aggregate")
            report = analyze_mesh(
                aggregate,
                options,
                source=source_metadata(input_path, aggregate.name, -1, aggregate=True),
            )
            declared_bounds = validate_declared_bounds(report, metadata)
            if declared_bounds is not None:
                report["declared_bounds_validation"] = declared_bounds
            if reference_report is not None and skip_reason is None:
                report["registration_to_reference"] = registration_to_reference(
                    report, reference_report
                )
            elif reference_report is not None:
                report["registration_to_reference"] = {
                    "status": "skipped",
                    "reason": skip_reason,
                }
            prefix = _slug(str(entry.get("label", input_path.stem)))
            output = args.output_dir / f"{prefix}__aggregate.analysis.json"
            output.write_text(dumps_report(report, None if args.compact else 2), encoding="utf-8")
            written.append(output)
            summary_entries.append(
                {
                    "output": str(output.resolve()),
                    "mesh_name": report["mesh_name"],
                    "source": report["source"],
                    "bounds": report["bounds"],
                    "registration_to_reference": report.get("registration_to_reference"),
                }
            )
    if not args.no_batch_output:
        batch = {
            "schema_version": "1.0.0",
            "kind": "mesh_analysis_batch",
            "manifest": str(args.manifest.resolve()) if args.manifest else None,
            "manifest_metadata": {
                key: value
                for key, value in manifest.items()
                if key not in {"meshes", "models", "reference_mesh", "reference_report"}
            },
            "reference": (
                {
                    "report_path": (
                        str(existing_reference_path) if existing_reference_path else str(reference_output.resolve())
                    ),
                    "mesh_name": reference_report.get("mesh_name"),
                    "source": reference_report.get("source"),
                    "bounds": reference_report.get("bounds"),
                }
                if reference_report is not None
                else None
            ),
            "reports": summary_entries,
        }
        batch_output = args.output_dir / args.batch_output
        batch_output.write_text(dumps_report(batch, None if args.compact else 2), encoding="utf-8")
        written.append(batch_output)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        written = run(args)
    except (MeshFormatError, OSError, ValueError, KeyError, IndexError) as exc:
        parser.exit(2, f"error: {exc}\n")
    for output in written:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
