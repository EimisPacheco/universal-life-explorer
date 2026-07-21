/**
 * Reconstruct a smooth HRA-derived lung envelope from direct X-Z ring tracks.
 *
 * `fitted` is one organ entry from
 * `reference-atlas/fits/hra-female-lung-smooth-tracks.json`.
 * The returned geometry is self-contained and does not load an official mesh.
 */
export function createSmoothLungEnvelopeGeometry({
    THREE,
    fitted,
    targetMin,
    targetSize,
    subdivisions = 4,
    upperCap = false,
    smoothing = 'beauty',
    beautyHarmonics = 2,
    beautyResidualGain = 0.22,
    beautyAxialPasses = 10,
    beautyAxialWeight = 0.22,
    beautyCardinalMode = 'measured',
}) {
    if (!THREE?.BufferGeometry || !THREE?.Float32BufferAttribute) {
        throw new TypeError('THREE with BufferGeometry and Float32BufferAttribute is required');
    }
    if (!fitted?.sections || fitted.sections.length < 4) {
        throw new TypeError('fitted must be a smooth-track organ with at least four sections');
    }
    if (!Array.isArray(targetMin) || targetMin.length !== 3 ||
        !Array.isArray(targetSize) || targetSize.length !== 3) {
        throw new TypeError('targetMin and targetSize must be three-number arrays');
    }
    if (!Number.isInteger(subdivisions) || subdivisions < 1) {
        throw new RangeError('subdivisions must be a positive integer');
    }
    if (!['beauty', 'raw'].includes(smoothing)) {
        throw new RangeError("smoothing must be 'beauty' or 'raw'");
    }

    const sections = fitted.sections;
    const rayCount = sections[0].ring_xz_m?.length;
    const finite = Number.isFinite;
    if (!Number.isInteger(rayCount) || rayCount < 8) {
        throw new TypeError('each fitted section must contain a ring_xz_m array');
    }
    if (rayCount % 4 !== 0) {
        throw new RangeError('beauty smoothing requires a ray count divisible by four');
    }
    if (!Number.isInteger(beautyHarmonics) || beautyHarmonics < 0 || beautyHarmonics >= rayCount / 2) {
        throw new RangeError('beautyHarmonics must be between zero and half the ray count');
    }
    if (!finite(beautyResidualGain) || beautyResidualGain < 0 || beautyResidualGain > 1) {
        throw new RangeError('beautyResidualGain must be between zero and one');
    }
    if (!Number.isInteger(beautyAxialPasses) || beautyAxialPasses < 0) {
        throw new RangeError('beautyAxialPasses must be a non-negative integer');
    }
    if (!finite(beautyAxialWeight) || beautyAxialWeight < 0 || beautyAxialWeight >= 0.5) {
        throw new RangeError('beautyAxialWeight must be in [0, 0.5)');
    }
    if (!['measured', 'global'].includes(beautyCardinalMode)) {
        throw new RangeError("beautyCardinalMode must be 'measured' or 'global'");
    }
    sections.forEach((section, sectionIndex) => {
        if (!finite(section.y_m) || section.ring_xz_m?.length !== rayCount) {
            throw new TypeError(`invalid fitted section ${sectionIndex}`);
        }
        section.ring_xz_m.forEach((point, ray) => {
            if (!Array.isArray(point) || point.length !== 2 || !point.every(finite)) {
                throw new TypeError(`invalid X-Z point at section ${sectionIndex}, ray ${ray}`);
            }
        });
    });
    if (![...targetMin, ...targetSize].every(finite) || targetSize.some(size => size === 0)) {
        throw new RangeError('targetMin/targetSize values must be finite and target sizes non-zero');
    }

    const sourceMin = fitted.source_bounds?.min_m;
    const sourceSize = fitted.source_bounds?.dimensions_m;
    if (!sourceMin || !sourceSize || sourceMin.length !== 3 || sourceSize.length !== 3) {
        throw new TypeError('fitted.source_bounds must include min_m and dimensions_m');
    }
    if (![...sourceMin, ...sourceSize].every(finite) || sourceSize.some(size => size <= 0)) {
        throw new RangeError('fitted source bounds are invalid');
    }

    const preparedSections = smoothing === 'beauty'
        ? createBeautySections(sections, {
            rayCount,
            harmonics: beautyHarmonics,
            residualGain: beautyResidualGain,
            axialPasses: beautyAxialPasses,
            axialWeight: beautyAxialWeight,
            cardinalMode: beautyCardinalMode,
        })
        : sections.map(section => ({
            ...section,
            ring_xz_m: section.ring_xz_m.map(point => [...point]),
        }));

    // The first two nearly coplanar measurement rings created the broad,
    // straight inferior shading band. Ring 2 becomes the rounded cap anchor.
    const lowerAnchorIndex = 2;
    const roundedUpperAnchorIndex = preparedSections.length - 2;
    const lastSidewallIndex = upperCap ? roundedUpperAnchorIndex : preparedSections.length - 1;
    if (lastSidewallIndex <= lowerAnchorIndex) {
        throw new RangeError('not enough measured sections for the requested caps');
    }

    const sidewallSections = preparedSections.slice(lowerAnchorIndex, lastSidewallIndex + 1);
    const sidewallY = sidewallSections.map(section => section.y_m);
    for (let index = 1; index < sidewallY.length; index++) {
        if (!(sidewallY[index] > sidewallY[index - 1])) {
            throw new RangeError('fitted section Y coordinates must increase strictly');
        }
    }

    const sidewallTracks = Array.from({ length: rayCount }, (_, ray) => ({
        x: sidewallSections.map(section => section.ring_xz_m[ray][0]),
        z: sidewallSections.map(section => section.ring_xz_m[ray][1]),
    }));
    const sidewallSlopes = sidewallTracks.map(track => ({
        x: pchipSlopes(sidewallY, track.x),
        z: pchipSlopes(sidewallY, track.z),
    }));

    const sourceRings = [];
    for (let interval = 0; interval < sidewallSections.length - 1; interval++) {
        for (let subdivision = 0; subdivision < subdivisions; subdivision++) {
            const amount = subdivision / subdivisions;
            const y = lerp(sidewallY[interval], sidewallY[interval + 1], amount);
            const xz = sidewallTracks.map((track, ray) => [
                pchipEvaluate(
                    sidewallY[interval],
                    sidewallY[interval + 1],
                    track.x[interval],
                    track.x[interval + 1],
                    sidewallSlopes[ray].x[interval],
                    sidewallSlopes[ray].x[interval + 1],
                    amount,
                ),
                pchipEvaluate(
                    sidewallY[interval],
                    sidewallY[interval + 1],
                    track.z[interval],
                    track.z[interval + 1],
                    sidewallSlopes[ray].z[interval],
                    sidewallSlopes[ray].z[interval + 1],
                    amount,
                ),
            ]);
            sourceRings.push({
                y,
                xz: smoothing === 'beauty' ? clampRingToCardinalEnvelope(xz) : xz,
                kind: 'sidewall',
            });
        }
    }
    sourceRings.push({
        y: sidewallY[sidewallY.length - 1],
        xz: sidewallSections[sidewallSections.length - 1].ring_xz_m.map(point => [...point]),
        kind: 'sidewall',
    });
    if (smoothing === 'beauty') {
        // PCHIP is shape-preserving per scalar track, but the four silhouette
        // tracks can still form a locally twisted quad against an adjacent
        // oblique ray when both coordinates turn in the same short interval.
        // Linear interpolation only on those cardinal tracks is a stable
        // constrained fallback: measured extrema remain exact, no non-cardinal
        // detail is flattened, and the front/profile envelope cannot overshoot.
        const quarter = rayCount / 4;
        for (let interval = 0; interval < sidewallSections.length - 1; interval++) {
            const start = sidewallSections[interval].ring_xz_m;
            const end = sidewallSections[interval + 1].ring_xz_m;
            for (let subdivision = 1; subdivision < subdivisions; subdivision++) {
                const amount = subdivision / subdivisions;
                const ring = sourceRings[interval * subdivisions + subdivision];
                for (const cardinal of [0, quarter, 2 * quarter, 3 * quarter]) {
                    ring.xz[cardinal] = [
                        lerp(start[cardinal][0], end[cardinal][0], amount),
                        lerp(start[cardinal][1], end[cardinal][1], amount),
                    ];
                }
                ring.xz = clampRingToCardinalEnvelope(ring.xz);
            }
        }
    }

    const lowerCapY = fitted.lower_cap_y_m;
    const upperCapY = fitted.upper_cap_y_m;
    if (!finite(lowerCapY) || !finite(upperCapY) || !(lowerCapY < upperCapY)) {
        throw new RangeError('fitted cap Y coordinates are invalid');
    }

    const capRingCount = 6;
    const lowerAnchor = sourceRings[0];
    const lowerCenter = ringCenter(lowerAnchor.xz);
    const lowerIntermediate = roundedCapRings({
        anchor: lowerAnchor,
        center: lowerCenter,
        poleY: lowerCapY,
        ringCount: capRingCount,
        direction: 'lower',
    });
    // `roundedCapRings` returns anchor-to-pole order; reverse it so every ring
    // remains inferior-to-superior before triangulation.
    sourceRings.unshift(...lowerIntermediate.reverse());

    let upperCenter;
    let upperIntermediate = [];
    if (upperCap) {
        const upperAnchor = sourceRings[sourceRings.length - 1];
        upperCenter = ringCenter(upperAnchor.xz);
        upperIntermediate = roundedCapRings({
            anchor: upperAnchor,
            center: upperCenter,
            poleY: upperCapY,
            ringCount: capRingCount,
            direction: 'upper',
        });
        sourceRings.push(...upperIntermediate);
    } else {
        upperCenter = ringCenter(sourceRings[sourceRings.length - 1].xz);
    }

    const mapPoint = (x, y, z) => [
        targetMin[0] + ((x - sourceMin[0]) / sourceSize[0]) * targetSize[0],
        targetMin[1] + ((y - sourceMin[1]) / sourceSize[1]) * targetSize[1],
        targetMin[2] + ((z - sourceMin[2]) / sourceSize[2]) * targetSize[2],
    ];
    const mappedLowerPole = mapPoint(lowerCenter[0], lowerCapY, lowerCenter[1]);
    const mappedUpperPole = mapPoint(upperCenter[0], upperCapY, upperCenter[1]);
    const mappedRings = sourceRings.map(ring => ({
        y: ring.y,
        kind: ring.kind,
        points: ring.xz.map(point => mapPoint(point[0], ring.y, point[1])),
    }));
    const sidewallRenderRingCount = (sidewallSections.length - 1) * subdivisions + 1;
    const foldRepair = smoothing === 'beauty'
        ? repairMappedBeautyFolds(mappedRings, {
            rayCount,
            subdivisions,
            lowerCapRingCount: capRingCount,
            sidewallRenderRingCount,
        })
        : { iterations: 0, foldedQuadCount: null };

    // Duplicate ray 0 at the end of each vertex row. This makes U continuous
    // across the texture seam while retaining exactly 48 geometric rays.
    const verticesPerRing = rayCount + 1;
    const positions = [];
    const uvs = [];
    const mappedLowerY = mappedLowerPole[1];
    const mappedUpperY = mappedUpperPole[1];
    const mappedYSpan = mappedUpperY - mappedLowerY;
    mappedRings.forEach(ring => {
        const v = mappedYSpan === 0 ? 0.5 : (ring.points[0][1] - mappedLowerY) / mappedYSpan;
        for (let ray = 0; ray <= rayCount; ray++) {
            const point = ring.points[ray % rayCount];
            positions.push(...point);
            uvs.push(ray / rayCount, v);
        }
    });

    const indices = [];
    let alternateDiagonalCount = 0;
    let foldedQuadCount = 0;
    for (let ring = 0; ring < mappedRings.length - 1; ring++) {
        for (let ray = 0; ray < rayCount; ray++) {
            const a = ring * verticesPerRing + ray;
            const b = (ring + 1) * verticesPerRing + ray;
            const c = (ring + 1) * verticesPerRing + ray + 1;
            const d = ring * verticesPerRing + ray + 1;
            const first = quadNormalAgreement(positions, a, b, c, d, false);
            const second = quadNormalAgreement(positions, a, b, c, d, true);
            if (Math.max(first, second) <= 0) foldedQuadCount++;
            if (second > first) {
                indices.push(a, b, d, b, c, d);
                alternateDiagonalCount++;
            } else {
                indices.push(a, b, c, a, c, d);
            }
        }
    }

    const lowerPoleIndex = positions.length / 3;
    positions.push(...mappedLowerPole);
    uvs.push(0.5, 0);
    const firstRing = 0;
    for (let ray = 0; ray < rayCount; ray++) {
        indices.push(lowerPoleIndex, firstRing + ray + 1, firstRing + ray);
    }

    const upperPoleIndex = positions.length / 3;
    positions.push(...mappedUpperPole);
    uvs.push(0.5, 1);
    const finalRing = (mappedRings.length - 1) * verticesPerRing;
    for (let ray = 0; ray < rayCount; ray++) {
        indices.push(upperPoleIndex, finalRing + ray, finalRing + ray + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.hraSmoothEnvelope = {
        source: 'HuBMAP HRA female lung smooth-track fit',
        algorithm: smoothing === 'beauty'
            ? 'cardinal-locked Fourier/axial fairing; mapped fold repair; six-ring basal cap'
            : 'direct X-Z PCHIP tracks; six-ring basal cap; adaptive quad diagonals',
        measuredSectionCount: sections.length,
        sidewallMeasuredRange: [lowerAnchorIndex, lastSidewallIndex],
        subdivisions,
        rayCount,
        renderRingCount: mappedRings.length,
        roundedBasalCapRings: capRingCount,
        roundedUpperCap: Boolean(upperCap),
        roundedUpperCapRings: upperCap ? capRingCount : 0,
        smoothing,
        beautySmoothing: smoothing === 'beauty' ? {
            harmonics: beautyHarmonics,
            residualGain: beautyResidualGain,
            axialPasses: beautyAxialPasses,
            axialWeight: beautyAxialWeight,
            cardinalMode: beautyCardinalMode,
            cardinalExtremaLocked: beautyCardinalMode === 'measured',
            globalEnvelopeLocked: beautyCardinalMode === 'global',
            foldRepairIterations: foldRepair.iterations,
            foldRepairRemainingQuads: foldRepair.foldedQuadCount,
        } : null,
        alternateDiagonalCount,
        foldedQuadCount,
        targetMin: [...targetMin],
        targetSize: [...targetSize],
    };
    return geometry;
}

function createBeautySections(sections, {
    rayCount,
    harmonics,
    residualGain,
    axialPasses,
    axialWeight,
    cardinalMode,
}) {
    const rawRings = sections.map(section => section.ring_xz_m.map(point => [...point]));
    const rawScaffolds = rawRings.map(cardinalEnvelopeScaffold);
    let smoothScaffolds = rawScaffolds.map(values => [...values]);
    for (let pass = 0; pass < axialPasses; pass++) {
        smoothScaffolds = smoothAxialValues(smoothScaffolds, axialWeight);
    }
    const rawEllipseRings = rawScaffolds.map((scaffold, sectionIndex) =>
        ellipseFromScaffold(scaffold, rawRings[sectionIndex].length));
    const smoothEllipseRings = smoothScaffolds.map((scaffold, sectionIndex) =>
        ellipseFromScaffold(scaffold, rawRings[sectionIndex].length));

    let residuals = rawRings.map((ring, sectionIndex) => {
        const ellipse = rawEllipseRings[sectionIndex];
        const residualX = ring.map((point, ray) => point[0] - ellipse[ray][0]);
        const residualZ = ring.map((point, ray) => point[1] - ellipse[ray][1]);
        const filteredX = periodicLowPass(residualX, harmonics);
        const filteredZ = periodicLowPass(residualZ, harmonics);
        return Array.from({ length: rayCount }, (_, ray) => [filteredX[ray], filteredZ[ray]]);
    });

    // Smooth only the detail field through anatomical Y. The ellipse/cardinal
    // scaffold stays untouched, so every official per-plane front/profile
    // extremum remains exact while transverse track chatter is attenuated.
    for (let pass = 0; pass < axialPasses; pass++) {
        residuals = smoothAxialValues(residuals, axialWeight);
    }

    const prepared = sections.map((section, sectionIndex) => {
        const raw = rawRings[sectionIndex];
        const ellipse = smoothEllipseRings[sectionIndex];
        const ring = ellipse.map((point, ray) => [
            point[0] + residualGain * residuals[sectionIndex][ray][0],
            point[1] + residualGain * residuals[sectionIndex][ray][1],
        ]);
        // `measured` is the validation mode: every sampled front/profile
        // extremum is locked. `global` is the presentation mode: it allows the
        // measured cardinal tracks to be smoothed through Y, then restores the
        // official whole-organ X/Z envelope. The latter removes slice bands
        // while retaining the HRA organ's overall width, depth and laterality.
        const constrained = cardinalMode === 'measured'
            ? clampRingToCardinalEnvelope(forceCardinalPoints(ring, raw))
            : clampRingToCardinalEnvelope(ring);
        return { ...section, ring_xz_m: constrained };
    });
    return cardinalMode === 'global'
        ? restoreGlobalEnvelope(prepared, rawRings)
        : prepared;
}

function restoreGlobalEnvelope(preparedSections, rawRings) {
    const bounds = rings => {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const ring of rings) {
            const points = ring.ring_xz_m || ring;
            for (const point of points) {
                minX = Math.min(minX, point[0]);
                maxX = Math.max(maxX, point[0]);
                minZ = Math.min(minZ, point[1]);
                maxZ = Math.max(maxZ, point[1]);
            }
        }
        return { minX, maxX, minZ, maxZ };
    };
    const raw = bounds(rawRings);
    const smooth = bounds(preparedSections);
    const smoothWidth = Math.max(1e-8, smooth.maxX - smooth.minX);
    const smoothDepth = Math.max(1e-8, smooth.maxZ - smooth.minZ);
    return preparedSections.map(section => ({
        ...section,
        ring_xz_m: section.ring_xz_m.map(point => [
            raw.minX + ((point[0] - smooth.minX) / smoothWidth) * (raw.maxX - raw.minX),
            raw.minZ + ((point[1] - smooth.minZ) / smoothDepth) * (raw.maxZ - raw.minZ),
        ]),
    }));
}

function cardinalEnvelopeScaffold(ring) {
    const rayCount = ring.length;
    const quarter = rayCount / 4;
    const positiveX = ring[0];
    const positiveZ = ring[quarter];
    const negativeX = ring[2 * quarter];
    const negativeZ = ring[3 * quarter];
    const minX = Math.min(positiveX[0], negativeX[0]);
    const maxX = Math.max(positiveX[0], negativeX[0]);
    const minZ = Math.min(positiveZ[1], negativeZ[1]);
    const maxZ = Math.max(positiveZ[1], negativeZ[1]);
    return [
        (minX + maxX) * 0.5,
        (minZ + maxZ) * 0.5,
        Math.max(1e-8, (maxX - minX) * 0.5),
        Math.max(1e-8, (maxZ - minZ) * 0.5),
    ];
}

function ellipseFromScaffold([centerX, centerZ, halfX, halfZ], rayCount) {
    return Array.from({ length: rayCount }, (_, ray) => {
        const angle = 2 * Math.PI * ray / rayCount;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const radius = 1 / Math.sqrt(
            (cosine / halfX) ** 2 + (sine / halfZ) ** 2,
        );
        return [centerX + cosine * radius, centerZ + sine * radius];
    });
}

function smoothAxialValues(values, weight) {
    return values.map((value, sectionIndex) => {
        if (sectionIndex === 0 || sectionIndex === values.length - 1) {
            return cloneNumericTree(value);
        }
        return blendNumericTrees(
            values[sectionIndex - 1],
            value,
            values[sectionIndex + 1],
            weight,
        );
    });
}

function cloneNumericTree(value) {
    return Array.isArray(value) ? value.map(cloneNumericTree) : value;
}

function blendNumericTrees(previous, current, next, weight) {
    if (!Array.isArray(current)) {
        return weight * previous + (1 - 2 * weight) * current + weight * next;
    }
    return current.map((value, index) =>
        blendNumericTrees(previous[index], value, next[index], weight));
}

function forceCardinalPoints(ring, targetRing) {
    const result = ring.map(point => [...point]);
    const quarter = result.length / 4;
    for (let quadrant = 0; quadrant < 4; quadrant++) {
        const start = quadrant * quarter;
        const end = (start + quarter) % result.length;
        const startDelta = [
            targetRing[start][0] - result[start][0],
            targetRing[start][1] - result[start][1],
        ];
        const endDelta = [
            targetRing[end][0] - result[end][0],
            targetRing[end][1] - result[end][1],
        ];
        for (let offset = 0; offset <= quarter; offset++) {
            const amount = offset / quarter;
            const eased = 0.5 - 0.5 * Math.cos(Math.PI * amount);
            const ray = (start + offset) % result.length;
            result[ray][0] += startDelta[0] * (1 - eased) + endDelta[0] * eased;
            result[ray][1] += startDelta[1] * (1 - eased) + endDelta[1] * eased;
        }
    }
    for (const cardinal of [0, quarter, 2 * quarter, 3 * quarter]) {
        result[cardinal] = [...targetRing[cardinal]];
    }
    return result;
}

function periodicLowPass(values, harmonics) {
    const count = values.length;
    const cosineCoefficients = new Array(harmonics + 1).fill(0);
    const sineCoefficients = new Array(harmonics + 1).fill(0);
    cosineCoefficients[0] = values.reduce((sum, value) => sum + value, 0) / count;
    for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
        let cosineSum = 0;
        let sineSum = 0;
        for (let sample = 0; sample < count; sample++) {
            const angle = 2 * Math.PI * harmonic * sample / count;
            cosineSum += values[sample] * Math.cos(angle);
            sineSum += values[sample] * Math.sin(angle);
        }
        cosineCoefficients[harmonic] = 2 * cosineSum / count;
        sineCoefficients[harmonic] = 2 * sineSum / count;
    }
    return Array.from({ length: count }, (_, sample) => {
        let value = cosineCoefficients[0];
        for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
            const angle = 2 * Math.PI * harmonic * sample / count;
            value += cosineCoefficients[harmonic] * Math.cos(angle) +
                sineCoefficients[harmonic] * Math.sin(angle);
        }
        return value;
    });
}

