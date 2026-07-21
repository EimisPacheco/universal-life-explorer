import * as THREE from 'three';

// Runtime geometry remains procedural. The official HRA mesh is used only by
// the offline fitter; this module consumes its compact contour/landmark JSON.
export const DEFAULT_PELVIS_COEFFICIENTS_URL = new URL(
    './reference-atlas/fits/hra-female-pelvis-front.json',
    import.meta.url,
);

const EPSILON = 1e-9;

function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
    const amount = clamp((value - edge0) / Math.max(edge1 - edge0, EPSILON));
    return amount * amount * (3 - 2 * amount);
}

function finiteNumber(value, label) {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
    return value;
}

function vector(values, length, label) {
    if (!Array.isArray(values) || values.length < length) {
        throw new TypeError(`${label} must contain at least ${length} numbers`);
    }
    return values.slice(0, length).map((value, index) => finiteNumber(value, `${label}[${index}]`));
}

function contour(values, label) {
    if (!Array.isArray(values) || values.length < 3) {
        throw new TypeError(`${label} must contain at least three XY points`);
    }
    return values.map((point, index) => vector(point, 2, `${label}[${index}]`));
}

function signedArea(points) {
    let sum = 0;
    for (let index = 0; index < points.length; index++) {
        const next = points[(index + 1) % points.length];
        sum += points[index][0] * next[1] - next[0] * points[index][1];
    }
    return sum * 0.5;
}

function withWinding(points, clockwise) {
    const isClockwise = signedArea(points) < 0;
    return isClockwise === clockwise ? points : [...points].reverse();
}

function makeClosedPath(PathType, points) {
    const path = new PathType();
    path.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) path.lineTo(points[index][0], points[index][1]);
    path.closePath();
    return path;
}

function makeShape(frontModel, label) {
    const outer = withWinding(contour(frontModel.outer_contour_xy_m, `${label}.outer`), true);
    const shape = makeClosedPath(THREE.Shape, outer);
    const holes = Array.isArray(frontModel.holes) ? frontModel.holes : [];
    holes.forEach((hole, index) => {
        const points = withWinding(
            contour(hole.contour_xy_m, `${label}.holes[${index}]`),
            false,
        );
        shape.holes.push(makeClosedPath(THREE.Path, points));
    });
    return shape;
}

function validateDocument(document) {
    if (!document || typeof document !== 'object') throw new TypeError('pelvis coefficients must be an object');
    const hips = document.fit?.hip_bones;
    const axial = document.fit?.axial_bones;
    if (!hips?.left || !hips?.right || !axial?.sacrum || !axial?.coccyx) {
        throw new TypeError('pelvis coefficients are missing bilateral hip, sacrum, or coccyx fits');
    }
    if (!String(document.coordinate_frame?.x_positive).includes('anatomical left')) {
        throw new Error('pelvis coefficients must use +X as anatomical patient-left');
    }
    const leftCenter = vector(
        hips.left.landmarks?.acetabulum?.triradiate_center_m,
        3,
        'left acetabular center',
    );
    const rightCenter = vector(
        hips.right.landmarks?.acetabulum?.triradiate_center_m,
        3,
        'right acetabular center',
    );
    if (!(leftCenter[0] > rightCenter[0])) {
        throw new Error('coefficient laterality is reversed: patient-left acetabulum must have greater X');
    }
    for (const side of ['left', 'right']) {
        makeShape(hips[side].frontal_plate, `${side} hip`);
        if (hips[side].laterality !== side) throw new Error(`${side} hip laterality metadata is inconsistent`);
    }
    makeShape(axial.sacrum.frontal_plate, 'sacrum');
    makeShape(axial.coccyx.frontal_plate, 'coccyx');
    vector(document.source_bounds?.center_m, 3, 'source_bounds.center_m');
    return document;
}

function smoothProfile(profile, passes = 2) {
    if (!Array.isArray(profile) || profile.length < 2) {
        throw new TypeError('depth profile must contain at least two samples');
    }
    const samples = profile
        .map((entry, index) => ({
            y: finiteNumber(entry.y_center_m, `depth profile[${index}].y_center_m`),
            z: finiteNumber(entry.median_z_m, `depth profile[${index}].median_z_m`),
        }))
        .sort((left, right) => left.y - right.y);
    for (let pass = 0; pass < passes; pass++) {
        const old = samples.map(entry => entry.z);
        for (let index = 1; index < samples.length - 1; index++) {
            samples[index].z = old[index - 1] * 0.22 + old[index] * 0.56 + old[index + 1] * 0.22;
        }
    }
    return samples;
}

