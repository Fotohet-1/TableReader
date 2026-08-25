export interface Unit {
  id: number;
  sceneNo?: string;
  type: "scene" | "action" | "dialogue" | "narration";
  character: string;
  text: string;
  start: number;
  end: number;
}

export interface CharacterVoice {
  name: string;
  voiceId: string;
  gender?: string;
  age?: string;
  merged?: string[];
  voiceMode?: "base" | "clone";
  voiceBase?: string;
  cloneAudioB64?: string;
  cloneRefText?: string;
}

export interface Subtitle {
  text: string;
  timeBegin: number;
  timeEnd: number;
  textBegin: number;
  textEnd: number;
}

export interface UnitAudio {
  unitId: number;
  blob: Blob;
  url: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  subtitles: Subtitle[];
}

export interface Project {
  scriptText: string;
  units: Unit[];
  voices: CharacterVoice[];
}

export interface Session {
  text: string;
  units: Unit[];
  charVoices: CharacterVoice[];
  source: "edge" | "local";
}
