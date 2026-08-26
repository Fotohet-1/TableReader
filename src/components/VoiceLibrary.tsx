import { useEffect, useRef, useState } from "react";
import {
  PITCHES,
  baseVoiceIdOf,
  loadVoiceTags,
  saveVoiceTags,
  type VoiceTag
} from "../lib/voiceTags";
import { edgeSynthOne, type BaseVoiceInfo } from "../lib/tts";

const PREVIEW_TEXT = "夜色渐深，街角的咖啡店还亮着灯。";
const AGES = ["少年", "青年", "中年", "老年"];

export default function VoiceLibrary({
  edgeUrl,
  voices,
  onTagsChange,
  onClose
}: {
  edgeUrl: string;
  voices: Record<string, BaseVoiceInfo>;
  onTagsChange: (tags: Record<string, VoiceTag>) => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<Record<string, VoiceTag>>(() => loadVoiceTags());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchGender, setBatchGender] = useState("");
  const [batchAge, setBatchAge] = useState("");
  const [batchDialect, setBatchDialect] = useState("");
  const [filter, setFilter] = useState({ gender: "", age: "", dialect: "" });
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT);
  const [playingKey, setPlayingKey] = useState("");
  const [previewErr, setPreviewErr] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const baseIds = Array.from(
    new Set(Object.keys(voices).map((k) => baseVoiceIdOf(k)))
  ).sort((a, b) => (a < b ? -1 : 1));

  const updateTag = (id: string, patch: Partial<VoiceTag>) => {
    setTags((prev) => {
      const next = {
        ...prev,
        [id]: { ...(prev[id] || { gender: "", age: "", name: "", dialect: "" }), ...patch }
      };
      saveVoiceTags(next);
      onTagsChange(next);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyBatch = () => {
    setTags((prev) => {
      const next = { ...prev };
      for (const id of selected) {
        const cur = next[id] || { gender: "", age: "", name: "", dialect: "" };
        next[id] = {
          ...cur,
          gender: batchGender || cur.gender,
          age: batchAge || cur.age,
          dialect: batchDialect
        };
      }
      saveVoiceTags(next);
      onTagsChange(next);
      return next;
    });
    setSelected(new Set());
    setBatchGender("");
    setBatchAge("");
    setBatchDialect("");
  };

  const preview = async (baseId: string, suffix: string) => {
    const key = baseId + suffix;
    if (playingKey === key) {
      audioRef.current?.pause();
      setPlayingKey("");
      return;
    }
    setPreviewErr("");
    try {
      const r = await edgeSynthOne(edgeUrl, previewText, key);
      const audio = audioRef.current;
      if (!audio) return;
      audio.src = URL.createObjectURL(r.blob);
      setPlayingKey(key);
      audio.play().catch(() => {});
    } catch (e) {
      setPreviewErr("试听失败: " + String(e));
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => setPlayingKey("");
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, []);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(tags, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "edge-voice-tags.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (f: File) => {
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const next = { ...loadVoiceTags(), ...parsed };
      setTags(next);
      saveVoiceTags(next);
      onTagsChange(next);
      setImportMsg("已导入 " + Object.keys(parsed).length + " 个音色标签");
    } catch {
      setImportMsg("导入失败：文件不是有效的音色标签 JSON");
    }
  };

  const filteredBaseIds = baseIds.filter((id) => {
    const tag = tags[id];
    if (!tag) return true;
    if (filter.gender && tag.gender !== filter.gender) return false;
    if (filter.age && tag.age !== filter.age) return false;
    if (filter.dialect === "none" && tag.dialect) return false;
    if (filter.dialect === "has" && !tag.dialect) return false;
    return true;
  });

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="lib-top">
          <span className="lib-title">音色库</span>
          <button className="lib-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>

        <div className="lib-toolbar">
          <div className="lib-preview-row">
            <input value={previewText} onChange={(e) => setPreviewText(e.target.value)} />
            <span className="lib-hint">试听用这句</span>
          </div>
          <div className="lib-batch">
            <span>批量</span>
            <select value={batchGender} onChange={(e) => setBatchGender(e.target.value)}>
              <option value="">性别不变</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
            <select value={batchAge} onChange={(e) => setBatchAge(e.target.value)}>
              <option value="">年龄不变</option>
              {AGES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input value={batchDialect} onChange={(e) => setBatchDialect(e.target.value)} placeholder="方言（留空清除）" />
            <button onClick={applyBatch} disabled={!selected.size}>应用到选中 {selected.size ? "(" + selected.size + ")" : ""}</button>
          </div>
          <div className="lib-actions">
            <button onClick={() => setSelected(new Set())}>取消选择</button>
            <button onClick={exportJson}>导出 JSON</button>
            <button onClick={() => importRef.current?.click()}>导入 JSON</button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }}
            />
          </div>
          <div className="lib-filters">
            <select value={filter.gender} onChange={(e) => setFilter((f) => ({ ...f, gender: e.target.value }))}>
              <option value="">全部性别</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
            <select value={filter.age} onChange={(e) => setFilter((f) => ({ ...f, age: e.target.value }))}>
              <option value="">全部年龄</option>
              {AGES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={filter.dialect} onChange={(e) => setFilter((f) => ({ ...f, dialect: e.target.value }))}>
              <option value="">全部方言</option>
              <option value="none">无方言</option>
              <option value="has">有方言</option>
            </select>
          </div>
          {(previewErr || importMsg) && <div className={"lib-msg" + (previewErr ? " err" : "")}>{previewErr || importMsg}</div>}
        </div>

        <div className="lib-grid">
          {filteredBaseIds.map((id) => {
            const tag = tags[id] || { gender: "", age: "", name: id, dialect: "" };
            const isSel = selected.has(id);
            return (
              <div key={id} className={"lib-card" + (isSel ? " selected" : "")}>
                <div className="lib-card-head">
                  <label className="lib-check">
                    <input type="checkbox" checked={isSel} onChange={() => toggleSelect(id)} />
                    {tag.name || id}
                  </label>
                  <span className="lib-id">{id.replace("Neural", "").replace("zh-CN-", "").replace("zh-HK-", "").replace("zh-TW-", "")}</span>
                </div>
                <div className="lib-fields">
                  <select value={tag.gender} onChange={(e) => updateTag(id, { gender: e.target.value })}>
                    <option value="">性别</option>
                    <option value="男">男</option>
                    <option value="女">女</option>
                  </select>
                  <select value={tag.age} onChange={(e) => updateTag(id, { age: e.target.value })}>
                    <option value="">年龄</option>
                    {AGES.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <input
                  className="lib-name-input"
                  value={tag.name}
                  onChange={(e) => updateTag(id, { name: e.target.value })}
                  placeholder="音色名"
                />
                <input
                  className="lib-dialect-input"
                  value={tag.dialect}
                  onChange={(e) => updateTag(id, { dialect: e.target.value })}
                  placeholder="方言（无则不填）"
                />
                <div className="lib-pitches">
                  {PITCHES.map((p) => {
                    const key = id + p.suffix;
                    return (
                      <button
                        key={key}
                        className={"lib-pitch" + (playingKey === key ? " on" : "")}
                        onClick={() => preview(id, p.suffix)}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <audio ref={audioRef} />
      </div>
    </div>
  );
}