function sampleProfile(samples, y) {
    if (y <= samples[0].y) return samples[0].z;
    if (y >= samples[samples.length - 1].y) return samples[samples.length - 1].z;
    for (let index = 1; index < samples.length; index++) {
        if (y > samples[index].y) continue;
        const previous = samples[index - 1];
        const following = samples[index];
        const amount = (y - previous.y) / Math.max(following.y - previous.y, EPSILON);
        return THREE.MathUtils.lerp(previous.z, following.z, amount);
    }
    return samples[samples.length - 1].z;
}

function boundsValues(report, label) {
    const minimum = vector(report?.min_m, 3, `${label}.min_m`);
    const maximum = vector(report?.max_m, 3, `${label}.max_m`);
    return { minimum, maximum, dimensions: maximum.map((value, index) => value - minimum[index]) };
}

function deformPlateGeometry(geometry, settings) {
    const position = geometry.attributes.position;
    const profile = smoothProfile(settings.depthProfile, settings.profileSmoothingPasses);
    const nominalHalfSpan = settings.depth * 0.5 + settings.bevelThickness;
    for (let index = 0; index < position.count; index++) {
        const x = position.getX(index);
        const y = position.getY(index);
        const sourceZ = position.getZ(index);
        const sideAmount = clamp(
            (sourceZ - settings.depth * 0.5) / Math.max(nominalHalfSpan, EPSILON),
            -1,
            1,
        );
        const curvature = settings.curvature ? settings.curvature(x, y) : 0;
        const thicknessScale = settings.thicknessScale ? settings.thicknessScale(x, y) : 1;
        const halfDepth = settings.depth * 0.5 * thicknessScale + settings.bevelThickness;
        const centerZ = sampleProfile(profile, y) + curvature;
        position.setZ(index, centerZ + sideAmount * halfDepth);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

function hipDeformers(hip, side, midsagittalX) {
    const bounds = boundsValues(hip.source_bounds, `${side} hip bounds`);
    const direction = side === 'left' ? 1 : -1;
    const lateralEdge = direction > 0 ? bounds.maximum[0] : bounds.minimum[0];
    const lateralSpan = Math.max(direction * (lateralEdge - midsagittalX), 0.04);
    const acetabulum = vector(
        hip.landmarks.acetabulum.triradiate_center_m,
        3,
        `${side} acetabular center`,
    );
    const radii = vector(hip.landmarks.acetabulum.rim_radius_xy_m, 2, `${side} acetabular radii`);
    const asis = vector(
        hip.landmarks.iliac_crest.anterior_superior_iliac_spine_proxy_m,
        3,
        `${side} ASIS proxy`,
    );

    const normalized = (x, y) => ({
        lateral: clamp(direction * (x - midsagittalX) / lateralSpan),
        superior: clamp((y - bounds.minimum[1]) / Math.max(bounds.dimensions[1], EPSILON)),
    });
    const curvature = (x, y) => {
        const { lateral, superior } = normalized(x, y);
        const wing = smoothstep(0.42, 0.78, superior);
        const bowlCoordinate = clamp((lateral - 0.55) / 0.55, -1, 1);
        const iliacBowl = -0.0085 * wing * (1 - bowlCoordinate * bowlCoordinate);
        const lateralFlare = 0.0095 * wing * Math.pow(lateral, 1.75);
        const asisDistance =
            ((x - asis[0]) / 0.022) ** 2 + ((y - asis[1]) / 0.018) ** 2;
        const asisProminence = Math.exp(-asisDistance) * 0.0045;
        return iliacBowl + lateralFlare + asisProminence;
    };
    const thicknessScale = (x, y) => {
        const { superior } = normalized(x, y);
        const acetabularDistance =
            ((x - acetabulum[0]) / Math.max(radii[0] * 1.25, EPSILON)) ** 2
            + ((y - acetabulum[1]) / Math.max(radii[1] * 1.25, EPSILON)) ** 2;
        const socketButtress = Math.exp(-acetabularDistance) * 0.62;
        return 0.72 + smoothstep(0.48, 0.88, superior) * 0.18 + socketButtress;
    };
    return { curvature, thicknessScale };
}

function createPlate(frontModel, depthProfile, settings, material) {
    const shape = makeShape(frontModel, settings.name);
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: settings.depth,
        steps: 1,
        curveSegments: 1,
        bevelEnabled: settings.bevelThickness > 0,
        bevelSegments: settings.bevelSegments,
        bevelSize: settings.bevelSize,
        bevelThickness: settings.bevelThickness,
    });
    deformPlateGeometry(geometry, {
        depth: settings.depth,
        bevelThickness: settings.bevelThickness,
        profileSmoothingPasses: settings.profileSmoothingPasses,
        depthProfile,
        curvature: settings.curvature,
        thicknessScale: settings.thicknessScale,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = settings.name;
    mesh.castShadow = settings.castShadow;
    mesh.receiveShadow = settings.receiveShadow;
    mesh.userData.organId = 'pelvis';
    if (settings.laterality) mesh.userData.anatomicalSide = settings.laterality;
    return mesh;
}

function makeBoneMaterial(options, ownedMaterials) {
    if (options.materials?.bone) return options.materials.bone;
    const material = new THREE.MeshPhysicalMaterial({
        color: options.boneColor ?? 0xd8c9ab,
        roughness: options.boneRoughness ?? 0.70,
        metalness: 0,
        clearcoat: 0.07,
        clearcoatRoughness: 0.68,
        sheen: 0.20,
        sheenRoughness: 0.78,
        sheenColor: new THREE.Color(options.boneColor ?? 0xd8c9ab).offsetHSL(0, -0.08, 0.08),
        envMapIntensity: options.envMapIntensity ?? 0.72,
        side: THREE.FrontSide,
    });
    ownedMaterials.add(material);
    return material;
}

function makeInnerMaterial(options, ownedMaterials) {
    if (options.materials?.innerBone) return options.materials.innerBone;
    const material = new THREE.MeshPhysicalMaterial({
        color: options.innerBoneColor ?? 0x9b8668,
        roughness: 0.86,
        metalness: 0,
        clearcoat: 0.02,
        envMapIntensity: 0.48,
        side: THREE.DoubleSide,
    });
    ownedMaterials.add(material);
    return material;
}

function hipFrontZ(hip, side, midsagittalX, x, y, hipDepth, smoothingPasses) {
    const deformers = hipDeformers(hip, side, midsagittalX);
    const profile = smoothProfile(hip.depth_profile_by_superior_fraction, smoothingPasses);
    return sampleProfile(profile, y) + deformers.curvature(x, y) + hipDepth * 0.5;
}

function addAcetabulum(group, hip, side, options, materials, midsagittalX) {
    const landmark = hip.landmarks.acetabulum;
    const center = vector(landmark.triradiate_center_m, 3, `${side} acetabular center`);
    const radii = vector(landmark.rim_radius_xy_m, 2, `${side} acetabular radii`);
    const sourceOverlay = finiteNumber(
        landmark.suggested_front_overlay_z_m,
        `${side} acetabular front overlay`,
    );
    const plateFront = hipFrontZ(
        hip,
        side,
        midsagittalX,
        center[0],
        center[1],
        options.hipDepthM,
        options.profileSmoothingPasses,
    );
    const overlayBlend = clamp(options.acetabularSourceDepthBlend, 0, 1);
    const centerZ = THREE.MathUtils.lerp(plateFront + 0.0015, sourceOverlay, overlayBlend);
    const meanRadius = (radii[0] + radii[1]) * 0.5;
    const rimGeometry = new THREE.TorusGeometry(
        meanRadius,
        options.acetabularRimTubeM,
        options.acetabularRadialSegments,
        options.acetabularTubularSegments,
    );
    rimGeometry.scale(radii[0] / meanRadius, radii[1] / meanRadius, 1);
    const rim = new THREE.Mesh(rimGeometry, materials.bone);
    rim.name = `${side === 'left' ? 'Left' : 'Right'} acetabular rim`;
    const tilt = (side === 'left' ? 1 : -1) * options.acetabularTiltRad;
    rim.rotation.y = tilt;
    rim.position.set(center[0], center[1], centerZ);
    rim.castShadow = options.castShadow;
    rim.receiveShadow = options.receiveShadow;
    rim.userData.organId = 'pelvis';
    rim.userData.anatomicalSide = side;
    group.add(rim);

    if (options.includeAcetabularCups) {
        const cupGeometry = new THREE.CircleGeometry(1, options.acetabularTubularSegments);
        const cup = new THREE.Mesh(cupGeometry, materials.innerBone);
        cup.name = `${side === 'left' ? 'Left' : 'Right'} acetabular cup`;
        cup.scale.set(radii[0] * 0.76, radii[1] * 0.76, 1);
        cup.rotation.y = tilt;
        const normal = new THREE.Vector3(Math.sin(tilt), 0, Math.cos(tilt));
        cup.position.set(
            center[0] - normal.x * 0.0024,
            center[1],
            centerZ - normal.z * 0.0024,
        );
        cup.receiveShadow = options.receiveShadow;
        cup.userData.organId = 'pelvis';
        cup.userData.anatomicalSide = side;
        group.add(cup);
    }
    return rim;
}

function addIliacCrest(group, hip, side, options, boneMaterial, midsagittalX) {
    const sourcePoints = hip.landmarks.iliac_crest.superior_envelope_xyz_m;
    if (!Array.isArray(sourcePoints) || sourcePoints.length < 4) return null;
    const deformers = hipDeformers(hip, side, midsagittalX);
    const profile = smoothProfile(hip.depth_profile_by_superior_fraction, options.profileSmoothingPasses);
    const points = sourcePoints.map((sourcePoint, index) => {
        const [x, y] = vector(sourcePoint, 3, `${side} iliac crest[${index}]`);
        const z = sampleProfile(profile, y) + deformers.curvature(x, y)
            + options.hipDepthM * 0.5 + options.iliacCrestForwardOffsetM;
        return new THREE.Vector3(x, y, z);
    });
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.45);
    const geometry = new THREE.TubeGeometry(
        curve,
        Math.max(28, points.length * 5),
        options.iliacCrestRadiusM,
        7,
        false,
    );
    const ridge = new THREE.Mesh(geometry, boneMaterial);
    ridge.name = `${side === 'left' ? 'Left' : 'Right'} iliac crest`;
    ridge.castShadow = options.castShadow;
    ridge.receiveShadow = options.receiveShadow;
    ridge.userData.organId = 'pelvis';
    ridge.userData.anatomicalSide = side;
    group.add(ridge);
    return ridge;
}

function contourXRangeAtY(points, y) {
    const intersections = [];
    for (let index = 0; index < points.length; index++) {
        const first = points[index];
        const second = points[(index + 1) % points.length];
        if ((first[1] > y) === (second[1] > y)) continue;
        const amount = (y - first[1]) / (second[1] - first[1]);
        intersections.push(THREE.MathUtils.lerp(first[0], second[0], amount));
    }
    if (intersections.length < 2) return null;
    intersections.sort((left, right) => left - right);
    return [intersections[0], intersections[intersections.length - 1]];
}

function addSacralRidges(group, sacrum, options, boneMaterial) {
    const points = contour(sacrum.frontal_plate.outer_contour_xy_m, 'sacrum outer contour');
    const bounds = boundsValues(sacrum.source_bounds, 'sacrum bounds');
    const profile = smoothProfile(sacrum.depth_profile_by_superior_fraction, options.profileSmoothingPasses);
    const ridges = new THREE.Group();
    ridges.name = 'Anterior sacral transverse ridges';
    for (const fraction of [0.30, 0.44, 0.58, 0.72]) {
        const y = bounds.minimum[1] + bounds.dimensions[1] * fraction;
        const range = contourXRangeAtY(points, y);
        if (!range) continue;
        const inset = (range[1] - range[0]) * 0.15;
        const left = range[0] + inset;
        const right = range[1] - inset;
        if (right <= left) continue;
        const z = sampleProfile(profile, y) + options.sacrumDepthM * 0.5 + 0.0012;
        const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(left, y, z),
            new THREE.Vector3((left + right) * 0.5, y - 0.0015, z + 0.0008),
            new THREE.Vector3(right, y, z),
        );
        const geometry = new THREE.TubeGeometry(curve, 28, options.sacralRidgeRadiusM, 6, false);
        const ridge = new THREE.Mesh(geometry, boneMaterial);
        ridge.castShadow = options.castShadow;
        ridge.receiveShadow = options.receiveShadow;
        ridge.userData.organId = 'pelvis';
        ridges.add(ridge);
    }
    group.add(ridges);
    return ridges;
}

