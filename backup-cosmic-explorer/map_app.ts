/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {Loader} from '@googlemaps/js-api-loader';
import hljs from 'highlight.js';
import {html, LitElement, PropertyValueMap} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {Marked} from 'marked';
import {markedHighlight} from 'marked-highlight';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration, Blob, Tool } from '@google/genai';
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { searchYelp, YelpBusiness } from './yelp_api';

export interface MapParams {
  location?: string;
  origin?: string;
  destination?: string;
  search?: string;
  businesses?: YelpBusiness[];
  highlightIndex?: number;
  latitude?: number;
  longitude?: number;
}

let markedInstance: Marked | undefined;
export async function parseMarkdown(text: string): Promise<string> {
  if (!markedInstance) {
    markedInstance = new Marked(
      markedHighlight({
        async: true,
        emptyLangClass: 'hljs',
        langPrefix: 'hljs language-',
        highlight(code, lang, info) {
          const language = hljs.getLanguage(lang) ? lang : 'plaintext';
          return hljs.highlight(code, {language}).value;
        },
      }),
    );
  }
  return markedInstance.parse(text);
}

const ICON_BUSY = html`<svg class="rotating" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z" /></svg>`;
const ICON_HAND = html`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M400-240q-17 0-28.5-11.5T360-280v-360q0-17 11.5-28.5T400-680q17 0 28.5 11.5T440-640v360q0 17-11.5 28.5T400-240Zm-120 0q-17 0-28.5-11.5T240-280v-200q0-17 11.5-28.5T280-520q17 0 28.5 11.5T320-480v200q0 17-11.5 28.5T280-240Zm240 0q-17 0-28.5-11.5T480-280v-440q0-17 11.5-28.5T520-760q17 0 28.5 11.5T560-720v440q0 17-11.5 28.5T520-240Zm120 0q-17 0-28.5-11.5T600-280v-320q0-17 11.5-28.5T640-640q17 0 28.5 11.5T680-600v320q0 17-11.5 28.5T640-240ZM480-80q-55 0-101.5-24.5T297-172l-85-84q-17-16-19.5-39t17.5-43q18-20 45-18.5t43 24.5l62 62v-370q0-50 35-85t85-35q50 0 85 35t35 85v370l62-62q16-23 43-24.5t45 18.5q20 20 17.5 43t-19.5 39l-85 84q-35 36-81.5 60.5T480-80Z"/></svg>`;
const ICON_DEBUG = html`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M360-120v-80h240v80H360Zm40-240v-108L242-602l58-58 140 140 140-140 58 58-158 134v108h-80ZM160-200v-80h80v80h-80Zm560 0v-80h80v80h-80ZM280-600v-80h58l102-102v-58h80v58l102 102h58v80H280Zm0 200v-80h400v80H280Zm200-280q-33 0-56.5-23.5T400-560q0-33 23.5-56.5T480-640q33 0 56.5 23.5T560-560q0 33-23.5 56.5T480-480Z"/></svg>`;
const ICON_SPEED = html`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M480-80q-138 0-245.5-83T86-360h78q41 84 122 142t194 58q142 0 241-99t99-241q0-142-99-241T480-740q-96 0-176.5 45.5T182-570h98v80H80v-200h80v87q62-65 146.5-101T480-820q83 0 156 31.5T763-703q54 54 85.5 127T880-420q0 83-31.5 156T763-137q-54 54-127 85.5T480-80Zm-40-386v-214h80v168l118 118-56 56-142-128Z"/></svg>`;
const ICON_MIC = html`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Zm40-360q17 0 28.5-11.5T520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480Z"/></svg>`;
const ICON_MIC_OFF = html`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Zm40-360q17 0 28.5-11.5T520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480Z"/></svg>`;
const ICON_LIVE = html`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M280-280v-400h80v400h-80Zm160 160v-720h80v720h-80Zm160-160v-400h80v400h-80Z"/></svg>`;

const CATEGORY_EMOJIS = {
  ITALIAN: "🍝", CHINESE: "🥡", INDIAN: "🍛", FAST_FOOD: "🍟", BREAKFAST: "🥞", BAKERY: "🍩", BAR: "🍻", DISCO: "🪩", 
  FOOD_DEFAULT: "🍽️", SHOPPING: "🛍️", BUILDING: "🏢"
};
export enum ChatState { IDLE, GENERATING, THINKING, EXECUTING }
enum ChatTab { GEMINI }
export enum ChatRole { USER, ASSISTANT, SYSTEM }
const USER_PROVIDED_GOOGLE_MAPS_API_KEY: string = 'AIzaSyAJPTwj4S8isr4b-3NtqVSxk450IAS1lOQ';
const EXAMPLE_PROMPTS = [
  "Find me the best sushi in Los Angeles",
  "Show me cheap pizza places near Times Square",
  "Where can I get good coffee in Seattle?",
  "Show me directions from Tokyo Tower to Shibuya Crossing.",
  "Can you show me a beautiful beach?",
  "Find highly rated italian restaurants in Rome",
  "Show me San Francisco",
];

