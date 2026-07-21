import * as THREE from 'three';

// A fully procedural external human-heart model. No mesh, scan, or authored
// texture is loaded: every vertex, vessel, tissue map, and motion curve is
// generated deterministically at runtime.

const textureCache = new Map();

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

function hash2(x, y) {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return value - Math.floor(value);
}

function hexChannels(hex) {
    const value = Number.parseInt(hex.replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function cardiacHeight(u, v) {
    const longFiber = Math.sin((u * 17 + v * 4.2 + Math.sin(v * 7) * 0.7) * Math.PI * 2) * 0.26;
    const crossFiber = Math.sin((u * 29 - v * 5.5 + Math.sin(v * 9) * 0.35) * Math.PI * 2) * 0.07;
    const pores = (hash2(Math.floor(u * 210), Math.floor(v * 210)) - 0.5) * 0.16;
    const broad = Math.sin(u * 9.7 + Math.sin(v * 6.2)) * Math.sin(v * 8.9) * 0.18;
    return longFiber + crossFiber + pores + broad;
}

function createCardiacTextures(baseColor, size, anisotropy) {
    const key = `${baseColor}_${size}`;
    if (textureCache.has(key)) return textureCache.get(key);

    const colorCanvas = document.createElement('canvas');
    const normalCanvas = document.createElement('canvas');
    const roughCanvas = document.createElement('canvas');
    colorCanvas.width = colorCanvas.height = size;
    normalCanvas.width = normalCanvas.height = size;
    roughCanvas.width = roughCanvas.height = size;

    const colorCtx = colorCanvas.getContext('2d');
    const normalCtx = normalCanvas.getContext('2d');
    const roughCtx = roughCanvas.getContext('2d');
    const colorImage = colorCtx.createImageData(size, size);
    const normalImage = normalCtx.createImageData(size, size);
    const roughImage = roughCtx.createImageData(size, size);
    const [baseR, baseG, baseB] = hexChannels(baseColor);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const u = x / size;
            const v = y / size;
            const height = cardiacHeight(u, v);
            const coarse = Math.sin(u * 19.3 + v * 8.7) * Math.sin(v * 22.1 - u * 3.2) * 0.5;
            const blotch = (Math.sin(u * 7.1 + Math.sin(v * 5.3)) * Math.sin(v * 8.4 - u * 2.1) + 1) * 0.5;
            const micro = hash2(x * 3 + 17, y * 5 + 29) - 0.5;
            const capillaryField = Math.abs(
                Math.sin(u * 27 + Math.sin(v * 12) * 2.5) +
                Math.cos(v * 31 - Math.sin(u * 15) * 2.1)
            );
            const capillary = Math.pow(Math.max(0, 0.18 - capillaryField), 2) * 9;
            // Preserve the muscular variation without letting the procedural
            // albedo collapse into near-black under the atlas key light.
            const variation = 0.90 + height * 0.045 + coarse * 0.085 + blotch * 0.12 + micro * 0.035;
            colorImage.data[i] = Math.max(0, Math.min(255, baseR * variation + capillary * 13));
            colorImage.data[i + 1] = Math.max(0, Math.min(255, baseG * variation - capillary * 8));
            colorImage.data[i + 2] = Math.max(0, Math.min(255, baseB * variation - capillary * 6));
            colorImage.data[i + 3] = 255;

            const du = 1 / size;
            const left = cardiacHeight(Math.max(0, u - du), v);
            const right = cardiacHeight(Math.min(1, u + du), v);
            const up = cardiacHeight(u, Math.max(0, v - du));
            const down = cardiacHeight(u, Math.min(1, v + du));
            const nx = -(right - left) * 1.8;
            const ny = -(down - up) * 1.8;
            const invLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
            normalImage.data[i] = (nx * invLength * 0.5 + 0.5) * 255;
            normalImage.data[i + 1] = (ny * invLength * 0.5 + 0.5) * 255;
            normalImage.data[i + 2] = (invLength * 0.5 + 0.5) * 255;
            normalImage.data[i + 3] = 255;

            const roughness = clamp01(0.78 + coarse * 0.08 - height * 0.025 + hash2(x, y) * 0.07);
            const roughValue = roughness * 255;
            roughImage.data[i] = roughImage.data[i + 1] = roughImage.data[i + 2] = roughValue;
            roughImage.data[i + 3] = 255;
        }
    }

    colorCtx.putImageData(colorImage, 0, 0);
    normalCtx.putImageData(normalImage, 0, 0);
    roughCtx.putImageData(roughImage, 0, 0);

    const colorMap = new THREE.CanvasTexture(colorCanvas);
    const normalMap = new THREE.CanvasTexture(normalCanvas);
    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    for (const texture of [colorMap, normalMap, roughnessMap]) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1.4, 1.8);
        texture.anisotropy = anisotropy;
    }
    colorMap.colorSpace = THREE.SRGBColorSpace;

    const textures = { colorMap, normalMap, roughnessMap };
    textureCache.set(key, textures);
    return textures;
}