function normalizedOptions(options = {}) {
    const result = {
        ...options,
        unitsPerMeter: finiteNumber(options.unitsPerMeter ?? 10, 'unitsPerMeter'),
        recenter: options.recenter ?? true,
        hipDepthM: finiteNumber(options.hipDepthM ?? 0.016, 'hipDepthM'),
        sacrumDepthM: finiteNumber(options.sacrumDepthM ?? 0.021, 'sacrumDepthM'),
        coccyxDepthM: finiteNumber(options.coccyxDepthM ?? 0.013, 'coccyxDepthM'),
        bevelThicknessM: finiteNumber(options.bevelThicknessM ?? 0.0015, 'bevelThicknessM'),
        bevelSizeM: finiteNumber(options.bevelSizeM ?? 0.0013, 'bevelSizeM'),
        bevelSegments: Math.max(1, Math.round(options.bevelSegments ?? 3)),
        profileSmoothingPasses: Math.max(0, Math.round(options.profileSmoothingPasses ?? 2)),
        acetabularRimTubeM: finiteNumber(options.acetabularRimTubeM ?? 0.0030, 'acetabularRimTubeM'),
        acetabularTiltRad: finiteNumber(options.acetabularTiltRad ?? 0.20, 'acetabularTiltRad'),
        acetabularSourceDepthBlend: finiteNumber(
            options.acetabularSourceDepthBlend ?? 0.42,
            'acetabularSourceDepthBlend',
        ),
        acetabularRadialSegments: Math.max(6, Math.round(options.acetabularRadialSegments ?? 12)),
        acetabularTubularSegments: Math.max(16, Math.round(options.acetabularTubularSegments ?? 48)),
        iliacCrestRadiusM: finiteNumber(options.iliacCrestRadiusM ?? 0.0018, 'iliacCrestRadiusM'),
        iliacCrestForwardOffsetM: finiteNumber(
            options.iliacCrestForwardOffsetM ?? 0.0015,
            'iliacCrestForwardOffsetM',
        ),
        sacralRidgeRadiusM: finiteNumber(options.sacralRidgeRadiusM ?? 0.00115, 'sacralRidgeRadiusM'),
        includeAcetabularCups: options.includeAcetabularCups ?? true,
        includeIliacCrestRidges: options.includeIliacCrestRidges ?? true,
        includeSacralRidges: options.includeSacralRidges ?? true,
        castShadow: options.castShadow ?? true,
        receiveShadow: options.receiveShadow ?? true,
        materials: options.materials ?? {},
    };
    if (result.unitsPerMeter <= 0) throw new RangeError('unitsPerMeter must be positive');
    for (const key of ['hipDepthM', 'sacrumDepthM', 'coccyxDepthM']) {
        if (result[key] <= 0) throw new RangeError(`${key} must be positive`);
    }
    return result;
}

