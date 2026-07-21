
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {html, LitElement, PropertyValueMap} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {Marked} from 'marked';
import {markedHighlight} from 'marked-highlight';
import hljs from 'highlight.js';
import {FilesetResolver, GestureRecognizer, DrawingUtils} from '@mediapipe/tasks-vision';
import * as THREE from 'three';

// --- LOG SUPPRESSION ---
const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;

const logFilter = (orig: Function) => (...args: any[]) => {
    const msg = args.map(a => String(a)).join(' ');
    if (
        msg.includes('TensorFlow Lite') || 
        msg.includes('XNNPACK') || 
        msg.includes('WASM') || 
        msg.includes('delegate') || 
        msg.includes('Created') || 
        msg.includes('INFO:')
    ) return;
    orig.apply(console, args);
};

console.log = logFilter(originalLog);
console.info = logFilter(originalInfo);
console.warn = logFilter(originalWarn);
console.error = logFilter(originalError);

export enum ChatState { IDLE, GENERATING, THINKING, EXECUTING }

// --- HAND CONNECTIONS MANUALLY DEFINED (Fix for Import Error) ---
const HAND_CONNECTIONS = [
  {start: 0, end: 1}, {start: 1, end: 2}, {start: 2, end: 3}, {start: 3, end: 4},
  {start: 0, end: 5}, {start: 5, end: 6}, {start: 6, end: 7}, {start: 7, end: 8},
  {start: 5, end: 9}, {start: 9, end: 10}, {start: 10, end: 11}, {start: 11, end: 12},
  {start: 9, end: 13}, {start: 13, end: 14}, {start: 14, end: 15}, {start: 15, end: 16},
  {start: 13, end: 17}, {start: 17, end: 18}, {start: 18, end: 19}, {start: 19, end: 20},
  {start: 0, end: 17}
];

// --- TYPES ---
type AppMode = 'SOLAR_SYSTEM' | 'HUMAN_BODY' | 'MOLECULES' | 'ATOM' | 'PYRAMID' | 'FLOWER';
type MoleculeType = 'WATER' | 'CAFFEINE' | 'DNA';

interface InteractableObject {
    name: string;
    mesh: THREE.Object3D;
    data: any; 
}

let markedInstance: Marked | undefined;
export async function parseMarkdown(text: string): Promise<string> {
  if (!markedInstance) {
    markedInstance = new Marked(
      markedHighlight({
        async: true,
        emptyLangClass: 'hljs',
        langPrefix: 'hljs language-',
        highlight(code, lang) {
          const language = hljs.getLanguage(lang) ? lang : 'plaintext';
          return hljs.highlight(code, {language}).value;
        },
      }),
    );
  }
  return markedInstance.parse(text);
}

// --- TEXTURE GENERATORS ---

