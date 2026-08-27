export interface Unit {
  id: number;
  sceneNo?: string;
  episode?: number;
  type: "scene" | "action" | "dialogue" | "narration";
  character: string;
  text: string;
  raw?: string;
  start: number;
  end: number;
  group?: number;
  simul?: boolean;
}

export interface CharacterVoice {
  name: string;
  voiceId: string;
  gender?: string;
  age?: string;
  lines?: number;
  merged?: string[];
  voiceMode?: "base" | "clone";
  cloneAudioB64?: string;
  cloneRefText?: string;
  voiceDesc?: string;
}

export interface UnitAudio {
  unitId: number;
  url: string;
  durationMs: number;
  startMs: number;
  endMs: number;
}

export interface Project {
  scriptText: string;
  units: Unit[];
  voices: CharacterVoice[];
  archive?: { dir: string; id: string; name: string };
}

export interface Session {
  text: string;
  units: Unit[];
  charVoices: CharacterVoice[];
  source: "edge" | "qwen";
}