function constrainResidualCardinals(residual) {
    const result = residual.map(point => [...point]);
    const quarter = result.length / 4;
    for (let quadrant = 0; quadrant < 4; quadrant++) {
        const start = quadrant * quarter;
        const end = (start + quarter) % result.length;
        const startError = [...result[start]];
        const endError = [...result[end]];
        for (let offset = 0; offset <= quarter; offset++) {
            const amount = offset / quarter;
            const eased = 0.5 - 0.5 * Math.cos(Math.PI * amount);
            const ray = (start + offset) % result.length;
            result[ray][0] -= startError[0] * (1 - eased) + endError[0] * eased;
            result[ray][1] -= startError[1] * (1 - eased) + endError[1] * eased;
        }
    }
    for (const cardinal of [0, quarter, 2 * quarter, 3 * quarter]) {
        result[cardinal] = [0, 0];
    }
    return result;
}

function clampRingToCardinalEnvelope(ring) {
    const result = ring.map(point => [...point]);
    const quarter = result.length / 4;
    const cardinals = [
        [...result[0]],
        [...result[quarter]],
        [...result[2 * quarter]],
        [...result[3 * quarter]],
    ];
    const minX = Math.min(cardinals[0][0], cardinals[2][0]);
    const maxX = Math.max(cardinals[0][0], cardinals[2][0]);
    const minZ = Math.min(cardinals[1][1], cardinals[3][1]);
    const maxZ = Math.max(cardinals[1][1], cardinals[3][1]);
    for (const point of result) {
        point[0] = Math.max(minX, Math.min(maxX, point[0]));
        point[1] = Math.max(minZ, Math.min(maxZ, point[1]));
    }
    result[0] = cardinals[0];
    result[quarter] = cardinals[1];
    result[2 * quarter] = cardinals[2];
    result[3 * quarter] = cardinals[3];
    return result;
}

