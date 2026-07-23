# Devpost Submission — paste-ready content (current)
(Every field maps to a Devpost form field. Updated with the body-mirror avatar and touch-to-explain.)

---

## Project name
Universal Life Explorer

## Elevator pitch (tagline)
A hands-free 3D science universe - planets, atoms, pyramids, the human body - steered by your nose and hands, guided by an OpenAI Realtime voice that answers, narrates tours, and drives the app.

---

## About the project (the "Story" markdown box)

## Inspiration
Science apps make you click through menus while the thing you actually care about - the planet, the organ, the atom - sits behind glass. I wanted the opposite: you LOOK at something and ask "what is this?", you GRAB a planet with both hands and rip it open like an orange to see the core, you TOUCH your own chest and a mirrored avatar touches its heart while a voice explains it - and that voice can even take the wheel and fly you there.

## What it does
Universal Life Explorer is a webcam-driven 3D learning environment with six worlds: the solar system, molecules (water, caffeine, DNA), the atom (5 elements), an Egyptian pyramid, a flower, and a full human-anatomy explorer with 25+ procedurally built organs.

- **Nose pointer** - your head aims a cursor (MediaPipe FaceLandmarker); hold your gaze ~5s to select. Works on planets AND on organs inside the anatomy module - and the moment something locks in, the voice starts describing it without being asked.
- **Hand gestures** - one hand orbits and zooms any scene; two hands grab a planet and physically pull it apart - crust and mantle split, pith-like strands stretch and snap, the glowing core is exposed.
- **The avatar mirrors YOU** - turn on Motion Capture and the anatomical body copies your movements live: head, torso, arms, legs, driven by on-device pose tracking. It is you, with your organs showing.
- **Touch your body, hear about it** - this is the fun part. Rest your hand on your own chest and the mirrored avatar's hand lands exactly on ITS heart - then Dr. Somatic immediately starts explaining the heart. Slide your hand up to your head and the explanation switches to the brain; touch your liver and it explains the liver. Your own body becomes the index of the anatomy book. Close your fist and you pull that organ out of the avatar to inspect it.
- **OpenAI Realtime voice guide** - a WebRTC voice session (gpt-realtime-2.1, voice "marin", gpt-4o-mini-transcribe input) with a persona per world: Cosmos the astronomer, Professor Bond the chemist, Indy the archaeologist, Flora the botanist, Dr. Somatic the anatomist. Whatever your nose or hand is on becomes the model's context, so "what is this?" just works - and inside the anatomy there is ONE voice: every lesson, quiz answer, and organ narration is spoken by the same agent.
- **The voice DRIVES the app (function calling)** - seven tools let the model act: switch scenes ("take me to the flower"), X-ray the pyramid to reveal the King's Chamber ("show me what is inside"), fly to objects ("zoom into Mars"), run narrated guided tours stop-by-stop, change the element in the atom view ("show me iron"), and close views.
- **Typed guide too** - a sidebar chat hits the OpenAI Responses API (GPT-5.6) with the same look-target context.

## How I built it
- **Three.js, zero build step** - two single-file HTML apps. Every organ, planet, and texture is procedural: Perlin/fbm noise for brain gyri and intestines, canvas-generated limestone masonry for the pyramid, CPK-accurate molecules, a B-DNA double helix, real electron-shell configurations per element.
- **MediaPipe Tasks (vendored, fully offline)** - GestureRecognizer (two hands) + FaceLandmarker + PoseLandmarker on the GPU delegate. The nose pointer runs a One Euro filter, neutral-pose calibration, dead-zoning, and dwell detection tuned for 12fps inference. The avatar's arms are POSITION-retargeted into a torso-normalized frame and solved with two-bone IK, so "hand on chest" lands on the chest whatever your proportions - and a touch snap eases the wrist onto the exact organ.
- **OpenAI everywhere** - Realtime API over WebRTC with session tools (function calling) for app control; Responses API (GPT-5.6) for text answers; transcription via gpt-4o-mini-transcribe. A ~500-line Python stdlib server proxies both so the API key never reaches the browser.
- **Performance engineering** - GPU-delegate inference with CPU fallback, vision throttling, full geometry/material/texture disposal on scene switches (fixed a leak I measured at 3x VRAM growth in 12 switches), adaptive pixel-ratio, render pausing when the anatomy iframe covers the scene, idle auto-shutdown for camera and voice - and choreographed camera handoff: the explorer fully releases the webcam BEFORE the anatomy's motion capture opens it, because a contended device can freeze a stream with no error at all.

