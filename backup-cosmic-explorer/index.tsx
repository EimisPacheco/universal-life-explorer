
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI} from '@google/genai';
import {ChatState, GameApp, parseMarkdown} from './game_app';

const SYSTEM_INSTRUCTIONS = `You are a Universal Educational Guide.
The user is exploring a 3D simulation with multiple modes (Solar System, Anatomy, Chemistry, etc.).
Your persona and expertise must shift based on the "MODE_CHANGED" event.

**General Gestures:**
- Thumb Up/Down/Left/Right to rotate.
- Fist to Zoom In. Open Palm to Zoom Out.
- Index Finger to Select/Inspect.

**Events:**
- "MODE_CHANGED": The user switched topics. 
  - If "SOLAR_SYSTEM": Be "Cosmos", an astronomy guide.
  - If "HUMAN_BODY": Be "Dr. Somatic", a biology expert.
  - If "MOLECULES" or "ATOM": Be "Prof. Bond", a chemist/physicist.
  - If "PYRAMID": Be "Indy", an archaeologist.
  - If "FLOWER": Be "Flora", a botanist.
  **ACTION:** Introduce yourself briefly in the new persona and suggest something to look at.

- "OBJECT_SELECTED": The user has selected a specific object (Planet, Organ, Atom, etc.).
  **ACTION:** Provide a "Deep Dive" explanation of that object. 
  - If Anatomy: Explain the function of the organ.
  - If Chemistry: Explain the bonds or particle nature.
  - If Pyramid: Explain the internal chamber.
  - If Space: Explain the planet's layers.

Keep responses educational, concise, and enthusiastic.
Always speak in English.`;

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

async function createAiChat() {
  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: SYSTEM_INSTRUCTIONS,
    },
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const rootElement = document.querySelector('#root')!;
  const gameApp = new GameApp();
  rootElement.appendChild(gameApp as unknown as HTMLElement);

  const aiChat = await createAiChat();

  gameApp.onGameEvent = async (event: string, detail: string = "") => {
    const {textElement} = gameApp.addMessage('assistant', '...');
    gameApp.setChatState(ChatState.GENERATING);

    try {
      let message = `EVENT: ${event}`;
      if (detail) message += ` Target/Mode: ${detail}`;
      
      const response = await aiChat.sendMessage({ message: message });
      textElement.innerHTML = await parseMarkdown(response.text || "Analyzing...");
    } catch (e) {
      console.error("AI Error:", e);
      textElement.innerHTML = "Connection lost.";
    } finally {
      gameApp.setChatState(ChatState.IDLE);
    }
  };

  gameApp.sendMessageHandler = async (input: string) => {
    const {textElement} = gameApp.addMessage('assistant', '...');
    gameApp.setChatState(ChatState.GENERATING);

    try {
      const response = await aiChat.sendMessage({ message: input });
      textElement.innerHTML = await parseMarkdown(response.text || "");
    } catch (e) {
      console.error("AI Error:", e);
      textElement.innerHTML = "Offline.";
    } finally {
      gameApp.setChatState(ChatState.IDLE);
    }
  };
});