/**
 * Remove the rare twisted quad that can survive independent PCHIP tracks.
 *
 * The repair is deliberately local and runs after non-uniform target mapping,
 * where a fold actually matters to the rendered geometry. It attracts only a
 * small neighbourhood around a folded edge toward the smooth ellipse defined
 * by that row's four cardinal extrema. Official measured cardinal samples are
 * immutable, so front/profile silhouettes and their anatomical Y positions do
 * not move.
 */
function repairMappedBeautyFolds(mappedRings, {
    rayCount,
    subdivisions,
    lowerCapRingCount,
    sidewallRenderRingCount,
    maxIterations = 12,
}) {
    const quarter = rayCount / 4;
    const sidewallStart = lowerCapRingCount;
    const sidewallEnd = sidewallStart + sidewallRenderRingCount - 1;
    const angularWeights = [
        [-2, 0.25],
        [-1, 0.60],
        [0, 1.00],
        [1, 1.00],
        [2, 0.60],
        [3, 0.25],
    ];
    let folded = findMappedFoldedQuads(mappedRings, rayCount);
    let iterations = 0;

    while (folded.length > 0 && iterations < maxIterations) {
        const ellipseTargets = mappedRings.map(ring =>
            mappedCardinalEllipse(ring.points, rayCount));
        const weights = mappedRings.map(() => new Float64Array(rayCount));

        for (const { ring, ray } of folded) {
            for (let rowOffset = -1; rowOffset <= 2; rowOffset++) {
                const row = ring + rowOffset;
                if (row < 0 || row >= mappedRings.length) continue;
                const rowWeight = rowOffset === 0 || rowOffset === 1 ? 0.24 : 0.12;
                for (const [rayOffset, angularWeight] of angularWeights) {
                    const affectedRay = (ray + rayOffset + rayCount) % rayCount;
                    const measuredSidewallRow = row >= sidewallStart && row <= sidewallEnd &&
                        (row - sidewallStart) % subdivisions === 0;
                    const lockedCardinal = measuredSidewallRow && affectedRay % quarter === 0;
                    if (lockedCardinal) continue;
                    weights[row][affectedRay] = Math.max(
                        weights[row][affectedRay],
                        rowWeight * angularWeight,
                    );
                }
            }
        }

        mappedRings.forEach((ring, row) => {
            for (let ray = 0; ray < rayCount; ray++) {
                const weight = weights[row][ray];
                if (weight === 0) continue;
                const point = ring.points[ray];
                const target = ellipseTargets[row][ray];
                point[0] = lerp(point[0], target[0], weight);
                point[2] = lerp(point[2], target[2], weight);
            }
            ring.points = clampMappedRingToCardinalEnvelope(ring.points);
        });

        iterations++;
        folded = findMappedFoldedQuads(mappedRings, rayCount);
    }

    return { iterations, foldedQuadCount: folded.length };
}