export async function loadPelvisCoefficients(
    source = DEFAULT_PELVIS_COEFFICIENTS_URL,
    { fetchImpl = globalThis.fetch, signal } = {},
) {
    if (source && typeof source === 'object' && !(source instanceof URL)) {
        return validateDocument(source);
    }
    if (typeof fetchImpl !== 'function') throw new Error('no fetch implementation is available');
    const response = await fetchImpl(source, { signal });
    if (!response.ok) {
        throw new Error(`failed to load pelvis coefficients (${response.status} ${response.statusText})`);
    }
    return validateDocument(await response.json());
}

export function buildProceduralPelvis(coefficients, rawOptions = {}) {
    const document = validateDocument(coefficients);
    const options = normalizedOptions(rawOptions);
    const root = new THREE.Group();
    root.name = 'ProceduralPelvis';
    root.scale.setScalar(options.unitsPerMeter);

    const atlasFrame = new THREE.Group();
    atlasFrame.name = 'HRA female pelvis coefficient frame';
    root.add(atlasFrame);

    const ownedMaterials = new Set();
    const materials = {
        bone: makeBoneMaterial(options, ownedMaterials),
        innerBone: makeInnerMaterial(options, ownedMaterials),
    };
    const midsagittalX = finiteNumber(
        document.fit.shared_landmarks.midsagittal_x_m,
        'midsagittal_x_m',
    );
    const components = {};

    for (const side of ['left', 'right']) {
        const hip = document.fit.hip_bones[side];
        const deformers = hipDeformers(hip, side, midsagittalX);
        const mesh = createPlate(
            hip.frontal_plate,
            hip.depth_profile_by_superior_fraction,
            {
                name: `${side === 'left' ? 'Left' : 'Right'} hip bone`,
                laterality: side,
                depth: options.hipDepthM,
                bevelThickness: options.bevelThicknessM,
                bevelSize: options.bevelSizeM,
                bevelSegments: options.bevelSegments,
                profileSmoothingPasses: options.profileSmoothingPasses,
                curvature: deformers.curvature,
                thicknessScale: deformers.thicknessScale,
                castShadow: options.castShadow,
                receiveShadow: options.receiveShadow,
            },
            materials.bone,
        );
        atlasFrame.add(mesh);
        components[`${side}Hip`] = mesh;
        components[`${side}AcetabularRim`] = addAcetabulum(
            atlasFrame,
            hip,
            side,
            options,
            materials,
            midsagittalX,
        );
        if (options.includeIliacCrestRidges) {
            components[`${side}IliacCrest`] = addIliacCrest(
                atlasFrame,
                hip,
                side,
                options,
                materials.bone,
                midsagittalX,
            );
        }
    }

    const axialSettings = [
        ['sacrum', 'Sacrum', options.sacrumDepthM],
        ['coccyx', 'Coccyx', options.coccyxDepthM],
    ];
    for (const [key, name, depth] of axialSettings) {
        const axial = document.fit.axial_bones[key];
        const mesh = createPlate(
            axial.frontal_plate,
            axial.depth_profile_by_superior_fraction,
            {
                name,
                depth,
                bevelThickness: options.bevelThicknessM,
                bevelSize: options.bevelSizeM,
                bevelSegments: options.bevelSegments,
                profileSmoothingPasses: options.profileSmoothingPasses,
                castShadow: options.castShadow,
                receiveShadow: options.receiveShadow,
            },
            materials.bone,
        );
        atlasFrame.add(mesh);
        components[key] = mesh;
    }
    if (options.includeSacralRidges) {
        components.sacralRidges = addSacralRidges(
            atlasFrame,
            document.fit.axial_bones.sacrum,
            options,
            materials.bone,
        );
    }

    const sourceCenter = vector(document.source_bounds.center_m, 3, 'source_bounds.center_m');
    const atlasOriginM = [midsagittalX, sourceCenter[1], sourceCenter[2]];
    if (options.recenter) atlasFrame.position.set(-atlasOriginM[0], -atlasOriginM[1], -atlasOriginM[2]);

    root.userData.organId = 'pelvis';
    root.userData.components = components;
    root.userData.coefficientSchemaVersion = document.schema_version;
    root.userData.unitsPerMeter = options.unitsPerMeter;
    root.userData.recentered = options.recenter;
    root.userData.atlasOriginM = atlasOriginM;
    root.userData.coordinateFrame = {
        xPositive: 'anatomical patient-left',
        yPositive: 'superior',
        zPositive: 'anterior',
    };
    root.userData.source = document.official_source;
    root.userData.validation = document.validation?.complete_front_silhouette;
    root.userData.dispose = () => {
        const geometries = new Set();
        root.traverse(object => {
            if (object.isMesh && object.geometry && !geometries.has(object.geometry)) {
                geometries.add(object.geometry);
                object.geometry.dispose();
            }
        });
        ownedMaterials.forEach(material => material.dispose());
    };
    root.traverse(object => {
        if (object.isMesh) object.userData.organId = 'pelvis';
    });
    root.updateMatrixWorld(true);
    return root;
}

// Convenience asynchronous entry point. Pass `coefficients` to avoid a fetch,
// or `coefficientUrl`/`fetchImpl` to load the deterministic JSON at runtime.
export async function createProceduralPelvis(options = {}) {
    const coefficients = options.coefficients
        ?? await loadPelvisCoefficients(options.coefficientUrl ?? DEFAULT_PELVIS_COEFFICIENTS_URL, {
            fetchImpl: options.fetchImpl ?? globalThis.fetch,
            signal: options.signal,
        });
    return buildProceduralPelvis(coefficients, options);
}