function tissueMaterial(baseColor, options) {
    const textures = createCardiacTextures(baseColor, options.textureSize, options.anisotropy);
    return new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: textures.colorMap,
        normalMap: textures.normalMap,
        // Myocardial fibers are dense and sub-millimetric, so their relief
        // should emerge under grazing light without reading as woven cloth.
        normalScale: new THREE.Vector2(0.070, 0.070),
        roughnessMap: textures.roughnessMap,
        roughness: options.roughness ?? 0.5,
        metalness: 0,
        clearcoat: options.clearcoat ?? 0.28,
        clearcoatRoughness: options.clearcoatRoughness ?? 0.32,
        sheen: options.sheen ?? 0.72,
        sheenRoughness: 0.58,
        sheenColor: new THREE.Color(options.sheenColor ?? '#b3443e'),
        transmission: options.transmission ?? 0.012,
        thickness: options.thickness ?? 0.32,
        attenuationColor: new THREE.Color(baseColor),
        attenuationDistance: 1.4,
        ior: 1.38,
        envMapIntensity: options.envMapIntensity ?? 1.12,
    });
}

function vesselMaterial(color, options = {}) {
    return new THREE.MeshPhysicalMaterial({
        color,
        roughness: options.roughness ?? 0.43,
        metalness: 0,
        clearcoat: options.clearcoat ?? 0.28,
        clearcoatRoughness: 0.3,
        sheen: 0.34,
        sheenRoughness: 0.56,
        sheenColor: new THREE.Color(color).offsetHSL(0, -0.08, 0.12),
        transmission: 0.003,
        thickness: 0.12,
        attenuationColor: new THREE.Color(color),
        attenuationDistance: 0.8,
        envMapIntensity: 1.02,
    });
}

function makeChamberGeometry(options) {
    const geometry = new THREE.SphereGeometry(1, options.segments ?? 96, options.rings ?? 72);
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;

    for (let i = 0; i < position.count; i++) {
        const ox = position.getX(i);
        const oy = position.getY(i);
        const oz = position.getZ(i);
        const theta = Math.atan2(oz, ox);
        const bottom = (1 - oy) * 0.5;
        const top = (1 + oy) * 0.5;
        const taper = 1 - (options.taper ?? 0.4) * Math.pow(smoothstep(0.28, 1, bottom), 1.35);
        const shoulder = 1 + (options.shoulder ?? 0.06) * Math.sin(Math.PI * top) * Math.cos(theta - 0.5);
        const lobe = options.lobes
            ? 1 + Math.sin(theta * options.lobes + oy * 2.4) * (options.lobeDepth ?? 0.035) * Math.sin(Math.PI * top)
            : 1;
        const fiber = Math.sin(theta * 11 + oy * 17) * 0.0025 + Math.sin(theta * 23 - oy * 13) * 0.001;
        const broad = Math.sin(theta * 3.1 + oy * 5.3) * 0.012;
        const granular = (hash2(Math.round((theta + Math.PI) * 31), Math.round((oy + 1) * 47)) - 0.5) * 0.0035;
        const surface = 1 + fiber + broad + granular;
        const frontBulge = 1 + Math.max(0, oz) * (options.frontBulge ?? 0.04) * Math.sin(Math.PI * top);

        let x = ox * options.scale.x * taper * shoulder * lobe * surface;
        let y = oy * options.scale.y * surface;
        let z = oz * options.scale.z * taper * lobe * surface * frontBulge;

        const apexPower = Math.pow(bottom, 2.2);
        x += (options.apexShiftX ?? 0) * apexPower;
        z += (options.apexShiftZ ?? 0) * apexPower;

        if (options.notch) {
            const notchDistance = Math.abs(theta - options.notch.angle);
            const notchBand = Math.max(0, 1 - notchDistance / options.notch.width);
            const verticalBand = smoothstep(options.notch.yMin, options.notch.yMax, oy);
            const depth = notchBand * verticalBand * options.notch.depth;
            x -= normal.getX(i) * depth;
            z -= normal.getZ(i) * depth;
        }

        position.setXYZ(i, x, y, z);
    }
    geometry.computeVertexNormals();
    return geometry;
}