function mappedCardinalEllipse(points, rayCount) {
    const quarter = rayCount / 4;
    const positiveX = points[0];
    const positiveZ = points[quarter];
    const negativeX = points[2 * quarter];
    const negativeZ = points[3 * quarter];
    const centerX = (positiveX[0] + negativeX[0]) * 0.5;
    const centerZ = (positiveZ[2] + negativeZ[2]) * 0.5;
    const halfX = Math.max(1e-8, Math.abs(positiveX[0] - negativeX[0]) * 0.5);
    const halfZ = Math.max(1e-8, Math.abs(positiveZ[2] - negativeZ[2]) * 0.5);
    const xDirection = Math.sign(positiveX[0] - negativeX[0]) || 1;
    const zDirection = Math.sign(positiveZ[2] - negativeZ[2]) || 1;
    return Array.from({ length: rayCount }, (_, ray) => {
        const angle = 2 * Math.PI * ray / rayCount;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const radius = 1 / Math.sqrt(
            (cosine / halfX) ** 2 + (sine / halfZ) ** 2,
        );
        return [
            centerX + xDirection * cosine * radius,
            points[ray][1],
            centerZ + zDirection * sine * radius,
        ];
    });
}

function clampMappedRingToCardinalEnvelope(points) {
    const result = points.map(point => [...point]);
    const quarter = result.length / 4;
    const cardinals = [
        [...result[0]],
        [...result[quarter]],
        [...result[2 * quarter]],
        [...result[3 * quarter]],
    ];
    const minX = Math.min(cardinals[0][0], cardinals[2][0]);
    const maxX = Math.max(cardinals[0][0], cardinals[2][0]);
    const minZ = Math.min(cardinals[1][2], cardinals[3][2]);
    const maxZ = Math.max(cardinals[1][2], cardinals[3][2]);
    for (const point of result) {
        point[0] = Math.max(minX, Math.min(maxX, point[0]));
        point[2] = Math.max(minZ, Math.min(maxZ, point[2]));
    }
    result[0] = cardinals[0];
    result[quarter] = cardinals[1];
    result[2 * quarter] = cardinals[2];
    result[3 * quarter] = cardinals[3];
    return result;
}