const TOOLS_CONFIG: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'view_location_google_maps',
        description:
          'View a specific query or geographical location and display in the embedded maps interface',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'The location to search for.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'directions_on_google_maps',
        description:
          'Search google maps for directions from origin to destination.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            origin: {type: Type.STRING, description: 'Starting point. CRITICAL: Use "user_location" if the user wants to start from their current position (e.g., "from here", "from my location").'},
            destination: {type: Type.STRING, description: 'Ending point'},
          },
          required: ['origin', 'destination'],
        },
      },
      {
        name: 'search_yelp',
        description:
          'Search for businesses using Yelp. Use this for finding restaurants, shops, services, etc.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            location: {
              type: Type.STRING,
              description: 'The area to search. CRITICAL: Use "user_location" for finding things near the user\'s current real-world position.'
            },
            term: {
              type: Type.STRING,
              description: 'Search term (e.g. "food", "restaurants", "barbers").'
            },
            price: {
              type: Type.STRING,
              description: 'Pricing levels to filter the search result: 1 = $, 2 = $$, 3 = $$$, 4 = $$$$.'
            },
            open_now: {
              type: Type.BOOLEAN,
              description: 'Default to false. If true, only return businesses that are currently open.'
            }
          },
          required: ['location', 'term']
        }
      },
      {
        name: 'highlight_business',
        description:
          'Highlight a specific business by index from the previously searched list on the map. Use this to tour or focus on specific results.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            index: {
              type: Type.NUMBER,
              description: 'The index of the business to highlight (0-based) from the previous search results.'
            }
          },
          required: ['index']
        }
      },
      {
        name: 'identify_current_location',
        description: 'Identify what is currently at the center of the user\'s map view. Use this when the user asks "what is this place", "what am I looking at", or "tell me about here".',
        parameters: {
          type: Type.OBJECT,
          properties: {}, // No params needed, context comes from app state
        }
      }
    ],
  },
];

const SYSTEM_INSTRUCTIONS = `You are a helpful, enthusiastic Yelp Local Expert and 3D Map Guide.
Your goal is to have a natural voice conversation with the user to help them discover places.
**Always speak in English.**

**Location Handling:**
- Whenever the user says "near me", "around here", or "from here", **ALWAYS** use the special value "user_location" for any location or origin parameters.
- Do NOT ask the user for their current address or city if they imply they are at their current location.

**Core Tools:**
1.  **search_yelp**: Use this to find specific things (e.g. "find sushi", "gas station").
2.  **view_location_google_maps**: Use this to fly to a general area (e.g. "go to Paris").
3.  **directions_on_google_maps**: Use this when the user wants a route.
    *   **CRITICAL:** If the user asks to go "from here", "from my location", or says "take me there", **YOU MUST set 'origin' to the exact string "user_location"**. 
4.  **identify_current_location**: Use this immediately if the user asks "what is this?", "what's this place?", "tell me about this building", or "what am I looking at?". 

**Touring Mode:**
If the user asks to "tour" results, search then iterate through them using 'highlight_business'.

**Interaction:**
Always be concise. If identifying a location, mention the name and rating if available.
**Always speak in English.**
`;

// ... (Audio Utils) ...
function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    const val = Math.max(-1, Math.min(1, data[i]));
    int16[i] = val * 32767;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --------------------------------------------------------------------------------
// CATEGORY MAPPING LOGIC - ENSURED CHINESE -> 🥡
// --------------------------------------------------------------------------------
function getCategoryEmoji(business: YelpBusiness): string {
    const aliasMap: Record<string, string> = {
        'chinese': CATEGORY_EMOJIS.CHINESE,
        'dimsum': CATEGORY_EMOJIS.CHINESE,
        'cantonese': CATEGORY_EMOJIS.CHINESE,
        'szechuan': CATEGORY_EMOJIS.CHINESE,
        'hotpot': CATEGORY_EMOJIS.CHINESE,
        'shanghainese': CATEGORY_EMOJIS.CHINESE,
        'taiwanese': CATEGORY_EMOJIS.CHINESE,
        'asian': CATEGORY_EMOJIS.CHINESE, // Generic fallback
        
        'italian': CATEGORY_EMOJIS.ITALIAN,
        'pizza': CATEGORY_EMOJIS.ITALIAN,
        'pasta': CATEGORY_EMOJIS.ITALIAN,
        
        'indpak': CATEGORY_EMOJIS.INDIAN,
        'indian': CATEGORY_EMOJIS.INDIAN,
        
        'burgers': CATEGORY_EMOJIS.FAST_FOOD,
        'fastfood': CATEGORY_EMOJIS.FAST_FOOD,
        
        'breakfast_brunch': CATEGORY_EMOJIS.BREAKFAST,
        'bakeries': CATEGORY_EMOJIS.BAKERY,
        
        'bars': CATEGORY_EMOJIS.BAR,
        'cocktailbars': CATEGORY_EMOJIS.BAR,
        'pubs': CATEGORY_EMOJIS.BAR,
        
        'danceclubs': CATEGORY_EMOJIS.DISCO,
        'shopping': CATEGORY_EMOJIS.SHOPPING,
        'grocery': CATEGORY_EMOJIS.SHOPPING
    };

    if (business.categories) {
        for (const cat of business.categories) {
            const alias = cat.alias.toLowerCase();
            if (aliasMap[alias]) return aliasMap[alias];
        }
    }

    const combined = (
        business.categories.map(c => c.title).join(' ') + ' ' + 
        business.categories.map(c => c.alias).join(' ') + ' ' + 
        business.name
    ).toLowerCase();

    // Force check for Chinese keywords
    if (combined.includes('chinese') || combined.includes('dim sum') || combined.includes('dumpling') || combined.includes('szechuan')) {
        return CATEGORY_EMOJIS.CHINESE;
    }
    
    if (combined.includes('italian')) return CATEGORY_EMOJIS.ITALIAN;
    if (combined.includes('indian')) return CATEGORY_EMOJIS.INDIAN;
    if (combined.includes('burger')) return CATEGORY_EMOJIS.FAST_FOOD;
    if (combined.includes('bakery')) return CATEGORY_EMOJIS.BAKERY;
    if (combined.includes('bar') || combined.includes('pub')) return CATEGORY_EMOJIS.BAR;
    if (combined.includes('restaurant') || combined.includes('food') || combined.includes('cafe')) return CATEGORY_EMOJIS.FOOD_DEFAULT;
    
    return CATEGORY_EMOJIS.BUILDING; 
}


