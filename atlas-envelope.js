// Smooth procedural envelopes reconstructed from official HRA axial fits.
// The compact fit data is a measurement reference; no runtime GLB is loaded.
export function createMeasuredEnvelopeGeometry({
    THREE,
    fitted,
    angles,
    targetMin,
    targetSize,
    fairingPasses = 3,
    subdivisions = 5,
    radialProfileWeight = 0,
    sourceLabel = 'Official HRA measured envelope',
    deformPoint = null,
}) {
    if (!fitted?.loft?.sections?.length || !angles?.length) return null;

    let sections = fitted.loft.sections.map(section => {
        const points = section.radii_m.map((radius, ray) => [
            section.center_xz_m[0] + Math.cos(angles[ray]) * radius,
            section.center_xz_m[1] + Math.sin(angles[ray]) * radius,
        ]);
        const xs = points.map(point => point[0]);
        const zs = points.map(point => point[1]);
        const xMin = Math.min(...xs), xMax = Math.max(...xs);
        const zMin = Math.min(...zs), zMax = Math.max(...zs);
        const radii = section.radii_m.map((radius, ray, source) => {
            // A light circular fair removes ray-level sampling chatter without
            // erasing the organ's true non-elliptic cross-section.
            const before = source[(ray - 1 + source.length) % source.length];
            const after = source[(ray + 1) % source.length];
            return before * 0.14 + radius * 0.72 + after * 0.14;
        });
        return {
            y: section.y_m,
            centerX: (xMin + xMax) * 0.5,
            centerZ: (zMin + zMax) * 0.5,
            halfX: Math.max(0.0005, (xMax - xMin) * 0.5),
            halfZ: Math.max(0.0005, (zMax - zMin) * 0.5),
            radii,
        };
    });

    for (let pass = 0; pass < fairingPasses; pass++) {
        sections = sections.map((section, index, source) => {
            if (index === 0 || index === source.length - 1) return section;
            const before = source[index - 1];
            const after = source[index + 1];
            const fair = key => before[key] * 0.18 + section[key] * 0.64 + after[key] * 0.18;
            return {
                y: section.y,
                centerX: fair('centerX'),
                centerZ: fair('centerZ'),
                halfX: fair('halfX'),
                halfZ: fair('halfZ'),
                radii: section.radii.map((radius, ray) =>
                    before.radii[ray] * 0.18 + radius * 0.64 + after.radii[ray] * 0.18
                ),
            };
        });
    }

    const catmull = (p0, p1, p2, p3, t) => {
        const t2 = t * t, t3 = t2 * t;
        return 0.5 * (
            2 * p1 + (-p0 + p2) * t +
            (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
            (-p0 + 3 * p1 - 3 * p2 + p3) * t3
        );
    };
    const renderSections = [];
    for (let index = 0; index < sections.length - 1; index++) {
        const p0 = sections[Math.max(0, index - 1)];
        const p1 = sections[index];
        const p2 = sections[index + 1];
        const p3 = sections[Math.min(sections.length - 1, index + 2)];
        for (let subdivision = 0; subdivision < subdivisions; subdivision++) {
            const t = subdivision / subdivisions;
            renderSections.push({
                y: THREE.MathUtils.lerp(p1.y, p2.y, t),
                centerX: catmull(p0.centerX, p1.centerX, p2.centerX, p3.centerX, t),
                centerZ: catmull(p0.centerZ, p1.centerZ, p2.centerZ, p3.centerZ, t),
                halfX: Math.max(0.0005, catmull(p0.halfX, p1.halfX, p2.halfX, p3.halfX, t)),
                halfZ: Math.max(0.0005, catmull(p0.halfZ, p1.halfZ, p2.halfZ, p3.halfZ, t)),
                radii: p1.radii.map((radius, ray) => Math.max(0.0005,
                    catmull(p0.radii[ray], radius, p2.radii[ray], p3.radii[ray], t)
                )),
            });
        }
    }
    renderSections.push(sections[sections.length - 1]);

    const sourceMin = fitted.source_bounds.min_m;
    const sourceSize = fitted.source_bounds.dimensions_m;
    const mapPoint = (x, y, z) => [
        targetMin[0] + ((x - sourceMin[0]) / sourceSize[0]) * targetSize[0],
        targetMin[1] + ((y - sourceMin[1]) / sourceSize[1]) * targetSize[1],
        targetMin[2] + ((z - sourceMin[2]) / sourceSize[2]) * targetSize[2],
    ];

    const positions = [];
    const uvs = [];
    renderSections.forEach((section, sectionIndex) => {
        angles.forEach((theta, rayIndex) => {
            const measuredRadius = section.radii[rayIndex];
            const ellipseX = section.centerX + Math.cos(theta) * section.halfX;
            const ellipseZ = section.centerZ + Math.sin(theta) * section.halfZ;
            const measuredX = section.centerX + Math.cos(theta) * measuredRadius;
            const measuredZ = section.centerZ + Math.sin(theta) * measuredRadius;
            let point = mapPoint(
                THREE.MathUtils.lerp(ellipseX, measuredX, radialProfileWeight),
                section.y,
                THREE.MathUtils.lerp(ellipseZ, measuredZ, radialProfileWeight)
            );
            if (deformPoint) {
                point = deformPoint(point, {
                    theta,
                    rayIndex,
                    sectionIndex,
                    sectionFraction: sectionIndex / (renderSections.length - 1),
                }) || point;
            }
            positions.push(...point);
            uvs.push(rayIndex / angles.length, sectionIndex / (renderSections.length - 1));
        });
    });

    const rayCount = angles.length;
    const ringCount = renderSections.length;
    const indices = [];
    for (let ring = 0; ring < ringCount - 1; ring++) {
        for (let ray = 0; ray < rayCount; ray++) {
            const nextRay = (ray + 1) % rayCount;
            const a = ring * rayCount + ray;
            const b = (ring + 1) * rayCount + ray;
            const c = (ring + 1) * rayCount + nextRay;
            const d = ring * rayCount + nextRay;
            indices.push(a, b, c, a, c, d);
        }
    }

    const addCap = (sourceY, section, upper) => {
        let cap = mapPoint(section.centerX, sourceY, section.centerZ);
        if (deformPoint) {
            cap = deformPoint(cap, {
                theta: 0,
                rayIndex: -1,
                sectionIndex: upper ? ringCount - 1 : 0,
                sectionFraction: upper ? 1 : 0,
                isCap: true,
            }) || cap;
        }
        const capIndex = positions.length / 3;
        positions.push(...cap);
        uvs.push(0.5, upper ? 1 : 0);
        const base = upper ? (ringCount - 1) * rayCount : 0;
        for (let ray = 0; ray < rayCount; ray++) {
            const nextRay = (ray + 1) % rayCount;
            if (upper) indices.push(capIndex, base + nextRay, base + ray);
            else indices.push(capIndex, base + ray, base + nextRay);
        }
    };
    addCap(fitted.loft.lower_cap_y_m, renderSections[0], false);
    addCap(fitted.loft.upper_cap_y_m, renderSections[ringCount - 1], true);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.hraFit = {
        source: sourceLabel,
        sections: ringCount,
        rays: rayCount,
        validation: fitted.validation,
    };
    return geometry;
}