function findMappedFoldedQuads(mappedRings, rayCount) {
    const folded = [];
    for (let ring = 0; ring < mappedRings.length - 1; ring++) {
        for (let ray = 0; ray < rayCount; ray++) {
            const nextRay = (ray + 1) % rayCount;
            const a = mappedRings[ring].points[ray];
            const b = mappedRings[ring + 1].points[ray];
            const c = mappedRings[ring + 1].points[nextRay];
            const d = mappedRings[ring].points[nextRay];
            const first = quadPointNormalAgreement(a, b, c, d, false);
            const second = quadPointNormalAgreement(a, b, c, d, true);
            if (Math.max(first, second) <= 0) folded.push({ ring, ray });
        }
    }
    return folded;
}

function quadPointNormalAgreement(a, b, c, d, alternate) {
    const first = alternate ? trianglePointNormal(a, b, d) : trianglePointNormal(a, b, c);
    const second = alternate ? trianglePointNormal(b, c, d) : trianglePointNormal(a, c, d);
    const firstLength = Math.hypot(first[0], first[1], first[2]);
    const secondLength = Math.hypot(second[0], second[1], second[2]);
    if (firstLength === 0 || secondLength === 0) return -1;
    return (first[0] * second[0] + first[1] * second[1] + first[2] * second[2]) /
        (firstLength * secondLength);
}