@customElement('gdm-map-app')
export class MapApp extends LitElement {
  @query('#anchor') anchor?: HTMLDivElement;
  @query('#mapContainer') mapContainerElement?: HTMLElement;
  @query('#messageInput') messageInputElement?: HTMLInputElement;
  @query('#webcam') webcamElement?: HTMLVideoElement;
  @query('#outputCanvas') outputCanvasElement?: HTMLCanvasElement;
  @query('#hand-cursor') cursorElement?: HTMLElement;
  @query('.main-container') mainContainer?: HTMLElement;
  @query('#gesture-label') gestureLabel?: HTMLElement;

  @state() chatState = ChatState.IDLE;
  @state() isRunning = true;
  @state() selectedChatTab = ChatTab.GEMINI;
  @state() inputMessage = '';
  @state() messages: HTMLElement[] = [];
  @state() mapInitialized = false;
  @state() mapError = '';
  @state() handControlEnabled = false;
  @state() isHandModelLoading = false;
  @state() debugEnabled = false;
  @state() speedLevel = 4;
  @state() isLiveConnected = false;
  @state() hoveredBusiness: YelpBusiness | null = null;
  
  private inputAudioContext?: AudioContext;
  private outputAudioContext?: AudioContext;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private sessionPromise?: Promise<any>;
  private currentSession?: any;
  private gestureRecognizer?: GestureRecognizer;
  private isHandDetectionRunning = false;
  private canvasCtx?: CanvasRenderingContext2D;
  private readonly PAN_SENSITIVITY_BASE = 0.0001;
  private readonly ZOOM_SENSITIVITY_BASE = 0.01;
  private readonly SPEED_MULTIPLIERS = [0.2, 0.5, 0.8, 1.0, 1.5, 2.5, 4.0];
  private hasLoggedError = false;
  private map?: any;
  private geocoder?: any;
  private marker?: any;
  private yelpMarkers: any[] = [];
  private yelpBusinesses: YelpBusiness[] = [];
  private Map3DElement?: any;
  private Marker3DElement?: any;
  private Polyline3DElement?: any;
  private directionsService?: any;
  private routePolyline?: any;
  private originMarker?: any;
  private destinationMarker?: any;
  sendMessageHandler?: CallableFunction;

  constructor() {
    super();
    this.setNewRandomPrompt();
  }

  createRenderRoot() { return this; }

