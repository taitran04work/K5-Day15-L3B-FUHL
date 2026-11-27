"""Nối model — chỗ DUY NHẤT trong bản chạy thử gọi model AI. NHÓM VIẾT phần gọi model thật.

Hợp đồng (giữ nguyên để khung đo được token):
    call_model(system: str, user: str) -> dict với 4 khoá
        "text":       str   chữ model trả về
        "model":      str   tên model đã gọi (để tra giá ở bảng giá model)
        "tokens_in":  int   số token vào, lấy từ trường usage trong phản hồi API — KHÔNG ước lượng
        "tokens_out": int   số token ra, gồm cả token suy luận / suy nghĩ nếu API tính riêng
    @model_call (từ tracing.py) tự ghi mỗi lần gọi vào trace; agent.py gọi call_model bao nhiêu lần
    cũng được, khung tự cộng token.
    Lỗi gọi model (hết lượt, sai key, mất mạng): cứ để exception bay ra — khung ghi lỗi vào cột error.
"""
import json
import os
import urllib.error
import urllib.request

from tracing import model_call

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOW_RAW = False


def load_env(path=os.path.join(ROOT, ".env")):
    """Đọc file .env (KEY=VALUE mỗi dòng) vào biến môi trường, không ghi đè biến đã có. Khung — không cần sửa."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _clean_env(name: str, default: str = "") -> str:
    raw = os.environ.get(name) or default
    return raw.split("#", 1)[0].strip().strip('"').strip("'")


load_env()
MODEL_PROVIDER = _clean_env("MODEL_PROVIDER", "fake").lower() or "fake"
MODEL_NAME = _clean_env("MODEL_NAME") or _clean_env("ANTHROPIC_MODEL")
API_KEY = _clean_env("API_KEY") or _clean_env("ANTHROPIC_API_KEY")


def _post_json(url: str, headers: dict, body: dict, timeout: int = 60) -> dict:
    """Gửi POST JSON, trả về dict phản hồi. Chỉ dùng thư viện chuẩn (urllib)."""
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers=dict({"Content-Type": "application/json"}, **headers),
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %d: %s" % (e.code, e.read().decode("utf-8", "replace")[:300]))
    if SHOW_RAW:
        print(json.dumps(data, ensure_ascii=False, indent=2)[:3000])
    return data


def _call_claude(system: str, user: str) -> dict:
    data = _post_json(
        "https://api.anthropic.com/v1/messages",
        {"x-api-key": API_KEY, "anthropic-version": "2023-06-01"},
        {
            "model": MODEL_NAME or "claude-haiku-5-5",
            "max_tokens": 2048,
            "system": system or "",
            "messages": [{"role": "user", "content": user}],
        },
    )
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    u = data["usage"]
    tokens_in = int(u.get("input_tokens", 0)) + int(u.get("cache_read_input_tokens", 0)) + int(u.get("cache_creation_input_tokens", 0))
    return {"text": text, "tokens_in": tokens_in, "tokens_out": int(u.get("output_tokens", 0))}


def _call_openai(system: str, user: str) -> dict:
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
    data = _post_json(
        "https://api.openai.com/v1/chat/completions",
        {"Authorization": "Bearer " + API_KEY},
        {"model": MODEL_NAME, "messages": messages},
    )
    u = data["usage"]
    return {
        "text": data["choices"][0]["message"]["content"] or "",
        "tokens_in": int(u["prompt_tokens"]),
        "tokens_out": int(u["completion_tokens"]),
    }


def _call_ollama(system: str, user: str) -> dict:
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
    data = _post_json(
        "http://localhost:11434/api/chat",
        {},
        {"model": MODEL_NAME, "messages": messages, "stream": False},
        timeout=300,
    )
    return {
        "text": data["message"]["content"],
        "tokens_in": int(data.get("prompt_eval_count", 0)),
        "tokens_out": int(data.get("eval_count", 0)),
    }


@model_call
def call_model(system: str, user: str) -> dict:
    if MODEL_PROVIDER == "fake":
        last = (user.strip().splitlines() or [""])[-1]
        return {"text": "[câu trả lời giả — chưa nối model] " + last[:60], "model": "fake", "tokens_in": 0, "tokens_out": 0}

    if MODEL_PROVIDER == "anthropic":
        r = _call_claude(system, user)
    elif MODEL_PROVIDER == "openai":
        r = _call_openai(system, user)
    elif MODEL_PROVIDER == "ollama":
        r = _call_ollama(system, user)
    else:
        raise NotImplementedError(
            "chưa hỗ trợ MODEL_PROVIDER=%s trong codebase/ai.py — xem docs/connect-model.md" % MODEL_PROVIDER
        )

    return {
        "text": r["text"],
        "model": MODEL_NAME or "claude-haiku-5-5",
        "tokens_in": int(r["tokens_in"]),
        "tokens_out": int(r["tokens_out"]),
    }
