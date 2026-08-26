#!/usr/bin/env python3
"""本地 TTS 合成速度对比：Qwen3-TTS 0.6B/1.7B (MLX) vs CosyVoice HTTP。
用法：QWEN_06=... QWEN_17=... REF_AUDIO=... REF_TEXT=... venv/bin/python scripts/bench-tts.py
"""
import json
import os
import statistics
import time
import urllib.request

TEXT = "夜色渐深，街角的咖啡店还亮着灯。"
LANG = "zh"
REF_AUDIO = os.environ.get("REF_AUDIO", "")
REF_TEXT = os.environ.get("REF_TEXT", "今天天气不错，适合出去走走。")
OUT_DIR = "/tmp/qwen3-tts-bench"
os.makedirs(OUT_DIR, exist_ok=True)


def qwen_bench(name, model_dir, rounds=3):
    from mlx_audio.tts.generate import generate_audio

    kwargs = dict(
        model=model_dir,
        text=TEXT,
        lang_code=LANG,
        ref_audio=REF_AUDIO or None,
        ref_text=REF_TEXT,
        output_path=OUT_DIR,
        save=True,
        verbose=False,
    )
    print(f"[{name}] 加载模型并合成一次（不计入成绩）…", flush=True)
    t0 = time.time()
    generate_audio(**kwargs)
    print(f"  加载+首次: {time.time() - t0:.1f}s", flush=True)
    times = []
    for i in range(rounds):
        t0 = time.time()
        generate_audio(**kwargs)
        dt = time.time() - t0
        times.append(dt)
        print(f"  第{i + 1}次: {dt:.2f}s", flush=True)
    med = statistics.median(times)
    print(f"{name} 中位: {med:.2f}s", flush=True)
    return med


def cosy_bench(url, rounds=3):
    body = json.dumps({"text": TEXT, "voice_id": "旁白"}).encode()
    times = []
    for i in range(rounds):
        t0 = time.time()
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=180) as r:
            r.read()
        dt = time.time() - t0
        times.append(dt)
        print(f"  cosy 第{i + 1}次: {dt:.2f}s", flush=True)
    med = statistics.median(times)
    print(f"cosy 中位: {med:.2f}s", flush=True)
    return med


if __name__ == "__main__":
    results = {}
    if os.environ.get("QWEN_06"):
        results["Qwen3-TTS 0.6B (4bit)"] = qwen_bench("qwen06", os.environ["QWEN_06"])
    if os.environ.get("QWEN_17"):
        results["Qwen3-TTS 1.7B (4bit)"] = qwen_bench("qwen17", os.environ["QWEN_17"])
    results["CosyVoice2 0.5B"] = cosy_bench(os.environ.get("COSY_URL", "http://127.0.0.1:9880/tts"))

    print("\n=== 结果（15 字中文句，3 次中位）===")
    for name, sec in results.items():
        print(f"{name}: {sec:.2f}s")
