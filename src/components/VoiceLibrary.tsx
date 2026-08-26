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
const LS_LOCKED = "sr_voice_lib_locked";

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
  const [batchSpecial, setBatchSpecial] = useState("");
  const [batchEnabled, setBatchEnabled] = useState("");
  const [filter, setFilter] = useState({ gender: "", age: "", dialect: "", special: "" });
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT);
  const [playingKey, setPlayingKey] = useState("");
  const [previewErr, setPreviewErr] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [locked, setLocked] = useState(() => localStorage.getItem(LS_LOCKED) === "1");
  const [savedFlash, setSavedFlash] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const baseIds = Array.from(
    new Set(Object.keys(voices).map((k) => baseVoiceIdOf(k)))
  ).sort((a, b) => (a < b ? -1 : 1));

  const updateTag = (id: string, patch: Partial<VoiceTag>) => {
    setTags((prev) => {
      const next = {
        ...prev,
        [id]: { ...(prev[id] || { gender: "", age: "", name: "", dialect: "", special: false, enabled: true }), ...patch }
      };
      saveVoiceTags(next);
      onTagsChange(next);
      return next;
    });
  };

  const updateAllName = (baseId: string, name: string) => {
    setTags((prev) => {
      const next = { ...prev };
      for (const p of PITCHES) {
        const k = baseId + p.suffix;
        next[k] = { ...(next[k] || { gender: "", age: "", name: "", dialect: "", special: false, enabled: true }), name };
      }
      saveVoiceTags(next);
      onTagsChange(next);
      return next;
    });
  };

  const copyBaseToVariants = (baseId: string) => {
    setTags((prev) => {
      const base = prev[baseId] || { gender: "", age: "", name: "", dialect: "", special: false, enabled: true };
      const next = { ...prev };
      for (const p of PITCHES) {
        const k = baseId + p.suffix;
        next[k] = { ...(next[k] || { gender: "", age: "", name: "", dialect: "", special: false, enabled: true }), ...base };
      }
      saveVoiceTags(next);
      onTagsChange(next);
      return next;
    });
  };

  const enableOnlyOriginal = (baseId: string) => {
    setTags((prev) => {
      const next = { ...prev };
      for (const p of PITCHES) {
        const k = baseId + p.suffix;
        next[k] = { ...(next[k] || { gender: "", age: "", name: "", dialect: "", special: false, enabled: true }), enabled: p.suffix === "" };
      }
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
        for (const p of PITCHES) {
          const k = id + p.suffix;
          const cur = next[k] || { gender: "", age: "", name: "", dialect: "", special: false, enabled: true };
          next[k] = {
            ...cur,
            gender: batchGender || cur.gender,
            age: batchAge || cur.age,
            dialect: batchDialect,
            special: batchSpecial === "special" ? true : batchSpecial === "normal" ? false : cur.special,
            enabled: batchEnabled === "on" ? true : batchEnabled === "off" ? false : cur.enabled
          };
        }
      }
      saveVoiceTags(next);
      onTagsChange(next);
      return next;
    });
    setSelected(new Set());
    setBatchGender("");
    setBatchAge("");
    setBatchDialect("");
    setBatchSpecial("");
    setBatchEnabled("");
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

  const saveNow = () => {
    saveVoiceTags(tags);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  const toggleLock = () => {
    setLocked((v) => {
      const next = !v;
      localStorage.setItem(LS_LOCKED, next ? "1" : "0");
      return next;
    });
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
    return PITCHES.some((p) => {
      const tag = tags[id + p.suffix];
      if (!tag) return true;
      if (filter.gender && tag.gender !== filter.gender) return false;
      if (filter.age && tag.age !== filter.age) return false;
      if (filter.dialect === "none" && tag.dialect) return false;
      if (filter.dialect === "has" && !tag.dialect) return false;
      if (filter.special === "special" && !tag.special) return false;
      if (filter.special === "normal" && tag.special) return false;
      return true;
    });
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
            <select disabled={locked} value={batchGender} onChange={(e) => setBatchGender(e.target.value)}>
              <option value="">性别不变</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
            <select disabled={locked} value={batchAge} onChange={(e) => setBatchAge(e.target.value)}>
              <option value="">年龄不变</option>
              {AGES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input disabled={locked} value={batchDialect} onChange={(e) => setBatchDialect(e.target.value)} placeholder="方言（留空清除）" />
            <select disabled={locked} value={batchSpecial} onChange={(e) => setBatchSpecial(e.target.value)}>
              <option value="">特殊不变</option>
              <option value="normal">通用</option>
              <option value="special">特殊</option>
            </select>
            <select disabled={locked} value={batchEnabled} onChange={(e) => setBatchEnabled(e.target.value)}>
              <option value="">启用不变</option>
              <option value="on">启用</option>
              <option value="off">停用</option>
            </select>
            <button onClick={applyBatch} disabled={locked || !selected.size}>应用到选中 {selected.size ? "(" + selected.size + ")" : ""}</button>
          </div>
          <div className="lib-actions">
            <button disabled={locked} onClick={() => setSelected(new Set())}>取消选择</button>
            <button className="primary" onClick={saveNow}>{savedFlash ? "已保存" : "保存"}</button>
            <button onClick={toggleLock}>{locked ? "解锁" : "锁定"}</button>
            <button onClick={exportJson}>导出 JSON</button>
            <button disabled={locked} onClick={() => importRef.current?.click()}>导入 JSON</button>
            <input
              ref={importRef}
              type="file"
              disabled={locked}
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
            <select value={filter.special} onChange={(e) => setFilter((f) => ({ ...f, special: e.target.value }))}>
              <option value="">通用+特殊</option>
              <option value="normal">仅通用</option>
              <option value="special">仅特殊</option>
            </select>
          </div>
          {(previewErr || importMsg) && <div className={"lib-msg" + (previewErr ? " err" : "")}>{previewErr || importMsg}</div>}
        </div>

        <div className="lib-grid">
          {filteredBaseIds.map((id) => {
            const baseTag = tags[id] || { gender: "", age: "", name: id, dialect: "" };
            const isSel = selected.has(id);
            return (
              <div key={id} className={"lib-card" + (isSel ? " selected" : "")}>
                <div className="lib-card-head">
                  <label className="lib-check">
                    <input type="checkbox" disabled={locked} checked={isSel} onChange={() => toggleSelect(id)} />
                  </label>
                  <input
                    className="lib-name-input lib-name-inline"
                    disabled={locked}
                    value={baseTag.name}
                    onChange={(e) => updateAllName(id, e.target.value)}
                    placeholder="音色名"
                  />
                  <button className="lib-copy" disabled={locked} onClick={() => copyBaseToVariants(id)}>复制原声到整组</button>
                  <button className="lib-copy" disabled={locked} onClick={() => enableOnlyOriginal(id)}>只开原声</button>
                </div>
                {PITCHES.map((p) => {
                  const key = id + p.suffix;
                  const tag = tags[key] || { gender: "", age: "", name: baseTag.name, dialect: "", special: false, enabled: true };
                  return (
                    <div className="lib-pitch-row" key={key}>
                      <div className="lib-row">
                        <button
                          className={"lib-pitch" + (playingKey === key ? " on" : "")}
                          onClick={() => preview(id, p.suffix)}
                        >
                          {p.label}
                        </button>
                        <select disabled={locked} value={tag.gender} onChange={(e) => updateTag(key, { gender: e.target.value })}>
                          <option value="">性别</option>
                          <option value="男">男</option>
                          <option value="女">女</option>
                        </select>
                        <select disabled={locked} value={tag.age} onChange={(e) => updateTag(key, { age: e.target.value })}>
                          <option value="">年龄</option>
                          {AGES.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                      <div className="lib-row-sub">
                        <input
                          disabled={locked}
                          value={tag.dialect}
                          onChange={(e) => updateTag(key, { dialect: e.target.value })}
                          placeholder="方言"
                        />
                        <label className="lib-special" title="特殊音色">
                          <input
                            type="checkbox"
                            disabled={locked}
                            checked={!!tag.special}
                            onChange={(e) => updateTag(key, { special: e.target.checked })}
                          />
                          特殊
                        </label>
                        <label className={"lib-enabled" + (tag.enabled ? " on" : "")} title="进入分配池">
                          <input
                            type="checkbox"
                            disabled={locked}
                            checked={!!tag.enabled}
                            onChange={(e) => updateTag(key, { enabled: e.target.checked })}
                          />
                          启用
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <audio ref={audioRef} />
      </div>
    </div>
  );
}
