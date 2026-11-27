"""Công cụ cho lát cắt AI Concierge homestay trên Web — phản ánh bộ công cụ của Stayra ConciergeTools.

Mỗi công cụ là một hàm Python có @tool, docstring ghi đủ 4 ý:
    tên · input · output · có tác động ra ngoài không.
Công cụ có tác động ra ngoài (đặt phòng, hủy phòng, chuyển nhân viên) KHÔNG tự chốt giao dịch thật,
chỉ trả về bản nháp chờ khách xác nhận hoặc chủ hộ duyệt.
"""
import datetime
import json
import os
import re
import unicodedata

from tracing import tool, TOOLS  # noqa: F401

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(ROOT, "data", "homestay_data.json")
TODAY = datetime.date(2026, 11, 27)


def _load_data() -> dict:
    with open(DATA_PATH, encoding="utf-8") as f:
        return json.load(f)


def _norm(text: str) -> str:
    s = unicodedata.normalize("NFD", (text or "").lower().replace("đ", "d"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9\s]", " ", s)


def _round_thousand(amount: float) -> int:
    return int(round(amount / 1000.0) * 1000)


def _find_room(data: dict, room_query: str) -> dict | None:
    q = _norm(room_query).strip()
    q_clean = re.sub(r"^(?:phong|room|can)\s+", "", q).strip()
    for candidate in (q, q_clean):
        if not candidate:
            continue
        for r in data["rooms"]:
            if _norm(r["code"]).strip() == candidate or _norm(r["name"]).strip() == candidate:
                return r
    for candidate in (q, q_clean):
        if not candidate:
            continue
        for r in data["rooms"]:
            rn = _norm(r["name"]).strip()
            rc = _norm(r["code"]).strip()
            if candidate in rn or candidate in rc or rn in candidate or rc in candidate:
                return r
    return None


def _dates_overlap(s1: datetime.date, e1: datetime.date, s2: datetime.date, e2: datetime.date) -> bool:
    return s1 < e2 and s2 < e1


def _quote_nightly(data: dict, room: dict, start_str: str, end_str: str, guests: int) -> dict:
    start = datetime.date.fromisoformat(start_str)
    end = datetime.date.fromisoformat(end_str)
    if end <= start:
        return {"error": "Ngày trả phòng phải sau ngày nhận phòng ít nhất 1 đêm."}
    if guests < 1:
        return {"error": "Số khách phải ít nhất 1 người."}
    if guests > room["max_guests"]:
        return {"error": f"Phòng {room['name']} chứa tối đa {room['max_guests']} khách."}

    rules = data["price_rules"]
    tet_s = datetime.date.fromisoformat(rules["tet_2027_range"][0])
    tet_e = datetime.date.fromisoformat(rules["tet_2027_range"][1])
    lines = []
    subtotal = 0
    cur = start
    while cur < end:
        weekday = cur.strftime("%A")
        if tet_s <= cur <= tet_e:
            price = _round_thousand(room["base_nightly_price"] * rules["tet_2027_multiplier"])
            rule_name = "Tết 2027"
        elif weekday in rules["weekend_days"]:
            price = _round_thousand(room["base_nightly_price"] * (1 + rules["weekend_percent"] / 100.0))
            rule_name = "Cuối tuần (+20%)"
        else:
            price = int(room["base_nightly_price"])
            rule_name = "Giá tiêu chuẩn"
        subtotal += price
        lines.append({"date": cur.isoformat(), "price": price, "rule": rule_name})
        cur += datetime.timedelta(days=1)

    nights = (end - start).days
    extra_guests = max(0, guests - room["base_guests"])
    extra_fee = extra_guests * int(room["extra_guest_fee"]) * nights
    total = subtotal + extra_fee
    deposit = _round_thousand(total * data["property"]["deposit_percent"] / 100.0)
    return {
        "room_code": room["code"],
        "room_name": room["name"],
        "mode": "nightly",
        "start": start_str,
        "end": end_str,
        "nights": nights,
        "guests": guests,
        "extra_guest_fee": extra_fee,
        "total": total,
        "deposit": deposit,
        "deposit_percent": data["property"]["deposit_percent"],
        "lines": lines,
    }


@tool
def search_policy(query: str) -> dict:
    """Tên: search_policy — Tra cứu nội quy, chính sách hủy, giờ nhận/trả phòng, tiện nghi và FAQ của Pine Hill Homestay.
    Input: query (str) câu hỏi hoặc từ khóa của khách.
    Output: dict gồm faqs và sections kèm mã nguồn (CS-01..CS-07, FAQ-01..FAQ-04).
    Tác động ra ngoài: Không (chỉ đọc dữ liệu nội quy)."""
    data = _load_data()
    stop = {"co", "khong", "cho", "minh", "ban", "hoi", "ve", "la", "va", "cua", "nhung", "cac", "nay", "the", "nao", "duoc", "homestay", "tai", "voi"}
    tokens = [t for t in _norm(query).split() if len(t) >= 2 and t not in stop]
    synonym_map = {
        "sang": ["breakfast", "bua", "an"],
        "bua": ["breakfast", "sang"],
        "cho": ["pet", "thu", "cung", "meo"],
        "meo": ["pet", "thu", "cung"],
        "pet": ["thu", "cung", "cho", "meo"],
        "pets": ["thu", "cung", "cho", "meo"],
        "xe": ["parking", "oto", "may", "dau", "do"],
        "oto": ["xe", "do", "parking"],
        "parking": ["xe", "do", "oto", "may"],
        "huy": ["cancel", "hoan", "coc"],
        "cancel": ["huy", "hoan", "coc"],
        "hoan": ["refund", "coc", "huy"],
        "refund": ["hoan", "coc", "huy"],
        "thuoc": ["smoking", "hut"],
        "smoking": ["hut", "thuoc"],
        "som": ["early", "check", "nhan"],
        "muon": ["late", "check", "tra"],
        "gio": ["hourly", "check", "yen", "tinh", "nhan", "tra"],
        "hourly": ["theo", "gio"],
        "coc": ["deposit", "momo", "thanh", "toan", "giu"],
        "deposit": ["coc", "momo", "giu"],
        "breakfast": ["bua", "sang"],
        "wifi": ["internet", "mang"],
        "suoi": ["heater", "chan", "am"],
        "heater": ["suoi", "chan"],
        "quiet": ["yen", "tinh", "on"],
        "yen": ["tinh", "quiet", "on"],
        "noi": ["quy", "chung"],
        "quy": ["noi", "chinh", "sach"],
        "chia": ["khoa", "mat", "boi", "thuong"],
        "khoa": ["chia", "mat"],
        "trung": ["tam", "ho", "xuan", "huong"],
    }
    expanded = set(tokens)
    for t in tokens:
        expanded.update(synonym_map.get(t, []))

    scored_sections = []
    for sec in data["policy_sections"]:
        hay_words = set(_norm(sec["title"] + " " + sec["text"]).split())
        score = sum(1 for tok in expanded if tok in hay_words)
        if score > 0:
            scored_sections.append((score, sec))
    scored_sections.sort(key=lambda x: x[0], reverse=True)

    scored_faqs = []
    for faq in data["faqs"]:
        hay_words = set(_norm(faq["question"] + " " + faq["answer"]).split())
        score = sum(1 for tok in expanded if tok in hay_words)
        if score > 0:
            scored_faqs.append((score, faq))
    scored_faqs.sort(key=lambda x: x[0], reverse=True)

    return {
        "property": data["property"]["name"],
        "found": bool(scored_sections or scored_faqs),
        "sections": [s for _, s in scored_sections[:3]],
        "faqs": [f for _, f in scored_faqs[:3]],
    }


@tool
def list_rooms(guests: int = 1, mode: str = "all") -> dict:
    """Tên: list_rooms — Liệt kê các hạng phòng đang mở bán kèm sức chứa và giá gốc.
    Input: guests (int, mặc định 1), mode ('nightly' | 'hourly' | 'all').
    Output: dict danh sách phòng phù hợp (code, name, max_guests, beds, base_nightly_price, base_hourly_price, amenities).
    Tác động ra ngoài: Không (chỉ đọc danh mục phòng)."""
    data = _load_data()
    g = int(guests or 1)
    m = (mode or "all").lower()
    rooms = []
    for r in data["rooms"]:
        if r["max_guests"] < g:
            continue
        if m == "hourly" and not r["supports_hourly"]:
            continue
        if m == "nightly" and not r["supports_nightly"]:
            continue
        rooms.append({
            "code": r["code"],
            "name": r["name"],
            "max_guests": r["max_guests"],
            "base_guests": r["base_guests"],
            "beds": r["beds"],
            "area_m2": r["area_m2"],
            "nightly_price": r["base_nightly_price"],
            "hourly_price": r["base_hourly_price"] if r["supports_hourly"] else None,
            "min_hours": r["min_hours"] if r["supports_hourly"] else None,
            "extra_guest_fee": r["extra_guest_fee"],
            "amenities": r["amenities"],
        })
    return {
        "count": len(rooms),
        "rooms": rooms,
        "note": "Đây là giá gốc ngày thường; cuối tuần (T6, T7) +20%. Dùng check_availability để tính giá chính xác theo ngày.",
    }


@tool
def check_availability(start: str, end: str, guests: int = 2, room_name: str = "") -> dict:
    """Tên: check_availability — Kiểm tra phòng trống theo ngày nhận/trả phòng và tính báo giá chính xác (bao gồm phụ thu cuối tuần, khách thêm, tiền cọc 30%).
    Input: start (YYYY-MM-DD), end (YYYY-MM-DD), guests (int), room_name (str, tuỳ chọn nếu hỏi 1 phòng cụ thể).
    Output: dict danh sách phòng trống kèm báo giá chi tiết và danh sách phòng không phù hợp/đã kín.
    Tác động ra ngoài: Không (chỉ kiểm tra lịch và báo giá)."""
    data = _load_data()
    try:
        s_date = datetime.date.fromisoformat(start)
        e_date = datetime.date.fromisoformat(end)
    except ValueError:
        return {"error": "Định dạng ngày phải là YYYY-MM-DD (ví dụ 2026-12-05)."}
    if e_date <= s_date:
        return {"error": "Ngày trả phòng phải sau ngày nhận phòng ít nhất 1 đêm."}
    if s_date < TODAY:
        return {"error": f"Ngày nhận phòng không thể trước hôm nay ({TODAY.isoformat()})."}

    g = int(guests or 2)
    target = _find_room(data, room_name) if room_name else None
    if room_name and not target:
        return {"error": f"Không tìm thấy phòng '{room_name}'. Gọi list_rooms để xem danh sách phòng."}

    candidates = [target] if target else data["rooms"]
    available = []
    unavailable = []
    for r in candidates:
        if r["max_guests"] < g:
            unavailable.append({"room_name": r["name"], "reason": f"Tối đa {r['max_guests']} khách (bạn hỏi {g} khách)."})
            continue
        conflict = None
        for b in data["bookings"]:
            if b["room_code"] == r["code"] and b["status"] in ("Confirmed", "PendingDeposit", "Hold", "CheckedIn"):
                bs = datetime.date.fromisoformat(b["start"])
                be = datetime.date.fromisoformat(b["end"])
                if _dates_overlap(s_date, e_date, bs, be):
                    conflict = b
                    break
        if conflict:
            unavailable.append({"room_name": r["name"], "reason": f"Đã có khách đặt từ {conflict['start']} đến {conflict['end']}."})
            continue
        available.append(_quote_nightly(data, r, start, end, g))

    result = {"start": start, "end": end, "guests": g, "available": available, "unavailable": unavailable}
    if target and not available:
        alternatives = []
        for r in data["rooms"]:
            if r["code"] == target["code"] or r["max_guests"] < g:
                continue
            has_conflict = any(
                b["room_code"] == r["code"]
                and b["status"] in ("Confirmed", "PendingDeposit", "Hold", "CheckedIn")
                and _dates_overlap(s_date, e_date, datetime.date.fromisoformat(b["start"]), datetime.date.fromisoformat(b["end"]))
                for b in data["bookings"]
            )
            if not has_conflict:
                alternatives.append(_quote_nightly(data, r, start, end, g))
        result["alternatives"] = alternatives
    return result


@tool
def find_booking(code: str, phone: str) -> dict:
    """Tên: find_booking — Tra cứu thông tin đơn đặt phòng hiện có. Bắt buộc có cả mã đặt phòng VÀ số điện thoại đã đặt.
    Input: code (str, vd STR-7K3Q9P), phone (str, vd 0912345678).
    Output: dict thông tin đơn đặt phòng hoặc lỗi xác thực nếu thiếu/sai.
    Tác động ra ngoài: Không (chỉ đọc)."""
    data = _load_data()
    c = (code or "").strip().upper()
    p = re.sub(r"\D", "", phone or "")
    if p.startswith("84") and len(p) >= 11:
        p = "0" + p[2:]
    if not c or not p:
        return {"error": "Cần đủ cả mã đặt phòng và số điện thoại đã dùng khi đặt để tra cứu."}
    for b in data["bookings"]:
        if b["code"].upper() == c and b["guest_phone"] == p:
            return {
                "found": True,
                "code": b["code"],
                "room_name": b["room_name"],
                "start": b["start"],
                "end": b["end"],
                "guests": b["guests"],
                "guest_name": b["guest_name"],
                "status": b["status"],
                "total": b["total"],
                "deposit": b["deposit"],
                "paid": b["paid"],
                "remaining_balance": max(0, b["total"] - b["paid"]),
            }
    return {"found": False, "error": "Không tìm thấy đặt phòng khớp với mã và số điện thoại này."}


@tool
def quote_cancellation(code: str, phone: str) -> dict:
    """Tên: quote_cancellation — Tính số tiền hoàn dự kiến khi hủy đơn đặt phòng theo chính sách hoàn tiền đang áp dụng (không thực hiện hủy).
    Input: code (str), phone (str).
    Output: dict gồm số giờ trước check-in, quy tắc áp dụng (CS-05), phần trăm hoàn và số tiền hoàn (VND).
    Tác động ra ngoài: Không (chỉ báo giá hoàn tiền)."""
    booking = find_booking(code, phone)
    if not booking.get("found"):
        return booking
    data = _load_data()
    checkin_dt = datetime.datetime.fromisoformat(f"{booking['start']}T{data['property']['check_in_time']}:00")
    now_dt = datetime.datetime(2026, 11, 27, 17, 30, 0)
    hours_before = round((checkin_dt - now_dt).total_seconds() / 3600.0, 1)

    matched = None
    for rule in data["refund_policy"]["rules"]:
        mx = rule["max_hours"]
        if hours_before >= rule["min_hours"] and (mx is None or hours_before < mx):
            matched = rule
            break

    if hours_before <= 0:
        pct = data["refund_policy"]["no_show_refund_percent"]
        label = "Từ giờ nhận phòng trở đi (tính như không đến)"
        source = "CS-05 (trang 1)"
    elif matched:
        pct = matched["refund_percent"]
        label = matched["label"]
        source = matched["source"]
    else:
        return {"error": "Không có quy tắc phù hợp, cần chuyển chủ hộ duyệt thủ công."}

    base_amount = booking["deposit"]
    refund_amount = min(booking["paid"], _round_thousand(base_amount * pct / 100.0))
    return {
        "code": booking["code"],
        "hours_before_checkin": hours_before,
        "rule_label": label,
        "source": source,
        "refund_percent": pct,
        "paid": booking["paid"],
        "refund_amount": refund_amount,
        "note": "Đây mới là báo giá hoàn tiền, chưa hủy đơn.",
    }


@tool
def create_booking_draft(
    room_name: str,
    start: str,
    end: str,
    guests: int,
    guest_name: str,
    guest_phone: str,
    note: str = "",
) -> dict:
    """Tên: create_booking_draft — Tạo BẢN NHÁP giữ chỗ đặt phòng (chờ khách xác nhận cuối cùng & thanh toán cọc MoMo).
    Input: room_name, start (YYYY-MM-DD), end (YYYY-MM-DD), guests, guest_name, guest_phone, note.
    Output: dict bản nháp đặt phòng kèm tổng tiền và tiền cọc 30%.
    Tác động ra ngoài: Chỉ tạo bản nháp chờ người xác nhận, KHÔNG tự trừ tiền hay gửi tin ra ngoài."""
    phone_digits = re.sub(r"\D", "", guest_phone or "")
    if phone_digits.startswith("84") and len(phone_digits) >= 11:
        phone_digits = "0" + phone_digits[2:]
    if len(phone_digits) < 9 or not (guest_name or "").strip():
        return {"error": "Cần họ tên đầy đủ và số điện thoại di động hợp lệ để tạo bản nháp giữ chỗ."}

    avail = check_availability(start=start, end=end, guests=guests, room_name=room_name)
    if avail.get("error"):
        return avail
    if not avail["available"]:
        reason = avail["unavailable"][0]["reason"] if avail["unavailable"] else "Phòng không còn trống."
        return {"error": reason}

    q = avail["available"][0]
    return {
        "status": "DRAFT_PENDING_CONFIRMATION",
        "room_code": q["room_code"],
        "room_name": q["room_name"],
        "start": start,
        "end": end,
        "nights": q["nights"],
        "guests": guests,
        "guest_name": guest_name.strip(),
        "guest_phone": phone_digits,
        "note": note.strip(),
        "total": q["total"],
        "deposit": q["deposit"],
        "hold_minutes": 15,
        "message": "Bản nháp đặt phòng đã sẵn sàng. Hãy tóm tắt cho khách và hỏi 'Bạn xác nhận đặt phòng nhé?' trước khi gửi link MoMo.",
    }


@tool
def handoff_to_human(reason: str) -> dict:
    """Tên: handoff_to_human — Tạo yêu cầu chuyển cuộc trò chuyện cho chủ hộ homestay tiếp quản (human takeover).
    Input: reason (str) lý do chuyển.
    Output: dict xác nhận hàng đợi chuyển chủ hộ.
    Tác động ra ngoài: Chỉ ghi nhận yêu cầu chuyển chủ hộ trong hệ thống chờ chủ hộ tiếp nhận."""
    return {
        "status": "HANDOFF_QUEUED",
        "reason": (reason or "Khách cần chủ nhà hỗ trợ trực tiếp")[:200],
        "message": "Đã tạo yêu cầu chuyển cho chủ nhà tiếp quản trên Inbox.",
    }
