## Inspiration
I've always found standard 2D maps a bit flat and searching for places a lonely experience. I wanted to create a travel companion that feels alive—someone who knows the local spots (thanks to Yelp) and can fly me around a city like a superhero. The inspiration came from combining the immersive visual power of Google's Photorealistic 3D Maps with the conversational intelligence of Gemini. I wanted to move beyond typing into search bars and instead just *talk* to the map and wave my hands to move it, creating a "Minority Report" style interface for exploring the world.

## What it does
Talk to Buddy Yelpy is an interactive 3D map application that acts as a local expert.
*   **Voice Interaction:** I can speak naturally to "Yelpy," asking for things like "Find cheap pizza near Times Square" or "Show me a tour of Rome."
*   **Real-time 3D Visualization:** The app flies the camera to locations cinematically and drops 3D markers for Yelp results, color-coded by rating.
*   **Hand Gestures:** Using my webcam, I can control the map without touching the mouse. A "Victory" sign pans right, a "Fist" zooms out, and an "Open Palm" zooms in.
*   **Context Awareness:** If I point the camera at a building and ask "What is this?", the AI analyzes the map coordinates and identifies the businesses or landmarks I'm looking at.
*   **Live Mode:** It supports a low-latency, real-time audio conversation mode where the AI responds instantly to my voice and executes map commands on the fly.

## How I built it
I built this using a modern web stack:
*   **Frontend Framework:** I used **Lit** and **TypeScript** for a lightweight, component-based architecture.
*   **Mapping:** The core is the **Google Maps JavaScript API** with the new **Maps 3D Library**, allowing for photorealistic 3D tiles and camera control.
*   **AI & Logic:** I integrated the **Google GenAI SDK**. I used 'gemini-2.5-flash' for text chat and the **Gemini Live API** for the real-time audio session. I implemented specific **Tools** (Function Calling) that allow the AI to execute code to move the map, search Yelp, or plot routes.
*   **Data Source:** I connected to the **Yelp Fusion API** (via a proxy) to fetch real-world business data, ratings, and reviews.
*   **Computer Vision:** For hand controls, I implemented **MediaPipe Gesture Recognizer** running entirely in the browser to detect hand landmarks and classify gestures.

## Challenges I ran into
*   **Real-time Audio State:** Managing the Gemini Live API session was tricky. I initially had issues where the voice agent would "reinitiate" or keep talking after I thought I disconnected. I had to implement strict session management to ensure connections were cleanly closed.
*   **Spatial Context:** When asking "What is this?", the AI initially just picked the single nearest mathematical point, which was often a minor sub-business rather than the main landmark. I had to refactor the logic to fetch multiple nearby results and provide the AI with a broader context so it could answer intelligently.
*   **Gesture Stability:** The hand tracking loop would occasionally crash the entire app if the camera feed glitched or lighting changed. I learned to wrap the detection logic in robust error handling to keep the animation frame loop running smoothly.
*   **CORS Issues:** Calling the Yelp API directly from the browser isn't allowed, so I had to route requests through a CORS proxy to make it work in a client-side only demo.

## Accomplishments that I'm proud of
*   **The "Live" Experience:** It feels magical when I say "Take me to Tokyo" and the map immediately starts flying there while the AI starts describing the city. The latency is incredibly low.
*   **Hand Controls:** Getting the MediaPipe integration to smoothly pan and zoom the Google Map 3D camera feels very futuristic and responsive.
*   **Tool Use:** I successfully taught the AI how to use the map. It knows when to fly, when to drop pins, and when to highlight a specific building based purely on natural language conversation.

## What I learned
*   **Multimodal Interfaces:** I learned a lot about combining audio, visual (map), and video (webcam) inputs into a single cohesive experience.
*   **Map Camera Math:** I gained a deeper understanding of 3D geographical coordinates (heading, tilt, range) to create cinematic camera movements.
*   **AI Tooling:** I learned how to define effective schemas for Function Calling so that the model reliably triggers the right actions with the right parameters.

## What's next for Talk to Buddy Yelpy
*   **Mobile Support:** Optimizing the interface and gesture recognition for mobile devices.
*   **Navigation Mode:** Integrating real turn-by-turn navigation data so it can be used as a driving assistant.
*   **Rich Media:** Showing photos and reviews from Yelp directly in the 3D space as floating cards.
*   **Multi-stop Tours:** Allowing the AI to plan a full day's itinerary and fly through the route sequentially.