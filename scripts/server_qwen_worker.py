#!/usr/bin/env python3
"""Qwen3-TTS 模型 worker 子进程：从 stdin 读 JSON 行，生成后向 stdout 写 JSON 行。

与主服务通过行协议通信，模型生成在独立进程里执行；主服务超时后会直接杀掉本进程，
避免 mlx_audio 偶发挂起时留下无法回收的线程/模型实例。

每行请求：{"id": "...", "text": "...", "instruct": "..."}（design）
          {"id": "...", "text": "...", "ref_path": "...", "ref_text": "..."}（clone）
每行响应：{"id": "...", "audio_b64": "...", "error": null}
"""
import argparse
import base64
import io
import json
import os
import sys


def _load_model(model_dir: str):
    from mlx_audio.tts.utils import load_model
    from pathlib import Path

    print("加载模型:", os.path.basename(model_dir), file=sys.stderr, flush=True)
    model = load_model(model_dir)
    if getattr(model, "tokenizer", None) is None:
        model.post_load_hook(model, Path(model_dir))
    return model


def _normalize_loudness(audio):
    import numpy as np

    a = np.asarray(audio, dtype=np.float64)
    rms = float(np.sqrt(np.mean(a * a))) + 1e-8
    target = 0.1
    gain = target / rms
    peak = float(np.max(np.abs(a))) * gain
    if peak > 0.95:
        gain = 0.95 / peak
    return (a * gain).astype(np.float32)


def _generate(model, text: str, *, instruct=None, ref_path=None, ref_text=None) -> bytes:
    import numpy as np
    import soundfile as sf

    gen = model.generate(
        text=text,
        lang_code="zh",
        instruct=instruct,
        ref_audio=ref_path,
        ref_text=ref_text,
        verbose=False,
    )
    chunks = []
    sample_rate = 24000
    for r in gen:
        chunks.append(np.asarray(r.audio, dtype=np.float32))
        sample_rate = r.sample_rate
    if not chunks:
        raise RuntimeError("合成失败：模型未返回音频")
    audio = _normalize_loudness(np.concatenate(chunks))
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("design", "clone"), required=True)
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()

    real_stdout = sys.stdout
    # 把 mlx_audio / transformers 等库的 print 日志重定向到 stderr，
    # 保证 stdout 只承载 JSON 协议行。
    sys.stdout = sys.stderr
    model = _load_model(args.model_dir)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        rid = req.get("id")
        try:
            if args.kind == "design":
                data = _generate(model, req.get("text", ""), instruct=req.get("instruct"))
            else:
                data = _generate(
                    model,
                    req.get("text", ""),
                    ref_path=req.get("ref_path"),
                    ref_text=req.get("ref_text"),
                )
            resp = {"id": rid, "audio_b64": base64.b64encode(data).decode(), "error": None}
        except Exception as e:
            resp = {"id": rid, "audio_b64": None, "error": str(e)}
        real_stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        real_stdout.flush()


if __name__ == "__main__":
    main()