function makeChamber(options, material) {
    const mesh = new THREE.Mesh(makeChamberGeometry(options), material);
    mesh.position.copy(options.position);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.restScale = new THREE.Vector3(1, 1, 1);
    return mesh;
}

function makeCurve(points, tension = 0.5) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    curve.curveType = 'catmullrom';
    curve.tension = tension;
    return curve;
}

function orientToDirection(object, direction) {
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
}

function addOpening(group, curve, radius, material, atEnd = true) {
    const t = atEnd ? 1 : 0;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).multiplyScalar(atEnd ? 1 : -1);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.81, radius * 0.19, 14, 40), material);
    rim.position.copy(point).addScaledVector(tangent, 0.001);
    orientToDirection(rim, tangent);
    const cavityMaterial = new THREE.MeshBasicMaterial({ color: 0x090304, side: THREE.DoubleSide });
    const cavity = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.73, 40), cavityMaterial);
    cavity.position.copy(point).addScaledVector(tangent, -0.002);
    orientToDirection(cavity, tangent);
    group.add(rim, cavity);
}

function addVessel(group, points, radius, material, options = {}) {
    const curve = makeCurve(points, options.tension ?? 0.5);
    const geometry = new THREE.TubeGeometry(
        curve,
        options.segments ?? Math.max(24, points.length * 14),
        radius,
        options.radialSegments ?? (radius < 0.01 ? 7 : radius < 0.025 ? 10 : 18),
        false
    );
    const tubePosition = geometry.attributes.position;
    const tubeNormal = geometry.attributes.normal;
    const tubeUv = geometry.attributes.uv;
    for (let i = 0; i < tubePosition.count; i++) {
        const u = tubeUv.getX(i);
        const v = tubeUv.getY(i);
        const wallVariation = radius * (
            Math.sin(v * 31 + u * Math.PI * 4) * 0.006 +
            Math.sin(v * 11 - u * Math.PI * 2) * 0.012
        );
        tubePosition.setXYZ(
            i,
            tubePosition.getX(i) + tubeNormal.getX(i) * wallVariation,
            tubePosition.getY(i) + tubeNormal.getY(i) * wallVariation,
            tubePosition.getZ(i) + tubeNormal.getZ(i) * wallVariation
        );
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = radius > 0.008;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (options.openEnd) addOpening(group, curve, radius, material, true);
    if (options.openStart) addOpening(group, curve, radius, material, false);
    return { mesh, curve };
}

function addRing(group, position, rotation, radius, tube, material) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 48), material);
    ring.position.set(...position);
    ring.rotation.set(...rotation);
    ring.castShadow = true;
    group.add(ring);
    return ring;
}

