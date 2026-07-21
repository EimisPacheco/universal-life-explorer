// Watertight procedural organ reconstruction from official measured extrema.
// The JSON coefficients are offline atlas measurements; no GLB/OBJ is loaded
// or redistributed by the browser at runtime.

function pchipSlopes(x, values) {
    const interval = x.slice(1).map((value, index) => value - x[index]);
    const delta = interval.map((width, index) =>
        (values[index + 1] - values[index]) / width
    );
    const slopes = new Array(values.length).fill(0);
    for (let index = 1; index < values.length - 1; index++) {
        const before = delta[index - 1];
        const after = delta[index];
        if (before * after <= 0) continue;
        const leftWeight = 2 * interval[index] + interval[index - 1];
        const rightWeight = interval[index] + 2 * interval[index - 1];
        slopes[index] = (leftWeight + rightWeight) /
            (leftWeight / before + rightWeight / after);
    }
    const endpoint = (first) => {
        const current = first ? 0 : delta.length - 1;
        const following = first ? 1 : delta.length - 2;
        const width = interval[current];
        const nextWidth = interval[following];
        let estimate = ((2 * width + nextWidth) * delta[current] -
            width * delta[following]) / (width + nextWidth);
        if (Math.sign(estimate) !== Math.sign(delta[current])) estimate = 0;
        else if (Math.sign(delta[current]) !== Math.sign(delta[following]) &&
            Math.abs(estimate) > 3 * Math.abs(delta[current])) {
            estimate = 3 * delta[current];
        }
        slopes[first ? 0 : values.length - 1] = estimate;
    };
    endpoint(true);
    endpoint(false);
    return slopes;
}

function sampleTrack(x, values, slopes, intervalIndex, amount) {
    const width = x[intervalIndex + 1] - x[intervalIndex];
    const amount2 = amount * amount;
    const amount3 = amount2 * amount;
    return (2 * amount3 - 3 * amount2 + 1) * values[intervalIndex] +
        (amount3 - 2 * amount2 + amount) * width * slopes[intervalIndex] +
        (-2 * amount3 + 3 * amount2) * values[intervalIndex + 1] +
        (amount3 - amount2) * width * slopes[intervalIndex + 1];
}

export function createMeasuredOrganEnvelopeGeometry({
    THREE,
    fitted,
    targetMin,
    targetSize,
    subdivisions = 5,
    radialSegments = 48,
    deformPoint = null,
}) {
    const sections = fitted?.coefficient_model?.sections;
    if (!sections || sections.length < 4) return null;
    if (!Array.isArray(targetMin) || !Array.isArray(targetSize)) return null;
    const keys = [
        'center_x_fraction',
        'center_depth_fraction',
        'half_width_fraction',
        'half_depth_fraction',
    ];
    const vertical = sections.map(section => section.vertical_fraction);
    const values = Object.fromEntries(keys.map(key => [
        key, sections.map(section => section[key]),
    ]));
    const slopes = Object.fromEntries(keys.map(key => [
        key, pchipSlopes(vertical, values[key]),
    ]));
    const renderSections = [];
    for (let interval = 0; interval < sections.length - 1; interval++) {
        for (let subdivision = 0; subdivision < subdivisions; subdivision++) {
            const amount = subdivision / subdivisions;
            const section = {
                vertical_fraction: THREE.MathUtils.lerp(
                    vertical[interval], vertical[interval + 1], amount
                ),
            };
            for (const key of keys) {
                section[key] = sampleTrack(
                    vertical, values[key], slopes[key], interval, amount
                );
            }
            renderSections.push(section);
        }
    }
    renderSections.push({...sections[sections.length - 1]});

    const positions = [];
    const uvs = [];
    const interior = renderSections.slice(1, -1);
    for (let ring = 0; ring < interior.length; ring++) {
        const section = interior[ring];
        for (let radial = 0; radial < radialSegments; radial++) {
            const theta = 2 * Math.PI * radial / radialSegments;
            let point = [
                targetMin[0] + (
                    section.center_x_fraction +
                    Math.cos(theta) * Math.max(0, section.half_width_fraction)
                ) * targetSize[0],
                targetMin[1] + section.vertical_fraction * targetSize[1],
                targetMin[2] + (
                    section.center_depth_fraction +
                    Math.sin(theta) * Math.max(0, section.half_depth_fraction)
                ) * targetSize[2],
            ];
            if (deformPoint) {
                point = deformPoint(point, {
                    theta,
                    radialIndex: radial,
                    ringIndex: ring,
                    sectionFraction: section.vertical_fraction,
                }) || point;
            }
            positions.push(...point);
            uvs.push(radial / radialSegments, section.vertical_fraction);
        }
    }

    const indices = [];
    const ringCount = interior.length;
    for (let ring = 0; ring < ringCount - 1; ring++) {
        const current = ring * radialSegments;
        const following = current + radialSegments;
        for (let radial = 0; radial < radialSegments; radial++) {
            const next = (radial + 1) % radialSegments;
            indices.push(
                current + radial,
                following + radial,
                following + next,
                current + radial,
                following + next,
                current + next,
            );
        }
    }
    const addCap = (section, upper) => {
        let point = [
            targetMin[0] + section.center_x_fraction * targetSize[0],
            targetMin[1] + section.vertical_fraction * targetSize[1],
            targetMin[2] + section.center_depth_fraction * targetSize[2],
        ];
        if (deformPoint) {
            point = deformPoint(point, {
                theta: 0,
                radialIndex: -1,
                ringIndex: upper ? ringCount - 1 : 0,
                sectionFraction: section.vertical_fraction,
                isCap: true,
            }) || point;
        }
        const capIndex = positions.length / 3;
        positions.push(...point);
        uvs.push(0.5, upper ? 1 : 0);
        const base = upper ? (ringCount - 1) * radialSegments : 0;
        for (let radial = 0; radial < radialSegments; radial++) {
            const next = (radial + 1) % radialSegments;
            if (upper) indices.push(capIndex, base + radial, base + next);
            else indices.push(capIndex, base + next, base + radial);
        }
    };
    addCap(renderSections[0], false);
    addCap(renderSections[renderSections.length - 1], true);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.measuredOrganFit = {
        source: fitted.source,
        coefficientModel: fitted.coefficient_model.type,
        sourceValidation: fitted.validation,
        renderSections: renderSections.length,
        radialSegments,
    };
    return geometry;
}