## Challenges I ran into
- Making a nose a trustworthy cursor: raw landmarks jitter badly; it took a One Euro filter + median prefilter + dead zone + dwell logic to make selection feel intentional instead of haunted.
- Making the avatar's hand actually LAND: raw pose retargeting always stopped a few centimeters short of the head or heart, so "touch your organ" needed a body-relative touch detector (your shoulders and hips define the coordinate frame) plus an IK snap that eases the avatar's wrist onto the real organ anchor.
- One camera, two vision stacks: the explorer's nose tracking and the anatomy's pose tracking both wanted the webcam - opened together, the second stream could silently freeze while still reporting "Tracking". The fix was strict ownership: the mirror always wins, the explorer hands the camera over before the anatomy opens it, and takes it back when Motion Capture stops.
- One voice, two agents: the anatomy had its own browser-TTS narrator from before the integration; embedded, both agents could talk over each other. All narration now routes through the single Realtime agent.
- Letting the voice agent act without chaos: tool calls arrive mid-conversation over a data channel; every tool needed to be safe to fire at any moment and to report back something the model can say out loud.
- The "rip a planet open" interaction went through several rounds until it behaved like tearing fruit - resistance curve, shear, snapping strands - instead of two sliding hemispheres.
- Anatomical realism with zero downloaded assets: intestines, gallbladder, lungs, and rib cage were iterated against real reference imagery until the procedural geometry read as anatomy, not spaghetti.

## Accomplishments that I'm proud of
- Touching my own heart and watching the avatar touch its heart while the voice explains it - body as controller AND as index. No screen, no menu, no click.
- A voice agent that does not just talk about the app - it OPERATES it. "Give me a tour" flies the camera stop-to-stop while the persona narrates each one.
- Nose-driven selection working inside a completely separate embedded app (the anatomy module) - the pointer is forwarded as synthetic input.
- The two-hand planet rip: reach, hold, pull apart, and the core is glowing in your hands.
- Everything runs locally from one Python file - models vendored, no CDNs needed at runtime, API key server-side.

## What I learned
- Multimodal input (head pose + two hands + full-body pose + voice) needs an arbitration story as much as a recognition story - who owns the camera, who owns the microphone, and who speaks.
- Realtime function calling is the difference between a narrator and a copilot; the tool-result loop makes the model feel embodied in the app.
- Measure, do not guess: my biggest perf win (the disposal leak) was invisible until I logged renderer memory across scene switches - and my hardest bug produced no error at all, just a frozen camera stream that still said "Tracking".

## What's next for Universal Life Explorer
- Orbital mechanics with a time slider, more molecules and elements, a flower lifecycle, and a cross-scene quiz mode with nose-dwell answers.
- Multi-language personas (the Realtime API makes this nearly free).
- A classroom mode: shareable state URLs and a teacher dashboard of what each student explored.

---

## Built with (tags)
three.js, javascript, mediapipe, openai, webrtc, python, html5, canvas, web-audio

## "Try it out" links
- https://github.com/EimisPacheco/universal-life-explorer
- Run locally: clone, put OPENAI_API_KEY in .env, `python3 server.py`, open http://localhost:8010/

## Video demo link
- [YOUR YOUTUBE DEMO URL — placeholder]

## Image gallery
Already uploaded (12): architecture diagram, planet rip, pyramid X-ray + chambers, anatomy (organ select + full body), iron atom, DNA, water, caffeine, flower, solar overview. Thumbnail: planet rip.
