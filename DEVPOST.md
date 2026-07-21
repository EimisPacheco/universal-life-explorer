# Devpost Submission — paste-ready content
(Every field below maps to a field on the Devpost form. Placeholders in ALL CAPS brackets.)

---

## Project name
Universal Explorer

## Elevator pitch (tagline)
A hands-free 3D science universe — planets, atoms, molecules, pyramids, and the human body — steered with your nose and hands while an OpenAI Realtime voice guide answers, narrates tours, and drives the app itself.

---

## About the project (the "Story" markdown box)

### Inspiration
Science apps make you click through menus while the thing you actually care about — the planet, the organ, the atom — sits behind glass. We wanted the opposite: you LOOK at something and ask "what is this?", you GRAB a planet with both hands and rip it open like an orange to see the core, and a voice that knows what you're looking at answers — and can even take the wheel and fly you there.

### What it does
Universal Explorer is a webcam-driven 3D learning environment with six worlds: the solar system, molecules (water, caffeine, DNA), the atom (5 elements), an Egyptian pyramid, a flower, and a full human-anatomy explorer with 25+ procedurally built organs.

- **Nose pointer** — your head aims a cursor (MediaPipe FaceLandmarker); hold your gaze ~2s to select. Works on planets AND on organs inside the anatomy module.
- **Hand gestures** — one hand orbits and zooms any scene; two hands grab a planet and physically pull it apart — crust and mantle split, pith-like strands stretch and snap, the glowing core is exposed.
- **OpenAI Realtime voice guide** — a WebRTC voice session (gpt-realtime-2.1, voice "marin", gpt-4o-mini-transcribe input) with a persona per world: Cosmos the astronomer, Professor Bond the chemist, Indy the archaeologist, Flora the botanist, Dr. Somatic the anatomist. Whatever your nose is on becomes the model's context, so "what is this?" just works.
- **The voice DRIVES the app (function calling)** — seven tools let the model act: switch scenes ("take me to the flower"), X-ray the pyramid to reveal the King's Chamber ("show me what's inside"), fly to objects ("zoom into Mars"), run narrated guided tours stop-by-stop, change the element in the atom view ("show me iron"), and close views.
- **Typed guide too** — a sidebar chat hits the OpenAI Responses API (gpt-5.6-luna) with the same look-target context.
- The anatomy module mirrors your body with pose tracking, lets you grab your own organs, and includes Learn Mode and a quiz.

### How I built it
- **Three.js (r160/r162), zero build step** — two single-file HTML apps. Every organ, planet, and texture is procedural: Perlin/fbm noise for brain gyri and intestines, canvas-generated limestone masonry for the pyramid, CPK-accurate molecules, a B-DNA double helix, real electron-shell configurations per element.
- **MediaPipe Tasks (vendored, fully offline)** — GestureRecognizer (two hands) + FaceLandmarker on the GPU delegate. The nose pointer runs a One Euro filter, neutral-pose calibration, dead-zoning, and dwell detection tuned for 12fps inference.
- **OpenAI everywhere** — Realtime API over WebRTC with session tools (function calling) for app control; Responses API for text answers; transcription via gpt-4o-mini-transcribe. A ~500-line Python stdlib server proxies both so the API key never reaches the browser.
- **Performance engineering** — GPU-delegate inference with CPU fallback, vision throttling, full geometry/material/texture disposal on scene switches (fixed a leak we measured at 3× VRAM growth in 12 switches), adaptive pixel-ratio, render pausing when the anatomy iframe covers the scene, idle auto-shutdown for camera and voice session.

### Challenges I ran into
- Making a nose a trustworthy cursor: raw landmarks jitter badly; it took a One Euro filter + median prefilter + dead zone + dwell logic to make selection feel intentional instead of haunted.
- Letting the voice agent act without chaos: tool calls arrive mid-conversation over a data channel; every tool needed to be safe to fire at any moment (mid-tour, mid-inspect, wrong scene) and to report back something the model can say out loud.
- The "rip a planet open" interaction went through several rounds until it behaved like tearing fruit — resistance curve, shear, snapping strands — instead of two sliding hemispheres.
- Anatomical realism with zero downloaded assets: intestines, gallbladder, lungs, and rib cage were iterated against real reference imagery until the procedural geometry read as anatomy, not spaghetti.

### Accomplishments that I am proud of
- A voice agent that doesn't just talk about the app — it OPERATES it. "Give me a tour" flies the camera stop-to-stop while the persona narrates each one.
- Nose-driven selection working inside a completely separate embedded app (the anatomy module) without modifying it — the pointer is forwarded as synthetic input.
- The two-hand planet rip: reach, hold, pull apart, and the core is glowing in your hands.
- Everything runs locally from one Python file — models vendored, no CDNs needed at runtime, API key server-side.

### What I learned
- Multimodal input (head pose + two hands + voice) needs an arbitration story as much as a recognition story — who wins when the nose hovers one thing and the voice names another.
- Realtime function calling is the difference between a narrator and a copilot; the tool-result → response.create loop makes the model feel embodied in the app.
- Measure, don't guess: our biggest perf win (the disposal leak) was invisible until we logged renderer memory across scene switches.

### What's next for Universal Explorer
- Orbital mechanics with a time slider, more molecules and elements, a flower lifecycle, and a cross-scene quiz mode with nose-dwell answers.
- Multi-language personas (the Realtime API makes this nearly free).
- A classroom mode: shareable state URLs and a teacher dashboard of what each student explored.

---

## Built with (tags)
three.js, javascript, mediapipe, openai, openai-realtime-api, webrtc, python, html5, canvas, web-audio

## "Try it out" links
- [YOUR GITHUB REPO URL — placeholder]
- [YOUR HOSTED DEMO URL — placeholder, or note: "clone + `python3 server.py` + open http://localhost:8010/explorer.html"]

## Video demo link
- [YOUR YOUTUBE/VIMEO DEMO URL — placeholder]

## Image gallery suggestions (screenshots to upload)
1. Solar system with a planet ripped open (two-hand grab, core exposed)
2. Pyramid X-rayed with the four glowing chambers visible
3. The atom view (iron — 4 shells) or DNA double helix
4. Anatomy module with an organ selected by the nose pointer + detail panel
5. The flower bloom with the webcam PiP + hand skeleton DEBUG overlay visible (shows the tech)

## Thumbnail
Use screenshot #1 (planet core) — highest wow-per-pixel.