function trianglePointNormal(a, b, c) {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    return [
        aby * acz - abz * acy,
        abz * acx - abx * acz,
        abx * acy - aby * acx,
    ];
}

function roundedCapRings({ anchor, center, poleY, ringCount, direction }) {
    const rings = [];
    // Six non-degenerate rings lie strictly between the measured anchor and
    // pole. The pole itself is emitted as a single fan vertex later.
    for (let step = 1; step <= ringCount; step++) {
        const amount = step / (ringCount + 1);
        const eased = amount * amount * (3 - 2 * amount);
        const radialScale = Math.sqrt(Math.max(0, 1 - eased * eased));
        const y = lerp(anchor.y, poleY, eased);
        const xz = anchor.xz.map(point => [
            center[0] + radialScale * (point[0] - center[0]),
            center[1] + radialScale * (point[1] - center[1]),
        ]);
        rings.push({ y, xz, kind: direction === 'lower' ? 'basal-cap' : 'apical-cap' });
    }
    return rings;
}

function ringCenter(points) {
    const center = points.reduce(
        (sum, point) => [sum[0] + point[0], sum[1] + point[1]],
        [0, 0],
    );
    return [center[0] / points.length, center[1] / points.length];
}

function pchipSlopes(x, values) {
    const count = x.length;
    const interval = Array.from({ length: count - 1 }, (_, index) => x[index + 1] - x[index]);
    const delta = interval.map((width, index) => (values[index + 1] - values[index]) / width);
    const slopes = new Array(count).fill(0);
    for (let index = 1; index < count - 1; index++) {
        if (delta[index - 1] * delta[index] <= 0) {
            slopes[index] = 0;
            continue;
        }
        const leftWeight = 2 * interval[index] + interval[index - 1];
        const rightWeight = interval[index] + 2 * interval[index - 1];
        slopes[index] = (leftWeight + rightWeight) /
            (leftWeight / delta[index - 1] + rightWeight / delta[index]);
    }
    slopes[0] = endpointSlope(interval[0], interval[1], delta[0], delta[1]);
    slopes[count - 1] = endpointSlope(
        interval[count - 2],
        interval[count - 3],
        delta[count - 2],
        delta[count - 3],
    );
    return slopes;
}