function addFatLobules(group, material) {
    const geometry = new THREE.SphereGeometry(1, 18, 12);
    const count = 28;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const avCurve = makeCurve([
        [-0.48, 0.27, 0.07], [-0.30, 0.34, 0.30], [0.02, 0.37, 0.39],
        [0.30, 0.34, 0.32], [0.48, 0.22, 0.10]
    ]);

    for (let i = 0; i < count; i++) {
        const t = 0.06 + hash2(i * 17 + 5, 47) * 0.88;
        position.copy(avCurve.getPointAt(t));
        position.x += (hash2(i, 3) - 0.5) * 0.075;
        position.y += (hash2(i, 7) - 0.5) * 0.055;
        position.z += (hash2(i, 11) - 0.5) * 0.045;
        const size = 0.014 + hash2(i, 17) * 0.024;
        scale.set(size * (1.35 + hash2(i, 19) * 0.8), size, size * 0.58);
        quaternion.setFromEuler(new THREE.Euler(hash2(i, 23), hash2(i, 29), hash2(i, 31)));
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return mesh;
}

function addCoronaryNetwork(group, arteryMaterial, veinMaterial, grooveMaterial) {
    const anteriorGroove = [
        [0.03, 0.35, 0.42], [0.02, 0.18, 0.445], [-0.015, -0.05, 0.45],
        [-0.07, -0.30, 0.40], [-0.15, -0.56, 0.27], [-0.21, -0.71, 0.10]
    ];
    addVessel(group, anteriorGroove, 0.010, grooveMaterial, { segments: 72, radialSegments: 10 });
    const lad = addVessel(group, anteriorGroove.map((p, i) => [p[0] - 0.006, p[1], p[2] + 0.012 + i * 0.001]), 0.0065, arteryMaterial, { segments: 72, radialSegments: 10 });
    addVessel(group, anteriorGroove.map((p, i) => [p[0] + 0.020, p[1] + 0.005, p[2] + 0.008 - i * 0.001]), 0.0058, veinMaterial, { segments: 72, radialSegments: 9 });

    const circumflex = addVessel(group, [
        [0.02, 0.37, 0.39], [-0.16, 0.38, 0.38], [-0.34, 0.34, 0.27],
        [-0.47, 0.23, 0.08], [-0.49, 0.05, -0.07]
    ], 0.011, arteryMaterial, { segments: 58, radialSegments: 9 });
    addVessel(group, [
        [0.25, 0.38, 0.34], [0.39, 0.32, 0.29], [0.49, 0.18, 0.16],
        [0.49, -0.02, 0.07], [0.43, -0.24, 0.03]
    ], 0.0115, arteryMaterial, { segments: 58, radialSegments: 9 });
    addVessel(group, [
        [0.40, -0.16, 0.20], [0.40, -0.30, 0.23], [0.34, -0.44, 0.19],
        [0.24, -0.58, 0.11]
    ], 0.0064, arteryMaterial, { segments: 42, radialSegments: 7, tension: 0.42 });
    addVessel(group, [
        [-0.10, 0.36, 0.405], [-0.28, 0.35, 0.35], [-0.43, 0.29, 0.18],
        [-0.52, 0.12, -0.02]
    ], 0.009, veinMaterial, { segments: 50, radialSegments: 8 });

    const ladCurve = lad.curve;
    for (let i = 1; i <= 11; i++) {
        const t = 0.11 + i * 0.065;
        const point = ladCurve.getPointAt(t);
        const side = i % 2 === 0 ? 1 : -1;
        const reach = 0.12 + i * 0.008;
        const end = [
            point.x + side * reach,
            point.y - 0.055 - i * 0.003,
            point.z - 0.025 - Math.abs(side) * 0.008
        ];
        const middle = [
            point.x + side * reach * 0.48,
            point.y - 0.018,
            point.z + 0.008
        ];
        addVessel(group, [[point.x, point.y, point.z], middle, end], Math.max(0.0020, 0.0044 - i * 0.0002), arteryMaterial, {
            segments: 26, radialSegments: 7, tension: 0.42
        });
        if (i <= 9) {
            const fork = [
                middle[0] * 0.38 + end[0] * 0.62,
                middle[1] * 0.38 + end[1] * 0.62,
                middle[2] * 0.38 + end[2] * 0.62
            ];
            addVessel(group, [
                fork,
                [fork[0] + side * (0.025 + i * 0.002), fork[1] - 0.035, fork[2] - 0.008],
                [fork[0] + side * (0.052 + i * 0.003), fork[1] - 0.066, fork[2] - 0.022]
            ], 0.0024, arteryMaterial, { segments: 16, radialSegments: 5, tension: 0.38 });
        }
        if (i < 8 && i % 2 === 1) {
            addVessel(group, [
                [point.x + 0.018, point.y + 0.01, point.z - 0.004],
                [middle[0] * 0.92 + point.x * 0.08, middle[1] + 0.018, middle[2] - 0.005],
                [end[0] * 0.9 + point.x * 0.1, end[1] + 0.025, end[2] - 0.012]
            ], 0.0045, veinMaterial, { segments: 22, radialSegments: 6 });
        }
    }

    const circumflexCurve = circumflex.curve;
    for (let i = 1; i <= 5; i++) {
        const t = 0.15 + i * 0.13;
        const point = circumflexCurve.getPointAt(t);
        addVessel(group, [
            [point.x, point.y, point.z],
            [point.x - 0.02, point.y - 0.09, point.z + 0.035],
            [point.x - 0.015, point.y - 0.18, point.z - 0.01]
        ], 0.0046, arteryMaterial, { segments: 22, radialSegments: 6 });
    }
}

// Bake the anatomical anterior-view reflection into the generated heart
// instead of leaving a negative scale on the runtime object.  Conjugating
// every local transform by the X reflection and reflecting each geometry makes
// the operation telescope through nested groups while preserving positive
// object scales. Reversing triangle winding keeps all outward normals valid,
// which is essential for signed-volume and surface-distance judging.
function mirrorHierarchyAcrossX(root) {
    const reflection = new THREE.Matrix4().makeScale(-1, 1, 1);
    const localMatrix = new THREE.Matrix4();
    const mirroredMatrix = new THREE.Matrix4();
    const mirroredGeometries = new Set();

    const reverseTriangleWinding = geometry => {
        const index = geometry.getIndex();
        if (index) {
            const array = index.array;
            for (let i = 0; i < array.length; i += 3) {
                const second = array[i + 1];
                array[i + 1] = array[i + 2];
                array[i + 2] = second;
            }
            index.needsUpdate = true;
            return;
        }

        // Three.js primitives used here are indexed, but keep the helper
        // correct for future non-indexed procedural additions as well.
        Object.values(geometry.attributes).forEach(attribute => {
            const { array, itemSize, count } = attribute;
            for (let vertex = 0; vertex + 2 < count; vertex += 3) {
                for (let component = 0; component < itemSize; component++) {
                    const a = (vertex + 1) * itemSize + component;
                    const b = (vertex + 2) * itemSize + component;
                    const value = array[a];
                    array[a] = array[b];
                    array[b] = value;
                }
            }
            attribute.needsUpdate = true;
        });
    };

    root.traverse(object => {
        if (object !== root) {
            object.updateMatrix();
            localMatrix.copy(object.matrix);
            mirroredMatrix.copy(reflection).multiply(localMatrix).multiply(reflection);
            mirroredMatrix.decompose(object.position, object.quaternion, object.scale);
            object.matrixWorldNeedsUpdate = true;
        }

        if (object.isInstancedMesh) {
            for (let instance = 0; instance < object.count; instance++) {
                object.getMatrixAt(instance, localMatrix);
                mirroredMatrix.copy(reflection).multiply(localMatrix).multiply(reflection);
                object.setMatrixAt(instance, mirroredMatrix);
            }
            object.instanceMatrix.needsUpdate = true;
        }

        if (!object.isMesh || !object.geometry || mirroredGeometries.has(object.geometry)) return;
        const geometry = object.geometry;
        mirroredGeometries.add(geometry);
        geometry.applyMatrix4(reflection);
        reverseTriangleWinding(geometry);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
    });
    root.updateMatrixWorld(true);
}

export function createProceduralHeart(options = {}) {
    const textureSize = options.textureSize ?? 384;
    const anisotropy = options.anisotropy ?? 4;
    const root = new THREE.Group();
    root.name = 'ProceduralHeart';

    // Deep red-brown myocardium under a wet serous pericardium. The former
    // salmon-orange read as raw poultry / clay; living ventricle is a cool,
    // dark oxblood, with the atria cooler and more purplish than the ventricles.
    const myocard = tissueMaterial('#82302a', {
        textureSize, anisotropy, roughness: 0.52, clearcoat: 0.52,
        clearcoatRoughness: 0.30,
        sheen: 0.30, sheenColor: '#9c463b', envMapIntensity: 0.72
    });
    const rightMyocard = tissueMaterial('#8c3a31', {
        textureSize, anisotropy, roughness: 0.52, clearcoat: 0.52,
        clearcoatRoughness: 0.30,
        sheen: 0.30, sheenColor: '#a54d40', envMapIntensity: 0.70
    });
    const atrialMyocard = tissueMaterial('#6f2b30', {
        textureSize, anisotropy, roughness: 0.55, clearcoat: 0.46,
        clearcoatRoughness: 0.33,
        sheen: 0.26, sheenColor: '#853a42', envMapIntensity: 0.66
    });
    const arterial = vesselMaterial('#cc3542', { roughness: 0.32, clearcoat: 0.34 });
    const oxygenated = vesselMaterial('#a62430', { roughness: 0.45 });
    const venous = vesselMaterial('#315db5', { roughness: 0.38, clearcoat: 0.24 });
    const coronaryArtery = vesselMaterial('#aa4338', { roughness: 0.56 });
    const coronaryVein = vesselMaterial('#76506b', { roughness: 0.58, clearcoat: 0.1 });
    const groove = new THREE.MeshPhysicalMaterial({ color: 0xb36d62, roughness: 0.82, clearcoat: 0.02, envMapIntensity: 0.42 });
    const fatMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xb98b55, roughness: 0.82, clearcoat: 0.06,
        sheen: 0.22, sheenColor: new THREE.Color(0xe3bd7d), envMapIntensity: 0.58
    });
    const valveMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xcbbda9, roughness: 0.58, transmission: 0.05, thickness: 0.08,
        clearcoat: 0.12, sheen: 0.26, envMapIntensity: 0.75
    });

    const chambers = new THREE.Group();
    chambers.name = 'Cardiac chambers';
    const leftVentricle = makeChamber({
        position: new THREE.Vector3(-0.03, -0.16, 0.02),
        scale: new THREE.Vector3(0.47, 0.68, 0.38),
        taper: 0.32, shoulder: 0.08, frontBulge: 0.08,
        apexShiftX: 0.080, apexShiftZ: 0.025,
        rotation: [0.04, -0.03, -0.06]
    }, myocard);
    leftVentricle.name = 'Left ventricle';

    const rightVentricle = makeChamber({
        position: new THREE.Vector3(0.14, -0.08, 0.235),
        scale: new THREE.Vector3(0.39, 0.52, 0.245),
        taper: 0.28, shoulder: 0.12, frontBulge: 0.12,
        apexShiftX: 0.00, apexShiftZ: -0.015,
        rotation: [-0.02, 0.10, 0.06],
        notch: { angle: Math.PI, width: 0.55, yMin: 0.25, yMax: 0.9, depth: 0.025 }
    }, rightMyocard);
    rightVentricle.name = 'Right ventricle';

    const conus = makeChamber({
        position: new THREE.Vector3(0.10, 0.255, 0.255),
        scale: new THREE.Vector3(0.135, 0.285, 0.115),
        taper: 0.38, shoulder: 0.08, frontBulge: 0.06,
        apexShiftX: -0.02, apexShiftZ: 0.01,
        rotation: [-0.08, 0.02, 0.12], segments: 64, rings: 48
    }, rightMyocard);
    conus.name = 'Conus arteriosus';

    const leftAtrium = makeChamber({
        position: new THREE.Vector3(-0.17, 0.40, -0.16),
        scale: new THREE.Vector3(0.255, 0.225, 0.205),
        taper: 0.08, shoulder: 0.08, frontBulge: 0.02,
        lobes: 5, lobeDepth: 0.018,
        rotation: [0.08, -0.08, -0.12]
    }, atrialMyocard);
    leftAtrium.name = 'Left atrium';

    const rightAtrium = makeChamber({
        position: new THREE.Vector3(0.29, 0.36, -0.035),
        scale: new THREE.Vector3(0.305, 0.37, 0.25),
        taper: 0.05, shoulder: 0.12, frontBulge: 0.055,
        lobes: 4, lobeDepth: 0.02,
        rotation: [0.02, 0.08, 0.11]
    }, atrialMyocard);
    rightAtrium.name = 'Right atrium';

    const leftAuricle = makeChamber({
        position: new THREE.Vector3(-0.39, 0.42, 0.105),
        scale: new THREE.Vector3(0.13, 0.175, 0.095),
        taper: 0.18, shoulder: 0.16, frontBulge: 0.06,
        lobes: 7, lobeDepth: 0.075,
        rotation: [-0.08, -0.24, -0.24], segments: 64, rings: 48
    }, atrialMyocard);
    leftAuricle.name = 'Left auricle';

    const rightAuricle = makeChamber({
        position: new THREE.Vector3(0.45, 0.37, 0.095),
        scale: new THREE.Vector3(0.135, 0.205, 0.105),
        taper: 0.16, shoulder: 0.14, frontBulge: 0.06,
        lobes: 7, lobeDepth: 0.07,
        rotation: [-0.10, 0.22, 0.22], segments: 64, rings: 48
    }, atrialMyocard);
    rightAuricle.name = 'Right auricle';
    chambers.add(leftVentricle, rightVentricle, conus, leftAtrium, rightAtrium, leftAuricle, rightAuricle);
    root.add(chambers);

    const greatVessels = new THREE.Group();
    greatVessels.name = 'Great vessels';
    const aorta = addVessel(greatVessels, [
        [-0.08, 0.47, -0.02], [-0.10, 0.69, -0.035], [-0.055, 0.90, -0.045],
        [0.08, 1.02, -0.08], [0.25, 1.00, -0.14], [0.36, 0.84, -0.20],
        [0.34, 0.60, -0.24]
    ], 0.088, arterial, { segments: 96, radialSegments: 22 });
    aorta.mesh.name = 'Aorta';
    addVessel(greatVessels, [[0.03, 0.98, -0.06], [0.00, 1.16, -0.07], [-0.01, 1.32, -0.08]], 0.043, arterial, { openEnd: true, radialSegments: 14 });
    addVessel(greatVessels, [[0.14, 1.01, -0.10], [0.16, 1.18, -0.11], [0.16, 1.35, -0.12]], 0.037, arterial, { openEnd: true, radialSegments: 14 });
    addVessel(greatVessels, [[0.24, 0.98, -0.14], [0.36, 1.13, -0.16], [0.54, 1.31, -0.18]], 0.039, arterial, { openEnd: true, radialSegments: 14 });

    const pulmonaryTrunk = addVessel(greatVessels, [
        [0.10, 0.43, 0.25], [0.13, 0.64, 0.29], [0.08, 0.80, 0.27], [0.01, 0.88, 0.21]
    ], 0.074, venous, { segments: 58, radialSegments: 20 });
    pulmonaryTrunk.mesh.name = 'Pulmonary trunk';
    addVessel(greatVessels, [[0.02, 0.84, 0.14], [-0.15, 0.86, 0.04], [-0.38, 0.82, -0.05], [-0.56, 0.73, -0.12]], 0.056, venous, { openEnd: true, radialSegments: 16 });
    addVessel(greatVessels, [[0.04, 0.84, 0.10], [0.19, 0.86, -0.01], [0.42, 0.80, -0.10], [0.59, 0.70, -0.18]], 0.050, venous, { openEnd: true, radialSegments: 16 });

    const superiorVenaCava = addVessel(greatVessels, [
        [0.29, 0.39, -0.03], [0.34, 0.63, -0.055], [0.38, 0.88, -0.07], [0.40, 1.16, -0.08]
    ], 0.067, venous, { openEnd: true, radialSegments: 18 });
    superiorVenaCava.mesh.name = 'Superior vena cava';
    addVessel(greatVessels, [[0.27, 0.25, -0.10], [0.30, 0.04, -0.14], [0.29, -0.25, -0.18]], 0.070, venous, { openEnd: true, radialSegments: 16 });

    addVessel(greatVessels, [[-0.17, 0.46, -0.20], [-0.34, 0.50, -0.24], [-0.54, 0.52, -0.25]], 0.047, oxygenated, { openEnd: true, radialSegments: 14 });
    addVessel(greatVessels, [[-0.15, 0.32, -0.22], [-0.35, 0.31, -0.27], [-0.54, 0.27, -0.29]], 0.043, oxygenated, { openEnd: true, radialSegments: 14 });
    addVessel(greatVessels, [[0.00, 0.46, -0.21], [0.18, 0.51, -0.27], [0.50, 0.50, -0.30]], 0.046, oxygenated, { openEnd: true, radialSegments: 14 });
    addVessel(greatVessels, [[0.01, 0.31, -0.22], [0.21, 0.31, -0.29], [0.49, 0.25, -0.31]], 0.042, oxygenated, { openEnd: true, radialSegments: 14 });
    root.add(greatVessels);

    const fibrousRings = new THREE.Group();
    fibrousRings.name = 'Fibrous valve rings';
    addRing(fibrousRings, [-0.08, 0.48, -0.015], [Math.PI / 2.08, 0, 0], 0.094, 0.013, valveMaterial);
    addRing(fibrousRings, [0.10, 0.45, 0.25], [Math.PI / 2.05, 0, 0], 0.081, 0.011, valveMaterial);
    root.add(fibrousRings);

    const coronaryNetwork = new THREE.Group();
    coronaryNetwork.name = 'Coronary circulation';
    addCoronaryNetwork(coronaryNetwork, coronaryArtery, coronaryVein, groove);
    root.add(coronaryNetwork);

    const fat = new THREE.Group();
    fat.name = 'Epicardial fat';
    addFatLobules(fat, fatMaterial);
    root.add(fat);

    root.userData.chambers = { leftVentricle, rightVentricle, conus, leftAtrium, rightAtrium, leftAuricle, rightAuricle };
    root.userData.pulsingVessels = [aorta.mesh, pulmonaryTrunk.mesh, superiorVenaCava.mesh];
    root.userData.update = (elapsed) => {
        const cycle = (elapsed * 1.18) % 1;
        const systole = Math.exp(-Math.pow((cycle - 0.14) / 0.075, 2));
        const rebound = Math.exp(-Math.pow((cycle - 0.31) / 0.14, 2)) * 0.42;
        const contraction = systole - rebound;
        const atrialCycle = Math.exp(-Math.pow((cycle - 0.86) / 0.11, 2));

        leftVentricle.scale.set(1 + contraction * 0.052, 1 - contraction * 0.028, 1 + contraction * 0.05);
        rightVentricle.scale.set(1 + contraction * 0.045, 1 - contraction * 0.022, 1 + contraction * 0.055);
        conus.scale.set(1 + contraction * 0.04, 1 - contraction * 0.02, 1 + contraction * 0.05);
        leftAtrium.scale.setScalar(1 + atrialCycle * 0.018 - contraction * 0.009);
        rightAtrium.scale.setScalar(1 + atrialCycle * 0.021 - contraction * 0.008);
        leftAuricle.scale.setScalar(1 + atrialCycle * 0.015);
        rightAuricle.scale.setScalar(1 + atrialCycle * 0.015);
        const vesselPulse = 1 + systole * 0.012;
        for (const vessel of root.userData.pulsingVessels) vessel.scale.set(vesselPulse, 1, vesselPulse);
        root.rotation.z = 0.015 + Math.sin(elapsed * Math.PI * 2 * 1.18) * 0.003;
    };

    // Local source coordinates were authored in anatomical convention, where
    // the left ventricle has negative X. The atlas camera expects anatomical
    // left on screen-right (+X), so bake that mirror once at construction.
    mirrorHierarchyAcrossX(root);

    root.traverse(child => {
        if (child.isMesh) child.userData.organId = 'heart';
    });
    root.userData.organId = 'heart';
    return root;
}