function createProceduralTexture(name: string, colorHex: number, isCloud = false): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const color = new THREE.Color(colorHex);

    if (isCloud) {
        ctx.clearRect(0, 0, 1024, 512);
        ctx.fillStyle = 'rgba(255, 255, 255, 0)';
        ctx.fillRect(0,0,1024,512);
        for (let i = 0; i < 600; i++) {
            const x = Math.random() * 1024;
            const y = Math.random() * 512;
            const w = Math.random() * 100 + 20;
            const h = Math.random() * 40 + 10;
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.4})`;
            ctx.beginPath();
            ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        ctx.fillStyle = `#${color.getHexString()}`;
        ctx.fillRect(0, 0, 1024, 512);
        const isGasGiant = ['Jupiter', 'Saturn', 'Uranus', 'Neptune'].includes(name);
        if (isGasGiant) {
            for (let i = 0; i < 40; i++) {
                const y = Math.random() * 512;
                const h = Math.random() * 50 + 10;
                ctx.fillStyle = `rgba(0, 0, 0, ${Math.random() * 0.2})`;
                ctx.fillRect(0, y, 1024, h);
                ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.1})`;
                ctx.fillRect(0, y + h/2, 1024, h/4);
            }
        } else {
            for (let i = 0; i < 4000; i++) {
                const x = Math.random() * 1024;
                const y = Math.random() * 512;
                const r = Math.random() * 3;
                ctx.fillStyle = `rgba(0, 0, 0, ${Math.random() * 0.15})`;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    return new THREE.CanvasTexture(canvas);
}

// Planet Internal Layers Texture
function createPlanetCrossSection(layers: string[]): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    const centerX = 256;
    const centerY = 256;
    const maxRadius = 250;
    
    // Draw layers from outside in
    layers.forEach((color, i) => {
        const radius = maxRadius * (1 - (i / layers.length));
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        
        // Add some noise/texture to the layer
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 2;
        ctx.stroke();
    });
    
    return new THREE.CanvasTexture(canvas);
}

// 1. Vein/Flesh Texture Generator (Color Map)
function createOrganTexture(baseColor: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    
    // Base flesh tone
    ctx.fillStyle = baseColor; 
    ctx.fillRect(0,0,1024,1024);
    
    // Subsurface Noise
    for(let i=0; i<100000; i++) {
        ctx.fillStyle = `rgba(255,255,255, ${Math.random()*0.08})`;
        ctx.fillRect(Math.random()*1024, Math.random()*1024, 2, 2);
    }
    
    // Muscle Fibers / Directional grain
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#000000';
    for(let i=0; i<500; i++) {
        const y = Math.random() * 1024;
        ctx.fillRect(0, y, 1024, Math.random()*2);
    }
    ctx.globalAlpha = 1.0;

    // Capillaries/Veins
    ctx.strokeStyle = 'rgba(80, 0, 0, 0.2)';
    ctx.lineCap = 'round';
    
    const drawBranch = (x: number, y: number, length: number, angle: number, width: number) => {
        if(length < 5) return;
        ctx.beginPath();
        ctx.lineWidth = width;
        ctx.moveTo(x, y);
        const endX = x + Math.cos(angle) * length;
        const endY = y + Math.sin(angle) * length;
        ctx.lineTo(endX, endY);
        ctx.stroke();
        
        const numBranches = Math.floor(Math.random() * 3) + 1;
        for(let i=0; i<numBranches; i++) {
            drawBranch(endX, endY, length * 0.7, angle + (Math.random()-0.5), width * 0.7);
        }
    };

    for(let i=0; i<30; i++) {
        drawBranch(Math.random()*1024, Math.random()*1024, 150, Math.random()*Math.PI*2, 3);
    }
    
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

// 2. Normal Map Generator (Bumpy Surface)
function createNormalNoiseMap(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    // Neutral Normal Blue
    ctx.fillStyle = '#8080ff'; 
    ctx.fillRect(0,0,512,512);
    
    // Create bumps by varying R and G
    for(let i=0; i<50000; i++) {
        const x = Math.random()*512;
        const y = Math.random()*512;
        const size = Math.random() * 3;
        // Perturb normal slightly
        const r = 100 + Math.random() * 50;
        const g = 100 + Math.random() * 50;
        ctx.fillStyle = `rgba(${r}, ${g}, 255, 0.1)`;
        ctx.beginPath();
        ctx.arc(x,y,size,0,Math.PI*2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

// 3. Bone Texture Generator
function createBoneTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#e8e8d8';
    ctx.fillRect(0,0,512,512);
    
    // Porous noise
    ctx.fillStyle = '#d0d0c0';
    for(let i=0; i<20000; i++) {
        ctx.beginPath();
        ctx.arc(Math.random()*512, Math.random()*512, Math.random()*1.5, 0, Math.PI*2);
        ctx.fill();
    }
    return new THREE.CanvasTexture(canvas);
}

// 4. Mesh Sculpting Helper
function sculptMesh(geometry: THREE.BufferGeometry, magnitude: number, frequency = 0.5) {
    const pos = geometry.attributes.position;
    const vector = new THREE.Vector3();
    
    const noise = (x:number, y:number, z:number) => {
        return Math.sin(x*frequency) * Math.cos(y*frequency) * Math.sin(z*frequency);
    };

    for (let i = 0; i < pos.count; i++) {
        vector.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        // Displace along normal or just radially
        const n = noise(vector.x, vector.y, vector.z);
        const scalar = 1 + (n * magnitude);
        vector.multiplyScalar(scalar);
        pos.setXYZ(i, vector.x, vector.y, vector.z);
    }
    geometry.computeVertexNormals();
}

function createTextSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 48px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 6; ctx.strokeText(text, 256, 64);
    ctx.fillStyle = '#ffffff'; ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(10, 2.5, 1);
    sprite.renderOrder = 999;
    return sprite;
}

@customElement('gdm-game-app')
export class GameApp extends LitElement {
  @query('#webcam') webcamElement?: HTMLVideoElement;
  @query('#output_canvas') canvasElement?: HTMLCanvasElement;
  @query('#debug_overlay') debugOverlay?: HTMLCanvasElement;
  @query('#anchor') anchor?: HTMLDivElement;
  @query('#scene-container') sceneContainer?: HTMLDivElement;
  @query('#cursor') cursorElement?: HTMLDivElement;

  @state() chatState = ChatState.IDLE;
  @state() inputMessage = '';
  @state() messages: HTMLElement[] = [];
  @state() handControlActive = false;
  @state() gestureName = 'None';
  @state() isModelLoading = false;
  @state() statusText = "System Ready";
  @state() hoveredObjectName = "";
  @state() selectionProgress = 0;
  @state() currentMode: AppMode = 'SOLAR_SYSTEM';
  @state() moleculeType: MoleculeType = 'WATER';
  @state() debugMode = false;
  @state() gestureSpeedLevel = 4; // Default speed level (1-7)

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private interactables: InteractableObject[] = [];
  private gestureRecognizer?: GestureRecognizer;
  private lastGestureTime = 0;
  private orbitAngle = 0;
  private orbitElevation = 0.5;
  private cameraDistance = 160;
  private canvasCtx?: CanvasRenderingContext2D;
  private drawingUtils?: DrawingUtils;
  private debugDrawingUtils?: DrawingUtils;
  private debugCtx?: CanvasRenderingContext2D;
  private textureLoader = new THREE.TextureLoader();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private lastHoveredObject: string | null = null;
  private hoverStartTime = 0;
  private isExamining = false;
  private clippingPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private animationLoop: (() => void) | null = null;
  private organMeshes: THREE.Mesh[] = [];

  // Planet Breaking State
  private currentExaminedPlanet: THREE.Object3D | null = null;
  private brokenPlanetGroup: THREE.Group | null = null;
  private isPlanetBroken = false;
  private handSeparation = 0;
  private lastDebugLogTime = 0; // For throttling console logs

  sendMessageHandler?: (msg: string) => Promise<void>;
  onGameEvent?: (event: string, detail?: string) => void;

  createRenderRoot() { return this; }

  protected firstUpdated() {
    this.textureLoader.setCrossOrigin('anonymous');
    this.init3D();
    this.loadSceneForMode(this.currentMode);
    this.animate();
  }

  init3D() {
    if (!this.sceneContainer) return;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(55, this.sceneContainer.clientWidth / this.sceneContainer.clientHeight, 0.1, 3000);
    this.updateCameraPosition();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setSize(this.sceneContainer.clientWidth, this.sceneContainer.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.localClippingEnabled = true;
    this.sceneContainer.appendChild(this.renderer.domElement);
    
    // Lighting setup changes per mode, but defaults here
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); 
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(100, 100, 50);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    window.addEventListener('resize', () => {
      if (!this.sceneContainer) return;
      this.camera.aspect = this.sceneContainer.clientWidth / this.sceneContainer.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.sceneContainer.clientWidth, this.sceneContainer.clientHeight);
    });
  }

  switchMode(newMode: AppMode) {
      if (this.currentMode === newMode) return;
      this.currentMode = newMode;
      this.resetView();
      this.onGameEvent?.("MODE_CHANGED", newMode);
      this.loadSceneForMode(newMode);
  }

  switchMolecule(type: MoleculeType) {
      this.moleculeType = type;
      this.resetView();
      this.loadSceneForMode('MOLECULES');
      this.onGameEvent?.("OBJECT_SELECTED", `${type} MOLECULE`);
  }

  resetView() {
      this.isExamining = false;
      this.isPlanetBroken = false;
      this.currentExaminedPlanet = null;
      this.brokenPlanetGroup = null;
      this.cameraDistance = 160;
      this.orbitAngle = 0;
      this.orbitElevation = 0.5;
  }

  loadSceneForMode(mode: AppMode) {
      // CLEAR
      for(let i = this.scene.children.length - 1; i >= 0; i--){ 
          const obj = this.scene.children[i];
          if(!(obj instanceof THREE.Light)) this.scene.remove(obj); 
      }
      this.interactables = [];
      this.organMeshes = [];
      this.animationLoop = null;
      this.statusText = mode.replace('_', ' ');

      switch(mode) {
          case 'SOLAR_SYSTEM': this.setupSolarSystem(); break;
          case 'HUMAN_BODY': this.setupHumanBody(); break;
          case 'MOLECULES': this.setupMolecules(); break;
          case 'ATOM': this.setupAtom(); break;
          case 'PYRAMID': this.setupPyramid(); break;
          case 'FLOWER': this.setupFlower(); break;
      }
  }

  // --- 1. SOLAR SYSTEM ---
  setupSolarSystem() {
    this.cameraDistance = 160;
    this.scene.background = new THREE.Color(0x000000);
    const sunGeo = new THREE.SphereGeometry(8, 64, 64);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd33 });
    this.textureLoader.load('https://upload.wikimedia.org/wikipedia/commons/9/99/Map_of_the_full_sun.jpg', 
        (tex) => { sunMat.map = tex; sunMat.color.setHex(0xffffff); sunMat.needsUpdate = true; });
    const sun = new THREE.Mesh(sunGeo, sunMat);
    sun.name = "Sun";
    this.scene.add(sun);
    this.interactables.push({ name: "Sun", mesh: sun, data: { layers: ['#ff9900', '#ffcc00', '#ffff00'] } });
    const sunLabel = createTextSprite("Sun"); sunLabel.position.set(0, 10, 0); this.scene.add(sunLabel);

    const planetData = [
       { name: 'Mercury', color: 0xAAAAAA, size: 0.8, distance: 15, speed: 0.02, layers: ['#444444', '#777777', '#aaaaaa'] },
       { name: 'Venus', color: 0xE3BB76, size: 1.5, distance: 22, speed: 0.015, layers: ['#884400', '#cc8800', '#ffcc66'] },
       { name: 'Earth', color: 0x2233FF, size: 1.6, distance: 30, speed: 0.012, hasCloud: true, layers: ['#330000', '#cc3300', '#4477ff'] },
       { name: 'Mars', color: 0xDF4522, size: 1.2, distance: 40, speed: 0.01, layers: ['#440000', '#882200', '#cc5522'] },
       { name: 'Jupiter', color: 0xD6A566, size: 4.5, distance: 60, speed: 0.005, layers: ['#442200', '#886644', '#ccaa88'] },
       { name: 'Saturn', color: 0xFCEBA6, size: 3.8, distance: 85, speed: 0.004, hasRing: true, layers: ['#665522', '#aa9966', '#ffeedd'] },
       { name: 'Uranus', color: 0x88DDFF, size: 2.5, distance: 110, speed: 0.003, layers: ['#224466', '#4488aa', '#aaddff'] },
       { name: 'Neptune', color: 0x3355FF, size: 2.4, distance: 130, speed: 0.002, layers: ['#000066', '#002288', '#4466ff'] }
    ];
    const animatedPlanets: any[] = [];
    planetData.forEach(p => {
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(p.size, 64, 64), 
            new THREE.MeshStandardMaterial({ map: createProceduralTexture(p.name, p.color), roughness: 0.8 })
        );
        mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh);
        if (p.hasCloud) {
            const cloudGeo = new THREE.SphereGeometry(p.size * 1.05, 64, 64);
            const cloudMat = new THREE.MeshStandardMaterial({ map: createProceduralTexture('Clouds', 0xffffff, true), transparent: true, opacity: 0.8, side: THREE.DoubleSide });
            const clouds = new THREE.Mesh(cloudGeo, cloudMat);
            group.add(clouds); mesh.userData.clouds = clouds;
        }
        const pathGeo = new THREE.RingGeometry(p.distance - 0.1, p.distance + 0.1, 128);
        const pathMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, opacity: 0.1, transparent: true });
        const path = new THREE.Mesh(pathGeo, pathMat); path.rotation.x = Math.PI / 2; this.scene.add(path);
        if(p.hasRing) {
             const ring = new THREE.Mesh(new THREE.RingGeometry(p.size*1.4, p.size*2.2, 64), new THREE.MeshBasicMaterial({ color: 0xcfb997, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
             ring.rotation.x = Math.PI/2.3; group.add(ring);
        }
        const label = createTextSprite(p.name); label.position.set(0, p.size + 2, 0); group.add(label);
        group.name = p.name; this.scene.add(group);
        this.interactables.push({ name: p.name, mesh: group, data: p });
        animatedPlanets.push({ group, p, angle: Math.random() * Math.PI * 2 });
    });
    this.createStarfield();
    this.animationLoop = () => {
        if(!this.isExamining) {
            animatedPlanets.forEach(item => {
                item.angle += item.p.speed * 0.2;
                item.group.position.x = Math.cos(item.angle) * item.p.distance;
                item.group.position.z = Math.sin(item.angle) * item.p.distance;
                item.group.children[0].rotation.y += 0.01;
                if(item.group.children[0].userData.clouds) item.group.children[0].userData.clouds.rotation.y += 0.015;
            });
        }
        
        // Handle Broken Planet Animation
        if (this.isExamining && this.isPlanetBroken && this.brokenPlanetGroup) {
             const leftHalf = this.brokenPlanetGroup.getObjectByName("LeftHalf");
             const rightHalf = this.brokenPlanetGroup.getObjectByName("RightHalf");
             // Continuously map hand separation (dist) to planet gap.
             // Minimum separation (minSep) is where hands are "on" the planet surface (~0.2).
             // As hands move wider, the gap increases.
             const minSep = 0.2;
             const gap = Math.max(0, (this.handSeparation - minSep) * 30);
             
             if (leftHalf) leftHalf.position.x = THREE.MathUtils.lerp(leftHalf.position.x, -gap, 0.2);
             if (rightHalf) rightHalf.position.x = THREE.MathUtils.lerp(rightHalf.position.x, gap, 0.2);
        }
    };
  }
  
  // Create broken planet geometry
  breakPlanet(obj: InteractableObject) {
      if (this.isPlanetBroken || !this.currentExaminedPlanet) return;
      
      const pData = obj.data;
      const size = pData.size || 8; // Default sun size
      
      // Fix texture finding: Check simple mesh or group children
      let map = null;
      let isSun = obj.name === "Sun";
      
      if ((obj.mesh as any).isMesh) {
          // It is the Sun
          map = (obj.mesh as any).material.map;
      } else if (obj.mesh.children && obj.mesh.children.length > 0) {
          // It is a planet Group
          map = (obj.mesh.children[0] as any).material.map;
      }

      // Remove original
      this.currentExaminedPlanet.visible = false;
      
      this.brokenPlanetGroup = new THREE.Group();
      this.brokenPlanetGroup.position.copy(this.currentExaminedPlanet.position);
      this.brokenPlanetGroup.rotation.copy(this.currentExaminedPlanet.rotation);
      
      // Material: Use Standard for planets (lit), Basic for Sun (unlit/glowing)
      let mat;
      if (isSun) {
           mat = new THREE.MeshBasicMaterial({ map: map, color: 0xffffff });
      } else {
           mat = new THREE.MeshStandardMaterial({ map: map, roughness: 0.8 });
      }
      
      const internalMat = new THREE.MeshStandardMaterial({ map: createPlanetCrossSection(pData.layers), roughness: 1.0 });

      // Right Half
      const rGeo = new THREE.SphereGeometry(size, 32, 32, 0, Math.PI);
      const rMesh = new THREE.Mesh(rGeo, mat);
      const rCap = new THREE.Mesh(new THREE.CircleGeometry(size, 32), internalMat);
      rCap.rotation.y = -Math.PI/2;
      const rGroup = new THREE.Group();
      rGroup.add(rMesh); rGroup.add(rCap);
      rGroup.name = "RightHalf";
      
      // Left Half
      const lGeo = new THREE.SphereGeometry(size, 32, 32, Math.PI, Math.PI);
      const lMesh = new THREE.Mesh(lGeo, mat);
      const lCap = new THREE.Mesh(new THREE.CircleGeometry(size, 32), internalMat);
      lCap.rotation.y = Math.PI/2;
      const lGroup = new THREE.Group();
      lGroup.add(lMesh); lGroup.add(lCap);
      lGroup.name = "LeftHalf";

      this.brokenPlanetGroup.add(rGroup);
      this.brokenPlanetGroup.add(lGroup);
      
      this.scene.add(this.brokenPlanetGroup);
      this.isPlanetBroken = true;
      // Status update to indicate action
      this.statusText = `${obj.name}: CORE EXPOSED`;
  }

  // --- 2. HUMAN BODY (ANATOMY 4.0: HYPER-REALISTIC) ---
  setupHumanBody() {
      this.cameraDistance = 30; 
      this.scene.background = new THREE.Color(0x020202); // Very dark

      // Studio Lighting
      const mainLight = new THREE.PointLight(0xffffff, 1.5, 100);
      mainLight.position.set(10, 20, 20);
      this.scene.add(mainLight);
      
      const rimLight = new THREE.SpotLight(0x4455ff, 5.0);
      rimLight.position.set(-10, 50, -20);
      rimLight.lookAt(0,0,0);
      this.scene.add(rimLight);
      
      const fillLight = new THREE.PointLight(0xcc6666, 0.5, 100); // Fleshy fill
      fillLight.position.set(0, -10, 10);
      this.scene.add(fillLight);

      // Materials
      const tissueMat = (color: string) => new THREE.MeshPhysicalMaterial({
          color: color,
          roughness: 0.3,
          metalness: 0.1,
          transmission: 0.2, // Slight translucency
          thickness: 2.0,
          clearcoat: 1.0,
          clearcoatRoughness: 0.1,
          map: createOrganTexture(color), // Veiny texture
          normalMap: createNormalNoiseMap(), // Bumpy surface
          normalScale: new THREE.Vector2(0.5, 0.5)
      });
      
      const boneMat = new THREE.MeshStandardMaterial({ 
          color: 0xeeddaa, 
          roughness: 0.6,
          map: createBoneTexture()
      });

      const bodyGroup = new THREE.Group();

      // --- SKELETON ---
      // Spine: Stack of vertebrae
      const spineGroup = new THREE.Group();
      for(let i=0; i<24; i++) {
          const vGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.8, 16);
          sculptMesh(vGeo, 0.2); // Bone irregularities
          const v = new THREE.Mesh(vGeo, boneMat);
          v.position.y = 10 - i * 1.1;
          v.position.z = -3;
          // Curve the spine slightly
          v.position.z += Math.sin(i*0.2) * 1.5; 
          spineGroup.add(v);
      }
      bodyGroup.add(spineGroup);

      // Ribcage: Actual curved ribs
      for(let i=0; i<10; i++) {
          const y = 9 - i * 1.3;
          const size = 5 + Math.sin(i*0.3)*1.5; // Tapering
          
          // Left Rib
          const ribCurveL = new THREE.CatmullRomCurve3([
              new THREE.Vector3(0, y, -3 + Math.sin(i*0.2)*1.5), // Spine
              new THREE.Vector3(size, y-0.5, -1), // Side
              new THREE.Vector3(size*0.6, y-1.5, 3) // Sternum area
          ]);
          const ribL = new THREE.Mesh(new THREE.TubeGeometry(ribCurveL, 12, 0.3, 8, false), boneMat);
          bodyGroup.add(ribL);

          // Right Rib (Mirror)
          const ribCurveR = new THREE.CatmullRomCurve3([
              new THREE.Vector3(0, y, -3 + Math.sin(i*0.2)*1.5),
              new THREE.Vector3(-size, y-0.5, -1),
              new THREE.Vector3(-size*0.6, y-1.5, 3)
          ]);
          const ribR = new THREE.Mesh(new THREE.TubeGeometry(ribCurveR, 12, 0.3, 8, false), boneMat);
          bodyGroup.add(ribR);
      }
      // Sternum
      const sternum = new THREE.Mesh(new THREE.BoxGeometry(1.5, 8, 0.5), boneMat);
      sternum.position.set(0, 4, 3.2);
      sculptMesh(sternum.geometry, 0.1);
      bodyGroup.add(sternum);

      // --- ORGANS ---
      
      // LUNGS: Custom Shape Extrusion for realistic lobes
      const lungShape = new THREE.Shape();
      lungShape.moveTo(0,0);
      lungShape.bezierCurveTo(2, 1, 4, 6, 2, 12); // Outer edge
      lungShape.bezierCurveTo(1, 13, -1, 13, -2, 12); // Top
      lungShape.bezierCurveTo(-2, 4, -1, 1, 0, 0); // Inner edge
      
      const lungGeo = new THREE.ExtrudeGeometry(lungShape, { depth: 3, bevelEnabled: true, bevelSegments: 5, bevelSize: 1, bevelThickness: 1 });
      sculptMesh(lungGeo, 0.1); // Add organic noise

      const lLung = new THREE.Mesh(lungGeo, tissueMat('#dd8888'));
      lLung.scale.set(1.2, 1.2, 1.2);
      lLung.position.set(-1.5, -2, 0);
      lLung.rotation.z = 0.1;
      lLung.rotation.y = 0.2; // Angle outwards
      
      const rLung = new THREE.Mesh(lungGeo, tissueMat('#dd8888'));
      rLung.scale.set(-1.2, 1.2, 1.2); // Mirror
      rLung.position.set(1.5, -2, 0);
      rLung.rotation.z = -0.1;
      rLung.rotation.y = -0.2;

      const lungGroup = new THREE.Group();
      lungGroup.add(lLung); lungGroup.add(rLung);
      lungGroup.name = "Lungs";
      bodyGroup.add(lungGroup);
      this.interactables.push({ name: "Lungs", mesh: lungGroup, data: {} });
      this.organMeshes.push(lLung, rLung); // For breathing anim

      // HEART: Multi-chambered
      const heartGroup = new THREE.Group();
      const hMat = tissueMat('#aa0000');
      const ventricle = new THREE.Mesh(new THREE.SphereGeometry(1.8, 32, 32), hMat);
      ventricle.scale.set(1, 1.4, 0.9);
      ventricle.position.set(0, -0.5, 0.5);
      sculptMesh(ventricle.geometry, 0.2);
      
      const atrium = new THREE.Mesh(new THREE.SphereGeometry(1.4, 32, 32), hMat);
      atrium.position.set(0.5, 1.5, -0.5);
      
      // Aorta
      const aortaPath = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 1.5, 0),
          new THREE.Vector3(-0.5, 3, 0),
          new THREE.Vector3(0, 3.5, -1)
      ]);
      const aorta = new THREE.Mesh(new THREE.TubeGeometry(aortaPath, 16, 0.5, 12, false), tissueMat('#ffcccc'));
      
      heartGroup.add(ventricle); heartGroup.add(atrium); heartGroup.add(aorta);
      heartGroup.position.set(0.5, 3, 1.5); // Between lungs
      heartGroup.rotation.z = -0.2;
      heartGroup.name = "Heart";
      bodyGroup.add(heartGroup);
      this.interactables.push({ name: "Heart", mesh: heartGroup, data: {} });
      this.organMeshes.push(ventricle); // Beat anim

      // LIVER: Wedge
      const liverMat = tissueMat('#552211');
      const liverGeo = new THREE.SphereGeometry(3.5, 64, 64);
      // Deform to wedge
      const lPos = liverGeo.attributes.position;
      for(let i=0; i<lPos.count; i++){
          const x = lPos.getX(i);
          if(x < 0) lPos.setY(i, lPos.getY(i) * 0.4); // Flatten left side
      }
      sculptMesh(liverGeo, 0.1);
      const liver = new THREE.Mesh(liverGeo, liverMat);
      liver.scale.set(1.5, 0.8, 1);
      liver.position.set(-0.5, -2.5, 2);
      liver.rotation.z = 0.1;
      liver.name = "Liver";
      bodyGroup.add(liver);
      this.interactables.push({ name: "Liver", mesh: liver, data: {} });

      // STOMACH
      const stomachGeo = new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
              new THREE.Vector3(0, 2, 0),
              new THREE.Vector3(2, 0, 1),
              new THREE.Vector3(0.5, -3, 0)
          ]), 20, 1.2, 16, false
      );
      sculptMesh(stomachGeo, 0.2);
      const stomach = new THREE.Mesh(stomachGeo, tissueMat('#cc7766'));
      stomach.position.set(2, -3, 1);
      stomach.name = "Stomach";
      bodyGroup.add(stomach);
      this.interactables.push({ name: "Stomach", mesh: stomach, data: {} });

      // INTESTINES: Dense coil
      const intCurvePoints = [];
      for(let i=0; i<400; i++) {
          const t = i/400;
          const angle = t * 30;
          const r = 2.5 - t; 
          const x = Math.cos(angle) * r + (Math.random()-0.5)*0.5;
          const y = -5 - (t*5) + (Math.random()-0.5)*0.5;
          const z = Math.sin(angle) * r + 2 + (Math.random()-0.5)*0.5;
          intCurvePoints.push(new THREE.Vector3(x, y, z));
      }
      const intGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(intCurvePoints), 200, 0.5, 12, false);
      const intestines = new THREE.Mesh(intGeo, tissueMat('#ccaa99'));
      intestines.name = "Intestines";
      bodyGroup.add(intestines);
      this.interactables.push({ name: "Intestines", mesh: intestines, data: {} });
      
      // Large Intestine Frame
      const lgCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-3, -10, 2),
          new THREE.Vector3(-3, -5, 2),
          new THREE.Vector3(3, -5, 2),
          new THREE.Vector3(3, -10, 2)
      ]);
      const lgGeo = new THREE.TubeGeometry(lgCurve, 32, 1.0, 12, false);
      sculptMesh(lgGeo, 0.3); // Very bumpy
      const lgInt = new THREE.Mesh(lgGeo, tissueMat('#885544'));
      bodyGroup.add(lgInt);

      this.scene.add(bodyGroup);
      
      // Animations
      this.animationLoop = () => {
          const t = Date.now()*0.001;
          const beat = 1 + (Math.sin(t*10)>0.5 ? 0.03 : 0);
          ventricle.scale.set(beat, beat*1.4, beat*0.9);
          
          const breath = 1 + Math.sin(t*0.5)*0.03;
          lLung.scale.set(1.2, 1.2*breath, 1.2*breath);
          rLung.scale.set(-1.2, 1.2*breath, 1.2*breath);
          
          if (!this.isExamining) bodyGroup.rotation.y = Math.sin(t * 0.2) * 0.1;
      };
  }

  // --- 3. MOLECULES ---
  setupMolecules() {
      this.cameraDistance = 40;
      this.scene.background = new THREE.Color(0x050510);
      const atoms: THREE.Mesh[] = [];
      const makeAtom = (name: string, color: number, size: number, pos: THREE.Vector3) => {
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 32, 32), new THREE.MeshPhysicalMaterial({ color, roughness: 0.2, metalness: 0.1, clearcoat: 1.0 }));
          mesh.position.copy(pos); mesh.name = name; this.scene.add(mesh); atoms.push(mesh);
          this.interactables.push({ name: `${name} Atom`, mesh, data: {} });
          return mesh;
      };
      const makeBond = (p1: THREE.Vector3, p2: THREE.Vector3, color = 0x999999) => {
          const dist = p1.distanceTo(p2);
          const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, dist, 8), new THREE.MeshStandardMaterial({ color }));
          cyl.position.copy(new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5));
          cyl.lookAt(p2); cyl.rotateX(Math.PI/2); this.scene.add(cyl);
      };

      if (this.moleculeType === 'WATER') {
          const O = makeAtom('Oxygen', 0xff0000, 2.5, new THREE.Vector3(0,0,0));
          const H1 = makeAtom('Hydrogen', 0xffffff, 1.5, new THREE.Vector3(3, 2, 0));
          const H2 = makeAtom('Hydrogen', 0xffffff, 1.5, new THREE.Vector3(-3, 2, 0));
          makeBond(O.position, H1.position); makeBond(O.position, H2.position);
      } else if (this.moleculeType === 'CAFFEINE') {
          const coords = [{x:0, y:4, e:'N'}, {x:3, y:2, e:'C'}, {x:3, y:-2, e:'N'}, {x:0, y:-4, e:'C'}, {x:-3, y:-2, e:'N'}, {x:-3, y:2, e:'C'}, {x:-6, y:0, e:'C'}, {x:-5, y:3, e:'N'}];
          const createdAtoms: any[] = [];
          coords.forEach((c, i) => {
              const color = c.e === 'N' ? 0x0000ff : (c.e === 'O' ? 0xff0000 : 0x333333);
              const atom = makeAtom(c.e === 'N' ? 'Nitrogen' : 'Carbon', color, c.e === 'C' ? 1.8 : 1.6, new THREE.Vector3(c.x, c.y, 0));
              createdAtoms.push(atom);
              if(i > 0 && i < 6) makeBond(createdAtoms[i-1].position, atom.position);
              if(i === 5) makeBond(atom.position, createdAtoms[0].position);
          });
          makeAtom('Oxygen', 0xff0000, 1.5, new THREE.Vector3(5, 4, 0));
          makeAtom('Oxygen', 0xff0000, 1.5, new THREE.Vector3(5, -4, 0));
      } else if (this.moleculeType === 'DNA') {
          this.cameraDistance = 60;
          for(let i=0; i < 20; i++) {
              const angle = (i / 20) * Math.PI * 4; const y = (i / 20) * 40 - 20;
              const p1 = new THREE.Vector3(Math.cos(angle)*8, y, Math.sin(angle)*8);
              const p2 = new THREE.Vector3(Math.cos(angle+Math.PI)*8, y, Math.sin(angle+Math.PI)*8);
              makeAtom('Phosphate', 0xffff00, 1.2, p1); makeAtom('Phosphate', 0xffff00, 1.2, p2);
              const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
              makeBond(p1, mid, 0x3333ff); makeBond(mid, p2, 0xff3333);
          }
      }
      this.animationLoop = () => { if (!this.isExamining) { this.scene.rotation.y += 0.005; } };
  }

  // --- 4. ATOM ---
  setupAtom() {
      this.cameraDistance = 25;
      this.scene.background = new THREE.Color(0x000000);
      const nucleusGroup = new THREE.Group();
      for(let i=0; i<12; i++) {
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), new THREE.MeshStandardMaterial({ color: Math.random()>0.5?0xff3333:0x3333ff, roughness: 0.2 }));
          mesh.position.set(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).multiplyScalar(1.5);
          nucleusGroup.add(mesh);
      }
      nucleusGroup.name = "Nucleus"; this.scene.add(nucleusGroup);
      this.interactables.push({ name: "Nucleus", mesh: nucleusGroup, data: {} });
      const electrons: any[] = [];
      for(let i=0; i<6; i++) {
          const group = new THREE.Group(); group.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
          const el = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ffff }));
          el.position.x = 8 + i * 1.5;
          const ring = new THREE.Mesh(new THREE.RingGeometry(el.position.x-0.05, el.position.x+0.05, 64), new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide, opacity: 0.1, transparent: true }));
          ring.rotation.x = Math.PI/2; group.add(ring); group.add(el); this.scene.add(group);
          electrons.push({ group, speed: 0.015 + Math.random()*0.015 });
          this.interactables.push({ name: "Electron", mesh: el, data: {} });
      }
      this.animationLoop = () => { nucleusGroup.rotation.y += 0.003; electrons.forEach(e => e.group.rotation.z += e.speed); };
  }

  // --- 5. PYRAMID ---
  setupPyramid() {
      this.cameraDistance = 80;
      this.scene.background = new THREE.Color(0x87CEEB);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0xeeddaa, roughness: 1 }));
      floor.rotation.x = -Math.PI/2; floor.position.y = -15; this.scene.add(floor);
      const pyrMat = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.8, flatShading: true });
      const pyramid = new THREE.Mesh(new THREE.ConeGeometry(30, 40, 4), pyrMat);
      pyramid.position.y = 5; pyramid.rotation.y = Math.PI/4; pyramid.name = "The Great Pyramid";
      this.scene.add(pyramid); this.interactables.push({ name: "The Great Pyramid", mesh: pyramid, data: {} });
      const chamberMat = new THREE.MeshStandardMaterial({ color: 0x665544, roughness: 1 });
      const kc = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 12), chamberMat); kc.position.set(0, 5, 0); pyramid.add(kc);
      const qc = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), chamberMat); qc.position.set(0, -5, 0); pyramid.add(qc);
      const gg = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 25), chamberMat); gg.position.set(0, 0, 10); gg.rotation.x = Math.PI/4; pyramid.add(gg);
      this.animationLoop = () => { if (!this.isExamining) this.scene.rotation.y += 0.001; };
  }

  // --- 6. FLOWER ---
  setupFlower() {
      this.cameraDistance = 50;
      this.scene.background = new THREE.Color(0x112211);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.5, 40, 16), new THREE.MeshStandardMaterial({ color: 0x228822 }));
      stem.position.y = -20; this.scene.add(stem);
      const center = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 32), new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.8 }));
      center.name = "Pistil"; this.scene.add(center); this.interactables.push({ name: "Pistil", mesh: center, data: {} });
      const petalShape = new THREE.Shape(); petalShape.moveTo(0,0); petalShape.bezierCurveTo(2, 5, 8, 10, 0, 25); petalShape.bezierCurveTo(-8, 10, -2, 5, 0, 0);
      const petalGeo = new THREE.ExtrudeGeometry(petalShape, { depth: 1, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 2 });
      const petals: THREE.Group[] = [];
      for(let i=0; i<12; i++) {
          const mesh = new THREE.Mesh(petalGeo, new THREE.MeshPhysicalMaterial({ color: 0xff66cc, side: THREE.DoubleSide, roughness: 0.5, clearcoat: 0.5 }));
          mesh.rotation.x = -Math.PI/2;
          const pivot = new THREE.Group(); pivot.add(mesh); pivot.rotation.y = (i/12)*Math.PI*2; pivot.rotation.x = Math.PI/4;
          this.scene.add(pivot); petals.push(pivot); this.interactables.push({ name: "Petal", mesh, data: {} });
      }
      this.animationLoop = () => {
         const time = Date.now() * 0.001;
         let angle = this.gestureName === 'Open_Palm' ? 1.8 : (this.gestureName === 'Closed_Fist' ? 0.2 : 1.0);
         petals.forEach((p, i) => { p.children[0].rotation.x = THREE.MathUtils.lerp(p.children[0].rotation.x, -Math.PI/2 + angle + Math.sin(time+i)*0.05, 0.05); });
      };
  }

  createStarfield() {
    const starCount = 5000;
    const starGeo = new THREE.BufferGeometry();
    const posArray = new Float32Array(starCount * 3);
    for(let i=0; i<starCount; i++) { posArray[i*3] = (Math.random()-0.5) * 2000; posArray[i*3+1] = (Math.random()-0.5) * 2000; posArray[i*3+2] = (Math.random()-0.5) * 2000; }
    starGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.5, color: 0xffffff, transparent: true, opacity: 0.8 })));
  }

  updateCameraPosition() {
    if (!this.isExamining) {
        const x = this.cameraDistance * Math.sin(this.orbitAngle) * Math.cos(this.orbitElevation);
        const y = this.cameraDistance * Math.sin(this.orbitElevation);
        const z = this.cameraDistance * Math.cos(this.orbitAngle) * Math.cos(this.orbitElevation);
        this.camera.position.set(x, y, z); this.camera.lookAt(0, 0, 0);
    }
  }

  checkIntersection(ndcX: number, ndcY: number) {
    if (this.isExamining) return;
    this.mouse.set(ndcX, ndcY); this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactables.map(i=>i.mesh), true);
    if (intersects.length > 0) {
        let hit = intersects[0].object;
        let found = this.interactables.find(i => i.mesh === hit || (hit.parent && i.mesh === hit.parent));
        if (!found) { let p = hit.parent; while(p && p.type !== 'Scene') { found = this.interactables.find(i => i.mesh === p); if(found) break; p = p.parent; } }
        if (found) {
            if (this.lastHoveredObject !== found.name) {
                this.lastHoveredObject = found.name; this.hoveredObjectName = found.name; this.hoverStartTime = Date.now(); this.selectionProgress = 0;
            } else {
                const elapsed = Date.now() - this.hoverStartTime; this.selectionProgress = Math.min(1, elapsed / 2000);
                if (elapsed > 2000) this.selectObject(found);
            }
            return;
        }
    }
    this.lastHoveredObject = null; this.hoveredObjectName = ""; this.selectionProgress = 0;
  }

  selectObject(obj: InteractableObject) {
      if (this.isExamining) return;
      this.isExamining = true; 
      this.statusText = `Inspecting: ${obj.name}`; 
      this.onGameEvent?.("OBJECT_SELECTED", obj.name);
      
      this.currentExaminedPlanet = obj.mesh;
      this.isPlanetBroken = false;
      this.brokenPlanetGroup = null;

      this.hoveredObjectName = ""; this.selectionProgress = 0;
      const targetPos = new THREE.Vector3().copy(obj.mesh.position).normalize().multiplyScalar(this.cameraDistance * 0.4);
      if(obj.mesh.position.length() < 1) targetPos.set(10, 5, 10); else targetPos.add(obj.mesh.position);
      const startPos = this.camera.position.clone();
      const startTime = Date.now();
      const animateCamera = () => {
          const progress = Math.min(1, (Date.now() - startTime) / 1500);
          this.camera.position.lerpVectors(startPos, targetPos, 1 - Math.pow(1 - progress, 3));
          this.camera.lookAt(obj.mesh.position);
          if (progress < 1) requestAnimationFrame(animateCamera);
          else if (this.currentMode === 'PYRAMID') this.applyClipping(obj.mesh);
      };
      animateCamera();
  }

  applyClipping(mesh: THREE.Object3D) {
      this.clippingPlane.constant = 0; this.clippingPlane.normal.set(-1, 0, 0);
      mesh.traverse((child: any) => { if (child.isMesh && child.name !== 'OrbitPath') { child.material.clippingPlanes = [this.clippingPlane]; child.material.clipShadows = true; child.material.needsUpdate = true; } });
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (this.animationLoop) this.animationLoop();
    this.renderer.render(this.scene, this.camera);
  }

  async toggleHandControl() {
    if (this.isModelLoading) return;
    this.handControlActive = !this.handControlActive;
    if (this.handControlActive) await this.initHandTracking(); else this.stopHandTracking();
  }

  async initHandTracking() {
    this.isModelLoading = true;
    try {
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm");
      this.gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task", delegate: "CPU" },
        runningMode: "VIDEO", 
        numHands: 2 // Enable 2 hands for breaking mechanic
      });
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (this.webcamElement) {
        this.webcamElement.srcObject = stream;
        this.webcamElement.onloadedmetadata = () => {
          this.webcamElement!.play();
          if (this.canvasElement) {
              this.canvasElement.width = this.webcamElement!.videoWidth; this.canvasElement.height = this.webcamElement!.videoHeight;
              this.canvasCtx = this.canvasElement.getContext('2d')!; this.drawingUtils = new DrawingUtils(this.canvasCtx);
          }
          this.isModelLoading = false; this.predictWebcam();
        };
      }
    } catch (e) { this.handControlActive = false; this.isModelLoading = false; }
  }

  stopHandTracking() {
    if (this.webcamElement?.srcObject) { (this.webcamElement.srcObject as MediaStream).getTracks().forEach(t => t.stop()); this.webcamElement.srcObject = null; }
    this.handControlActive = false;
  }

  async predictWebcam() {
    if (!this.handControlActive || !this.gestureRecognizer || !this.webcamElement) return;
    const results = this.gestureRecognizer.recognizeForVideo(this.webcamElement, Date.now());
    
    // Default single hand logic for navigation
    let currentGesture = 'None';
    if (results.gestures.length > 0) { currentGesture = results.gestures[0][0].categoryName; this.gestureName = currentGesture; } 
    else this.gestureName = 'None';

    // SPECIAL: Two-handed "Planet Break" Gesture
    // Refactored to use purely GEOMETRIC logic (Left vs Right hand position), ignoring gesture classification
    if (this.currentMode === 'SOLAR_SYSTEM' && this.isExamining && results.landmarks.length === 2 && this.currentExaminedPlanet) {
        // Use Middle Finger MCP (Landmark 9) for stable tracking of hand center
        const hands = results.landmarks.map((lm, i) => ({ 
            lm: lm[9], 
            index: i
        }));
        
        // Sort visually by X coordinate (0 is left side of screen)
        hands.sort((a, b) => a.lm.x - b.lm.x);
        
        const leftHand = hands[0].lm;
        const rightHand = hands[1].lm;
        
        // Metric 1: Distance between hands (Width)
        const dist = rightHand.x - leftHand.x;
        
        // Metric 2: Vertical alignment (Are they at same height?)
        const dy = Math.abs(leftHand.y - rightHand.y);
        
        // Metric 3: Center of the two hands (Should be near 0.5)
        const midX = (leftHand.x + rightHand.x) / 2;
        
        // Thresholds
        const CENTER_TOLERANCE = 0.25; 
        const MAX_VERTICAL_OFFSET = 0.25; 
        const MIN_WIDTH = 0.15; 
        
        const isCentered = Math.abs(midX - 0.5) < CENTER_TOLERANCE;
        const isLevel = dy < MAX_VERTICAL_OFFSET;
        const isWideEnough = dist > MIN_WIDTH;
        
        // Throttled Console Logging for Debugging
        const now = Date.now();
        if (now - this.lastDebugLogTime > 500) {
            console.groupCollapsed("[GESTURE DEBUG] Two Hands Detected");
            console.log(`Dist: ${dist.toFixed(2)} (Req > ${MIN_WIDTH}) -> ${isWideEnough ? 'PASS' : 'FAIL'}`);
            console.log(`Level: ${dy.toFixed(2)} (Req < ${MAX_VERTICAL_OFFSET}) -> ${isLevel ? 'PASS' : 'FAIL'}`);
            console.log(`Center: ${midX.toFixed(2)} (Req ~0.5) -> ${isCentered ? 'PASS' : 'FAIL'}`);
            console.groupEnd();
            this.lastDebugLogTime = now;
        }

        if (isCentered && isLevel && isWideEnough) {
             this.statusText = `SPLITTING... Sep: ${dist.toFixed(2)}`;
             this.handSeparation = dist;
             
             // Trigger break mode if GEOMETRY matches "Holding"
             if (!this.isPlanetBroken) {
                 const currentObj = this.interactables.find(i => i.mesh === this.currentExaminedPlanet);
                 if (currentObj) {
                     console.log("%c[ACTION] Breaking Planet!", "color: red; font-size: 14px;");
                     this.breakPlanet(currentObj);
                 }
             }
        }
        
        // Visual Debug Lines (if enabled)
        if (this.debugMode && this.debugCtx && this.debugOverlay) {
             this.debugCtx.save();
             // Transform for overlay (mirror)
             this.debugCtx.translate(this.debugOverlay.width, 0);
             this.debugCtx.scale(-1, 1);
             
             // Draw connecting line
             this.debugCtx.beginPath();
             this.debugCtx.moveTo(leftHand.x * this.debugOverlay.width, leftHand.y * this.debugOverlay.height);
             this.debugCtx.lineTo(rightHand.x * this.debugOverlay.width, rightHand.y * this.debugOverlay.height);
             this.debugCtx.strokeStyle = (isCentered && isLevel) ? "#00FF00" : "#FF0000"; // Green if locked, Red if not
             this.debugCtx.lineWidth = 5;
             this.debugCtx.stroke();
             this.debugCtx.restore();
        }

    } else {
        // Only run single-hand navigation if we aren't doing the two-handed interaction
        if (results.gestures.length === 1 && results.landmarks.length === 1) {
             this.handleGesture(currentGesture);
        }
    }

    if (this.canvasCtx && this.canvasElement) {
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        
        // --- SMALL CANVAS DRAWING (Sidebar) ---
        if (this.debugMode) {
             for (const landmarks of results.landmarks) {
                 this.drawingUtils?.drawLandmarks(landmarks, { radius: 2, color: "rgba(255,255,255,0.5)", lineWidth: 1 });
             }
        }
    }

    // --- MAIN OVERLAY DRAWING ---
    if (this.debugOverlay && this.debugMode) {
         if (!this.debugCtx) {
             this.debugCtx = this.debugOverlay.getContext('2d')!;
             this.debugDrawingUtils = new DrawingUtils(this.debugCtx);
         }
         // Resize overlay to match container if needed
         if (this.debugOverlay.width !== this.debugOverlay.clientWidth || this.debugOverlay.height !== this.debugOverlay.clientHeight) {
             this.debugOverlay.width = this.debugOverlay.clientWidth;
             this.debugOverlay.height = this.debugOverlay.clientHeight;
         }
         
         // Clear only if we haven't drawn the break-line above (or just clear and redraw landmarks)
         // Since we cleared inside the break-logic for the line, we need to be careful.
         // Simpler approach: Clear everything at start of debug frame, redraw line IF valid.
         // But here we are in a continuous loop. Let's just draw landmarks on top.
         // Actually, let's clear here to be safe, but preserve the line logic from above?
         // No, the line drawing above happens in the same frame tick. 
         // Let's refactor: The `predictWebcam` runs once per frame. 
         // The line drawing block above uses `this.debugCtx`. 
         // If we clear here, we erase the line.
         // So we should NOT clear if we drew the line.
         
         // Helper: check if we are in 2-hand mode
         const isTwoHandMode = (this.currentMode === 'SOLAR_SYSTEM' && this.isExamining && results.landmarks.length === 2);
         
         if (!isTwoHandMode) {
            this.debugCtx.clearRect(0, 0, this.debugOverlay.width, this.debugOverlay.height);
         } 
         // If isTwoHandMode, we didn't clear at start of that block, so previous frame is there?
         // This is getting messy. Let's do a full clean clear at the start of visual debugging always.
         
         // RE-FIXING DRAW ORDER:
         this.debugCtx.clearRect(0, 0, this.debugOverlay.width, this.debugOverlay.height);
         
         this.debugCtx.save();
         this.debugCtx.translate(this.debugOverlay.width, 0);
         this.debugCtx.scale(-1, 1);
         
         // Redraw Break Line if applicable
         if (isTwoHandMode) {
             const hands = results.landmarks.map((lm) => lm[9]).sort((a,b) => a.x - b.x);
             const l = hands[0]; const r = hands[1];
             const dy = Math.abs(l.y - r.y); const midX = (l.x + r.x)/2;
             const good = dy < 0.25 && Math.abs(midX - 0.5) < 0.25;
             
             this.debugCtx.beginPath();
             this.debugCtx.moveTo(l.x * this.debugOverlay.width, l.y * this.debugOverlay.height);
             this.debugCtx.lineTo(r.x * this.debugOverlay.width, r.y * this.debugOverlay.height);
             this.debugCtx.strokeStyle = good ? "#00FF00" : "#FF0000";
             this.debugCtx.lineWidth = 5;
             this.debugCtx.stroke();
         }

         for (const landmarks of results.landmarks) {
             this.debugDrawingUtils?.drawConnectors(landmarks, HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 3 });
             this.debugDrawingUtils?.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 0, radius: 4 });
         }
         this.debugCtx.restore();
    } else if (this.debugOverlay && !this.debugMode && this.debugCtx) {
        this.debugCtx.clearRect(0, 0, this.debugOverlay.width, this.debugOverlay.height);
    }
    
    // Cursor Logic
    if (results.landmarks.length > 0) {
         const lm = results.landmarks[0];
         const indexTip = lm[8];
         if (indexTip && this.cursorElement && currentGesture === 'Pointing_Up') {
             this.cursorElement.style.left = `${(1-indexTip.x)*100}%`; this.cursorElement.style.top = `${indexTip.y*100}%`; this.cursorElement.style.display = 'block';
             this.checkIntersection((1-indexTip.x)*2-1, -(indexTip.y*2-1));
         } else if (this.cursorElement) { this.cursorElement.style.display = 'none'; this.checkIntersection(-2, -2); }
    } else if (this.cursorElement) this.cursorElement.style.display = 'none';

    requestAnimationFrame(() => this.predictWebcam());
  }

  handleGesture(gesture: string) {
    if (this.isExamining) return;
    const now = Date.now();
    const isContinuous = ['Pointing_Up', 'Victory', 'Thumb_Up', 'Thumb_Down', 'Closed_Fist', 'Open_Palm'].includes(gesture);
    if (now - this.lastGestureTime < (isContinuous ? 16 : 300)) return;

    // Speed Logic
    const multipliers = [0.2, 0.5, 0.8, 1.0, 1.5, 2.5, 4.0];
    const speed = multipliers[this.gestureSpeedLevel - 1] || 1.0;

    switch(gesture) {
      case 'Pointing_Up': this.orbitAngle -= 0.01 * speed; this.updateCameraPosition(); this.lastGestureTime = now; break;
      case 'Victory': this.orbitAngle += 0.01 * speed; this.updateCameraPosition(); this.lastGestureTime = now; break;
      case 'Thumb_Up': this.orbitElevation = Math.min(Math.PI/2-0.1, this.orbitElevation + 0.01 * speed); this.updateCameraPosition(); this.lastGestureTime = now; break;
      case 'Thumb_Down': this.orbitElevation = Math.max(-Math.PI/2+0.1, this.orbitElevation - 0.01 * speed); this.updateCameraPosition(); this.lastGestureTime = now; break;
      case 'Closed_Fist': this.cameraDistance = Math.max(20, this.cameraDistance - 0.5 * speed); this.updateCameraPosition(); this.lastGestureTime = now; break;
      case 'Open_Palm': this.cameraDistance = Math.min(300, this.cameraDistance + 0.5 * speed); this.updateCameraPosition(); this.lastGestureTime = now; break;
    }
  }

  setChatState(state: ChatState) { this.chatState = state; }

  addMessage(role: string, message: string) {
    const div = document.createElement('div'); div.classList.add('turn', `role-${role.trim()}`);
    const text = document.createElement('div'); text.className = 'text'; text.textContent = message; div.append(text);
    this.messages = [...this.messages, div]; setTimeout(() => this.anchor?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
    return { textElement: text };
  }

  render() {
    const dashOffset = 113 - (113 * this.selectionProgress);
    return html`
      <div class="cosmos-container">
        <div class="game-view">
          <div id="scene-container"></div>
          <canvas id="debug_overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2001;"></canvas>
          <div id="cursor" style="position: absolute; width: 40px; height: 40px; pointer-events: none; transform: translate(-50%, -50%); z-index: 2000; display: none;">
            <svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255, 255, 255, 0.5)" stroke-width="2" /><circle cx="20" cy="20" r="18" fill="none" stroke="#a855f7" stroke-width="3" stroke-dasharray="113" stroke-dashoffset="${dashOffset}" transform="rotate(-90 20 20)" /><circle cx="20" cy="20" r="3" fill="#a855f7" /></svg>
            ${this.hoveredObjectName ? html`<div style="position: absolute; top: 40px; left: 50%; transform: translateX(-50%); color: white; background: rgba(0,0,0,0.7); padding: 2px 6px; border-radius: 4px; font-size: 12px; white-space: nowrap;">${this.hoveredObjectName}</div>` : ''}
          </div>
          <div class="hud-overlay"><h1 class="game-title">UNIVERSAL EXPLORER</h1><div class="status-indicator">${this.statusText}</div></div>
        </div>
        <div class="sidebar">
          <div class="chat-header">SELECT YOUR LEARNING ADVENTURE</div>
          <div class="control-panel">
            <select style="width: 100%; padding: 8px; margin-bottom: 10px; background: #222; color: white; border: 1px solid #444; border-radius: 4px;" @change=${(e: any) => this.switchMode(e.target.value)}>
                <option value="SOLAR_SYSTEM">🪐 Solar System</option><option value="HUMAN_BODY">🫀 Human Anatomy</option><option value="MOLECULES">🧪 Molecules</option><option value="ATOM">⚛️ The Atom</option><option value="PYRAMID">🐫 Pyramids</option><option value="FLOWER">🌺 Botany</option>
            </select>
            ${this.currentMode === 'MOLECULES' ? html`<select style="width: 100%; padding: 8px; margin-bottom: 10px; background: #333; color: #a855f7; border: 1px solid #555; border-radius: 4px; font-weight: bold;" @change=${(e: any) => this.switchMolecule(e.target.value)}><option value="WATER">💧 Water (H2O)</option><option value="CAFFEINE">☕ Caffeine</option><option value="DNA">🧬 DNA (Genetics)</option></select>` : ''}
            <div class="camera-card">
              <video id="webcam" autoplay playsinline></video><canvas id="output_canvas"></canvas>
              <div class="overlay-info"><div class="gesture-badge">${this.gestureName}</div></div>
              <button style="position: absolute; top: 5px; left: 5px; z-index: 60; background: rgba(0,0,0,0.5); border: none; color: ${this.debugMode ? '#00ff00' : 'white'}; cursor: pointer; padding: 2px 5px; border-radius: 4px; font-size: 10px;" 
                      @click=${() => this.debugMode = !this.debugMode}>
                  DEBUG
              </button>
              <button class="hand-btn ${this.handControlActive ? 'active' : ''}" @click=${(e: Event) => { e.stopPropagation(); this.toggleHandControl(); }} ?disabled=${this.isModelLoading}>${this.isModelLoading ? 'INITIALIZING...' : (this.handControlActive ? 'SENSORS ACTIVE' : 'ACTIVATE SENSORS')}</button>
            </div>
            <div class="legend">
              <div class="legend-item">☝️ Point to Select</div>
              <div class="legend-item">☝️ Orbit Left</div>
              <div class="legend-item">✌️ Orbit Right</div>
              <div class="legend-item">👍 Orbit Up</div>
              <div class="legend-item">👎 Orbit Down</div>
              <div class="legend-item">✊ Zoom In</div>
              <div class="legend-item">👋 Zoom Out</div>
              <div class="legend-item" style="flex-direction: column; justify-content: center; gap: 2px;">
                   <div style="width: 100%; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8;">
                       <span>Speed</span>
                       <span>${this.gestureSpeedLevel}</span>
                   </div>
                   <input type="range" min="1" max="7" step="1" 
                       .value=${this.gestureSpeedLevel} 
                       @input=${(e: any) => this.gestureSpeedLevel = parseInt(e.target.value)}
                       style="width: 100%; accent-color: #a855f7; cursor: pointer; height: 6px;"
                   >
              </div>
            </div>
          </div>
          <div class="chat-messages">${this.messages}<div id="anchor"></div></div>
          <div class="chat-input-area"><div class="input-wrap"><input type="text" .value=${this.inputMessage} @input=${(e:any) => this.inputMessage = e.target.value} @keydown=${(e:KeyboardEvent) => e.key === 'Enter' && this.sendMessageHandler?.(this.inputMessage)} placeholder="Ask questions..."><button class="send-btn" @click=${() => this.sendMessageHandler?.(this.inputMessage)}>🚀</button></div></div>
        </div>
      </div>
    `;
  }
}