  protected firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
    this.loadMap();
    if (this.outputCanvasElement) {
        this.canvasCtx = this.outputCanvasElement.getContext('2d')!;
    }
  }

  public getMapCenter(): { lat: number; lng: number } {
      if (this.map && this.map.center) {
          return { lat: this.map.center.lat, lng: this.map.center.lng };
      }
      return { lat: 0, lng: 0 };
  }

  async getUserLocation(): Promise<{lat: number, lng: number}> {
      return new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
              reject(new Error('Geolocation not supported'));
              return;
          }
          navigator.geolocation.getCurrentPosition(
              (position) => {
                  resolve({
                      lat: position.coords.latitude,
                      lng: position.coords.longitude
                  });
              },
              (error) => reject(error),
              { enableHighAccuracy: true, timeout: 5000 }
          );
      });
  }

  private setNewRandomPrompt() {
    if (EXAMPLE_PROMPTS.length > 0) {
      this.inputMessage = EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
    }
  }
  async loadMap() {
    const isApiKeyPlaceholder =
      USER_PROVIDED_GOOGLE_MAPS_API_KEY ===
        'YOUR_ACTUAL_GOOGLE_MAPS_API_KEY_REPLACE_ME' ||
      USER_PROVIDED_GOOGLE_MAPS_API_KEY === '';
    if (isApiKeyPlaceholder) {
      this.mapError = `Google Maps API Key error...`;
      console.error(this.mapError);
      return;
    }
    const loader = new Loader({
      apiKey: USER_PROVIDED_GOOGLE_MAPS_API_KEY,
      version: 'beta',
      libraries: ['geocoding', 'routes', 'geometry'],
    });
    try {
      const maps3dLibrary = await (loader as any).importLibrary('maps3d') as any;
      await (loader as any).importLibrary('geocoding');
      await (loader as any).importLibrary('routes');
      await (loader as any).importLibrary('geometry');
      this.Map3DElement = maps3dLibrary.Map3DElement;
      this.Marker3DElement = maps3dLibrary.Marker3DElement;
      this.Polyline3DElement = maps3dLibrary.Polyline3DElement;
      if ((window as any).google && (window as any).google.maps) {
        this.directionsService = new (window as any).google.maps.DirectionsService();
      }
      this.initializeMap();
      this.mapInitialized = true;
      this.mapError = '';
    } catch (error) {
      console.error('Error loading Google Maps API:', error);
      this.mapError = 'Could not load Google Maps.';
      this.mapInitialized = false;
    }
  }
  initializeMap() {
    if (!this.mapContainerElement || !this.Map3DElement) return;
    this.map = this.mapContainerElement;
    if ((window as any).google && (window as any).google.maps) {
      this.geocoder = new (window as any).google.maps.Geocoder();
    }
  }

  async toggleLiveMode() {
    if (this.isLiveConnected) this.disconnectLive();
    else await this.connectLive();
  }
  async connectLive() {
    if (!process.env.API_KEY) { alert("API Key not available."); return; }
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        await this.inputAudioContext!.resume();
        await this.outputAudioContext!.resume();
        this.nextStartTime = 0;
        const outputNode = this.outputAudioContext.createGain();
        outputNode.connect(this.outputAudioContext.destination);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                tools: TOOLS_CONFIG,
                responseModalities: [Modality.AUDIO],
                systemInstruction: SYSTEM_INSTRUCTIONS,
            },
            callbacks: {
                onopen: async () => {
                    console.log("Live Session Connected");
                    this.isLiveConnected = true;
                    const source = this.inputAudioContext!.createMediaStreamSource(stream);
                    const processor = this.inputAudioContext!.createScriptProcessor(2048, 1, 1);
                    const muteGain = this.inputAudioContext!.createGain();
                    muteGain.gain.value = 0;
                    processor.onaudioprocess = (e) => {
                        const inputData = e.inputBuffer.getChannelData(0);
                        const pcmBlob = createBlob(inputData);
                        this.sessionPromise!.then(session => { session.sendRealtimeInput({ media: pcmBlob }); });
                    };
                    source.connect(processor);
                    processor.connect(muteGain);
                    muteGain.connect(this.inputAudioContext!.destination);
                },
                onmessage: async (msg: LiveServerMessage) => {
                    if (msg.toolCall) {
                        for (const fc of msg.toolCall.functionCalls) {
                            console.log("Live Tool Call:", fc.name, fc.args);
                            let result = {};
                            try {
                                result = await this.executeLiveTool(fc.name, fc.args);
                            } catch (e: any) {
                                result = { error: e.message };
                            }
                            this.sessionPromise!.then(session => {
                                session.sendToolResponse({
                                    functionResponses: { id: fc.id, name: fc.name, response: { result: result } }
                                });
                            });
                        }
                    }
                    const base64Audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                    if (base64Audio && this.outputAudioContext) {
                        const audioBuffer = await decodeAudioData(decode(base64Audio), this.outputAudioContext, 24000, 1);
                        this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
                        const source = this.outputAudioContext.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(outputNode);
                        source.start(this.nextStartTime);
                        this.nextStartTime += audioBuffer.duration;
                        this.sources.add(source);
                        source.onended = () => this.sources.delete(source);
                    }
                    if (msg.serverContent?.interrupted) {
                        this.sources.forEach(s => s.stop());
                        this.sources.clear();
                        this.nextStartTime = 0;
                    }
                },
                onclose: (e) => { 
                    console.log("Live Session Closed", e); 
                    this.isLiveConnected = false; 
                },
                onerror: (e) => { console.error("Live Session Error", e); this.isLiveConnected = false; }
            }
        });
        
        this.currentSession = await this.sessionPromise;

    } catch (e) { console.error("Failed to connect live", e); this.isLiveConnected = false; }
  }
  disconnectLive() {
    if (this.currentSession) {
        this.currentSession.close();
        this.currentSession = undefined;
    }
    if (this.inputAudioContext) this.inputAudioContext.close();
    if (this.outputAudioContext) this.outputAudioContext.close();
    this.isLiveConnected = false;
  }
  async executeLiveTool(name: string, args: any): Promise<any> {
      if (name === 'identify_current_location') {
          const center = this.getMapCenter();
          try {
              const result = await searchYelp(null, "business", undefined, undefined, center.lat, center.lng);
              if (result.businesses && result.businesses.length > 0) {
                  const top3 = result.businesses.slice(0, 3);
                  this._displayYelpBusinesses(top3);
                  this._highlightBusiness(0);
                  const descriptions = top3.map(b => `${b.name} (${b.categories.map(c => c.title).join(', ')}, ${b.rating} stars)`).join('; ');
                  return { summary: `At this location, I found: ${descriptions}.` };
              } else {
                  return { summary: "I couldn't identify a business at the center of your view." };
              }
          } catch(e: any) {
              return { error: e.message };
          }
      } else if (name === 'search_yelp') {
          let { location, term, price, open_now } = args;
          let lat, lng;
          if (location === 'user_location') {
              try {
                  const userLoc = await this.getUserLocation();
                  lat = userLoc.lat; lng = userLoc.lng;
                  location = null;
              } catch(e) { return { error: "Could not get user location" }; }
          }
          const result = await searchYelp(location, term, price, open_now, lat, lng);
          if (result.businesses) this._displayYelpBusinesses(result.businesses);
          return {
              summary: `Found ${result.businesses?.length || 0} results. Top result: ${result.businesses?.[0]?.name || 'None'}.`,
              data: result.businesses?.slice(0, 5)
          };
      } else if (name === 'view_location_google_maps') {
          const { query } = args;
          this._handleViewLocation(query);
          return { status: "displayed", location: query };
      } else if (name === 'directions_on_google_maps') {
          let { origin, destination } = args;
          if (origin === "user_location") {
              try {
                  const userLoc = await this.getUserLocation();
                  this._handleDirections(userLoc, destination);
                  return { status: "displayed", origin: "User Location", destination };
              } catch(e: any) { return { error: "Could not get user location" }; }
          } else {
              this._handleDirections(origin, destination);
              return { status: "displayed", origin, destination };
          }
      } else if (name === 'highlight_business') {
          const { index } = args;
          this._highlightBusiness(index);
          return { status: "highlighted", index };
      }
      return { error: "Unknown tool" };
  }

  async toggleHandControl() {
    this.handControlEnabled = !this.handControlEnabled;
    if (this.handControlEnabled) await this.startHandTracking();
    else this.stopHandTracking();
  }
  toggleDebug() { this.debugEnabled = !this.debugEnabled; }
  
  async startHandTracking() {
    if (this.isHandModelLoading) return;
    if (!this.webcamElement) return;
    this.isHandModelLoading = true;
    
    // Suppress TFLite/MediaPipe info logs
    const originalLog = console.log; 
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const suppressed = (...args: any[]) => { 
        const msg = args.map(String).join(' '); 
        if (!msg.includes('TensorFlow Lite') && !msg.includes('XNNPACK') && !msg.includes('WASM')) {
            originalLog.apply(console, args);
        }
    };
    console.log = suppressed; console.info = suppressed; console.warn = suppressed;

    try {
        await this.setupCamera();
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm");
        this.gestureRecognizer = await GestureRecognizer.createFromOptions(vision, { 
            baseOptions: { 
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task", 
                delegate: "GPU" 
            }, 
            runningMode: "VIDEO", 
            numHands: 1 
        });
        this.isHandDetectionRunning = true;
        this.isHandModelLoading = false;
        this.detectHands();
    } catch (error) {
        console.error("Error starting hand tracking:", error);
        this.handControlEnabled = false;
        this.isHandModelLoading = false;
    } finally {
        setTimeout(() => { console.log = originalLog; console.info = originalInfo; console.warn = originalWarn; }, 2000);
    }
  }

  stopHandTracking() {
    this.isHandDetectionRunning = false;
    if (this.webcamElement && this.webcamElement.srcObject) {
        const stream = this.webcamElement.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        this.webcamElement.srcObject = null;
    }
    if (this.cursorElement) this.cursorElement.style.display = 'none';
  }
  async setupCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: 640, height: 480 } });
    if (this.webcamElement) { this.webcamElement.srcObject = stream; return new Promise<void>(resolve => { this.webcamElement!.onloadedmetadata = () => { this.webcamElement!.play(); resolve(); }; }); }
  }
  async detectHands() {
    if (!this.isHandDetectionRunning || !this.gestureRecognizer || !this.webcamElement || !this.outputCanvasElement || !this.canvasCtx || !this.mainContainer) return;
    try {
        const vw = this.webcamElement.videoWidth; 
        const vh = this.webcamElement.videoHeight;
        if (this.webcamElement.readyState >= 2 && vw > 0 && vh > 0) {
            if (this.outputCanvasElement.width !== this.mainContainer.clientWidth || this.outputCanvasElement.height !== this.mainContainer.clientHeight) { 
                this.outputCanvasElement.width = this.mainContainer.clientWidth; this.outputCanvasElement.height = this.mainContainer.clientHeight; 
            }
            this.canvasCtx.clearRect(0, 0, this.outputCanvasElement.width, this.outputCanvasElement.height);
            const results = this.gestureRecognizer.recognizeForVideo(this.webcamElement, Date.now());
            if (results.gestures.length > 0) {
                const scale = Math.max(this.outputCanvasElement.width / vw, this.outputCanvasElement.height / vh);
                const offsetX = (this.outputCanvasElement.width - vw * scale) / 2;
                const offsetY = (this.outputCanvasElement.height - vh * scale) / 2;
                const toScreen = (x: number, y: number) => ({ x: (1.0 - x) * (vw * scale) + offsetX, y: y * (vh * scale) + offsetY });
                if (this.debugEnabled && results.landmarks[0]) this.drawHand(results.landmarks[0], this.canvasCtx, toScreen);
                if (results.gestures[0] && results.gestures[0][0] && results.landmarks[0]) {
                     this.handleGestureAction(results.gestures[0][0], results.landmarks[0], toScreen);
                }
            } else { if (this.cursorElement) this.cursorElement.style.display = 'none'; }
        }
    } catch (e) {} finally { if (this.isHandDetectionRunning) requestAnimationFrame(() => this.detectHands()); }
  }
  drawHand(lm: any[], ctx: CanvasRenderingContext2D, toScreen: Function) {
      ctx.fillStyle = 'cyan'; ctx.strokeStyle = 'magenta'; ctx.lineWidth = 4;
      const conns = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];
      for(const [s,e] of conns) { const p1 = toScreen(lm[s].x, lm[s].y); const p2 = toScreen(lm[e].x, lm[e].y); ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
      for(const p of lm) { const pt = toScreen(p.x, p.y); ctx.beginPath(); ctx.arc(pt.x, pt.y, 6, 0, 2 * Math.PI); ctx.fill(); }
  }
  handleGestureAction(gesture: any, lm: any[], toScreen: Function) {
      if (gesture.score < 0.5) return;
      if (this.gestureLabel) { this.gestureLabel.style.display = 'block'; this.gestureLabel.innerText = `Gesture: ${gesture.categoryName}`; }
      const idx = lm[8];
      if (idx) { 
          const p = toScreen(idx.x, idx.y); 
          if (this.cursorElement) { this.cursorElement.style.display = 'block'; this.cursorElement.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`; }
          switch(gesture.categoryName) {
              case 'Thumb_Up': this.moveMap(0, -1); break;
              case 'Thumb_Down': this.moveMap(0, 1); break;
              case 'Victory': this.moveMap(1, 0); break;
              case 'Pointing_Up': this.moveMap(-1, 0); break;
              case 'Closed_Fist': this.zoomMap(-1, p.x, p.y); break;
              case 'Open_Palm': this.zoomMap(1, p.x, p.y); break;
          }
      }
  }
  get currentMultiplier() { const idx = Math.max(0, Math.min(this.speedLevel - 1, this.SPEED_MULTIPLIERS.length - 1)); return this.SPEED_MULTIPLIERS[idx]; }
  moveMap(dx: number, dy: number) {
      if (!this.map || !this.map.center) return;
      const range = this.map.range || 2000;
      const factor = range * this.PAN_SENSITIVITY_BASE * this.currentMultiplier * 0.0001;
      this.map.center = { lat: this.map.center.lat - (dy * factor), lng: this.map.center.lng + (dx * factor), altitude: this.map.center.altitude };
  }
  zoomMap(dir: number, cx?: number, cy?: number) {
      if (!this.map || !this.map.range) return;
      const sens = this.ZOOM_SENSITIVITY_BASE * this.currentMultiplier;
      let newRange = this.map.range * (1 + (dir * sens));
      this.map.range = Math.max(100, Math.min(newRange, 20000000));
  }
  setChatState(state: ChatState) { this.chatState = state; }
  private _clearMapElements() {
      if (this.marker) { this.marker.remove(); this.marker = undefined; }
      if (this.routePolyline) { this.routePolyline.remove(); this.routePolyline = undefined; }
      if (this.originMarker) { this.originMarker.remove(); this.originMarker = undefined; }
      if (this.destinationMarker) { this.destinationMarker.remove(); this.destinationMarker = undefined; }
      if (this.yelpMarkers.length > 0) { this.yelpMarkers.forEach(m => m.remove()); this.yelpMarkers = []; }
      this.yelpBusinesses = [];
  }
  private async _handleViewLocation(locationQuery: string) {
    if (!this.mapInitialized || !this.map || !this.geocoder || !this.Marker3DElement) return;
    this._clearMapElements();
    this.geocoder.geocode({address: locationQuery}, async (results: any, status: string) => {
        if (status === 'OK' && results && results[0]) {
          const loc = results[0].geometry.location;
          (this.map as any).flyCameraTo({ endCamera: { center: {lat: loc.lat(), lng: loc.lng(), altitude: 0}, heading: 0, tilt: 67.5, range: 2000 }, durationMillis: 1500 });
          this.marker = new this.Marker3DElement();
          this.marker.position = { lat: loc.lat(), lng: loc.lng(), altitude: 0 };
          this.marker.label = locationQuery;
          this.map.appendChild(this.marker);
        }
    });
  }
  private async _displayYelpBusinesses(businesses: YelpBusiness[]) {
    if (!this.mapInitialized || !this.map || !this.Marker3DElement) return;
    this._clearMapElements();
    this.yelpBusinesses = businesses;
    if (businesses.length === 0) return;
    const bounds = new (window as any).google.maps.LatLngBounds();
    for (const b of businesses) {
        const lat = b.coordinates.latitude;
        const lng = b.coordinates.longitude;
        bounds.extend({ lat, lng });
        const marker = new this.Marker3DElement();
        marker.position = { lat, lng, altitude: 0 };
        const color = b.rating >= 4.5 ? '#00d664' : (b.rating >= 4.0 ? '#ffae00' : '#ff4444');
        const emoji = getCategoryEmoji(b);
        
        // ----------------------------------------------------------------------
        // FIX: Use valid SVG inside template.innerHTML to satisfy strict type requirements.
        // ----------------------------------------------------------------------
        const template = document.createElement('template');
        template.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="30" fill="white" stroke="${color}" stroke-width="4" />
            <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="32">${emoji}</text>
          </svg>`;
        
        marker.appendChild(template);
        marker.addEventListener('mouseover', () => { this.hoveredBusiness = b; });
        marker.addEventListener('gmp-click', () => { window.open(b.url, '_blank'); });
        this.map.appendChild(marker);
        this.yelpMarkers.push(marker);
    }
    const center = bounds.getCenter();
    (this.map as any).flyCameraTo({ endCamera: { center: { lat: center.lat(), lng: center.lng(), altitude: 0 }, heading: 0, tilt: 45, range: 4000 }, durationMillis: 2000 });
  }
  private _highlightBusiness(index: number) {
      if (!this.map || !this.yelpBusinesses || index < 0 || index >= this.yelpBusinesses.length) return;
      const b = this.yelpBusinesses[index];
      this.hoveredBusiness = b;
      (this.map as any).flyCameraTo({ endCamera: { center: { lat: b.coordinates.latitude, lng: b.coordinates.longitude, altitude: 0 }, heading: 0, tilt: 60, range: 800 }, durationMillis: 1500 });
  }

  async handleTakeMeThere(business: YelpBusiness) {
      if (!this.directionsService) return;
      try {
          const userLoc = await this.getUserLocation();
          this.hoveredBusiness = null;
          this._handleDirections(userLoc, { lat: business.coordinates.latitude, lng: business.coordinates.longitude });
      } catch (e) { alert("Please grant location permissions."); }
  }

  private async _handleDirections(origin: any, destination: any) {
    if (!this.mapInitialized || !this.map || !this.directionsService || !this.Marker3DElement || !this.Polyline3DElement) return;
    this._clearMapElements();
    this.directionsService.route({ origin, destination, travelMode: (window as any).google.maps.TravelMode.DRIVING }, async (response: any, status: string) => {
        if (status === 'OK' && response?.routes?.length > 0) {
          const route = response.routes[0];
          this.routePolyline = new this.Polyline3DElement();
          this.routePolyline.coordinates = route.overview_path.map((p: any) => ({ lat: p.lat(), lng: p.lng(), altitude: 50 }));
          this.routePolyline.strokeColor = 'blue';
          this.routePolyline.strokeWidth = 10;
          this.map.appendChild(this.routePolyline);
          
          if (route.bounds) {
             const c = route.bounds.getCenter();
             let range = 10000;
             if ((window as any).google.maps.geometry?.spherical) {
                 range = (window as any).google.maps.geometry.spherical.computeDistanceBetween(route.bounds.getNorthEast(), route.bounds.getSouthWest()) * 1.7;
             }
             (this.map as any).flyCameraTo({ endCamera: { center: {lat: c.lat(), lng: c.lng(), altitude: 0}, heading: 0, tilt: 45, range: Math.max(range, 2000) }, durationMillis: 2000 });
          }
        }
    });
  }
  async handleMapQuery(params: MapParams) {
    if (params.businesses) this._displayYelpBusinesses(params.businesses);
    else if (params.highlightIndex !== undefined) this._highlightBusiness(params.highlightIndex);
    else if (params.location) this._handleViewLocation(params.location);
    else if (params.origin && params.destination) this._handleDirections(params.origin, params.destination);
  }
  setInputField(message: string) { this.inputMessage = message.trim(); }
  addMessage(role: string, message: string) {
    const div = document.createElement('div'); div.classList.add('turn', `role-${role.trim()}`);
    const td = document.createElement('details'); td.classList.add('thinking');
    const s = document.createElement('summary'); s.textContent = 'Thinking process'; td.append(s);
    const te = document.createElement('div'); td.append(te); div.append(td);
    const text = document.createElement('div'); text.className = 'text'; text.innerHTML = message; div.append(text);
    this.messages = [...this.messages, div]; this.scrollToTheEnd();
    return { thinkingContainer: td, thinkingElement: te, textElement: text };
  }
  scrollToTheEnd() { if (this.anchor) this.anchor.scrollIntoView({ behavior: 'smooth', block: 'end' }); }
  async sendMessageAction(message?: string, role?: string) {
    if (this.chatState !== ChatState.IDLE) return;
    let msg = message ? message.trim() : this.inputMessage.trim();
    if (!msg) return;
    if (!message) this.inputMessage = '';
    const r = role ? role.toLowerCase() : 'user';
    if (r === 'user') { const {textElement} = this.addMessage(r, '...'); textElement.innerHTML = await parseMarkdown(msg); }
    if (this.sendMessageHandler) await this.sendMessageHandler(msg, r);
    this.setNewRandomPrompt();
  }
  private async inputKeyDownAction(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessageAction(); } }

  render() {
    return html`<div class="gdm-map-app">
      <div class="main-container">
        <div class="map-reticle"><div class="map-reticle-dot"></div></div>
        <div class="hand-controls">
            <button class="hand-control-toggle ${this.handControlEnabled ? 'active' : ''}" @click=${() => this.toggleHandControl()}>
            ${this.isHandModelLoading ? html`${ICON_BUSY}` : html`${ICON_HAND}`}
            </button>
            <button class="hand-control-toggle ${this.debugEnabled ? 'active' : ''}" @click=${() => this.toggleDebug()} ?disabled=${!this.handControlEnabled}>${ICON_DEBUG}</button>
            <div class="speed-control-container">${ICON_SPEED}<input type="range" class="speed-slider" min="1" max="7" .value=${this.speedLevel} @input=${(e: any) => this.speedLevel = parseInt(e.target.value)}/><span class="speed-label">${this.speedLevel}</span></div>
        </div>
        <div id="camera-container"><video id="webcam" autoplay playsinline></video><canvas id="outputCanvas"></canvas></div>
        <div id="hand-cursor"></div>
        <div id="gesture-label" style="display:none;"></div>
        ${this.mapError ? html`<div class="map-error-message">${this.mapError}</div>` : ''}
        ${this.hoveredBusiness ? html`
        <div class="business-card">
            <button class="business-card-close" @click=${() => this.hoveredBusiness = null}>×</button>
            <div class="business-card-header">
                <img class="business-card-image" src="${this.hoveredBusiness.image_url}" />
                <div class="business-card-content">
                    <div class="business-card-title">${this.hoveredBusiness.name}</div>
                    <div class="business-card-rating">
                        <span class="stars">${'★'.repeat(Math.round(this.hoveredBusiness.rating))}</span>
                        <span class="rating-value">${this.hoveredBusiness.rating}</span>
                    </div>
                </div>
            </div>
            <div class="business-card-footer">
               <button class="business-card-action" @click=${() => this.handleTakeMeThere(this.hoveredBusiness!)}>Take me there</button>
            </div>
        </div>` : ''}
        <gmp-map-3d id="mapContainer" mode="hybrid" center="0,0,100" heading="0" tilt="0" range="20000000" default-ui-hidden="true"></gmp-map-3d>
      </div>
      <div class="sidebar">
        <div class="selector" role="tablist">
          <button id="geminiTab" class=${classMap({'selected-tab': this.selectedChatTab === ChatTab.GEMINI})} @click=${() => {this.selectedChatTab = ChatTab.GEMINI;}}>Gemini</button>
        </div>
        <div id="chat-panel" class=${classMap({'tabcontent': true, 'showtab': this.selectedChatTab === ChatTab.GEMINI})}>
          <div class="chat-messages">${this.messages}<div id="anchor"></div></div>
          <div class="footer">
            <div id="chatStatus" class=${classMap({'hidden': this.chatState === ChatState.IDLE})}>
              ${this.chatState === ChatState.GENERATING ? html`${ICON_BUSY} Generating...` : (this.chatState === ChatState.THINKING ? html`${ICON_BUSY} Thinking...` : html`${ICON_BUSY} Executing...`)}
            </div>
            <div id="inputArea">
              <button id="micButton" class=${classMap({'listening': this.isLiveConnected})} @click=${() => this.toggleLiveMode()}>${this.isLiveConnected ? ICON_MIC_OFF : ICON_LIVE}</button>
              <input type="text" id="messageInput" .value=${this.inputMessage} @input=${(e: any) => {this.inputMessage = e.target.value;}} @keydown=${(e: any) => {this.inputKeyDownAction(e);}} placeholder=${this.isLiveConnected ? "Listening..." : "Type your message..."} />
              <button id="sendButton" @click=${() => {this.sendMessageAction();}} ?disabled=${this.chatState !== ChatState.IDLE || this.isLiveConnected}>
                <svg xmlns="http://www.w3.org/2000/svg" height="30px" viewBox="0 -960 960 960" width="30px" fill="currentColor"><path d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }
}