function endpointSlope(firstInterval, secondInterval, firstDelta, secondDelta) {
    let slope = ((2 * firstInterval + secondInterval) * firstDelta -
        firstInterval * secondDelta) / (firstInterval + secondInterval);
    if (Math.sign(slope) !== Math.sign(firstDelta)) return 0;
    if (Math.sign(firstDelta) !== Math.sign(secondDelta) && Math.abs(slope) > 3 * Math.abs(firstDelta)) {
        slope = 3 * firstDelta;
    }
    return slope;
}

function pchipEvaluate(x0, x1, y0, y1, slope0, slope1, amount) {
    const width = x1 - x0;
    const amount2 = amount * amount;
    const amount3 = amount2 * amount;
    return (2 * amount3 - 3 * amount2 + 1) * y0 +
        (amount3 - 2 * amount2 + amount) * width * slope0 +
        (-2 * amount3 + 3 * amount2) * y1 +
        (amount3 - amount2) * width * slope1;
}

function quadNormalAgreement(positions, a, b, c, d, alternate) {
    const first = alternate ? triangleNormal(positions, a, b, d) : triangleNormal(positions, a, b, c);
    const second = alternate ? triangleNormal(positions, b, c, d) : triangleNormal(positions, a, c, d);
    const firstLength = Math.hypot(first[0], first[1], first[2]);
    const secondLength = Math.hypot(second[0], second[1], second[2]);
    if (firstLength === 0 || secondLength === 0) return -1;
    return (first[0] * second[0] + first[1] * second[1] + first[2] * second[2]) /
        (firstLength * secondLength);
}

function triangleNormal(positions, a, b, c) {
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const abx = positions[b * 3] - ax;
    const aby = positions[b * 3 + 1] - ay;
    const abz = positions[b * 3 + 2] - az;
    const acx = positions[c * 3] - ax;
    const acy = positions[c * 3 + 1] - ay;
    const acz = positions[c * 3 + 2] - az;
    return [
        aby * acz - abz * acy,
        abz * acx - abx * acz,
        abx * acy - aby * acx,
    ];
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

export default createSmoothLungEnvelopeGeometry;
