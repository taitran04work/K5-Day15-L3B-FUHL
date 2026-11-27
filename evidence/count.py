"""Script kiểm chứng và đếm lại toàn bộ chỉ số từ dữ liệu khảo sát đã ẩn danh trong evidence/survey/.

Chạy từ thư mục gốc repo:
    python evidence/count.py
"""
import csv
import os
import sys

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
GUEST_CSV = os.path.join(HERE, "survey", "guest_results.csv")
HOST_CSV = os.path.join(HERE, "survey", "host_results.csv")


def load_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def fmt(x, n):
    pct = (x * 100.0 / n) if n else 0.0
    return f"{x}/{n} ({pct:.1f}%)"


def main():
    guests = load_rows(GUEST_CSV)
    hosts = load_rows(HOST_CSV)

    n_g = len(guests)
    n_h = len(hosts)

    print("==================================================================")
    print("1. TẬP KHẢO SÁT KHÁCH THUÊ HOMESTAY (evidence/survey/guest_results.csv)")
    print(f"   Mẫu số (N_guest): {n_g} người ngoài nhóm (G01..G20)")
    print("==================================================================")

    q01_col = "01. Trong 12 tháng qua, bạn đã tìm hoặc hỏi thuê homestay chưa?"
    q02_col = "02. Trong 12 tháng qua, bạn đã thuê homestay bao nhiêu lần?"
    q08_col = "08. Lần gần nhất bạn hỏi bao nhiêu homestay trước khi quyết định?"
    q10_col = "10. Lần gần nhất nhắn hỏi phòng, bạn chờ bao lâu để nhận phản hồi đầu tiên?"
    q11_col = "11. Thời gian chờ tối đa bạn có thể chấp nhận khi hỏi phòng?"
    q12_col = "12. Lần gần nhất bạn có nhận đủ thông tin giá và phòng trống ngay trong lần trao đổi đầu tiên không?"
    q13_col = "13. Bạn từng gặp vấn đề gì khi hỏi hoặc đặt phòng? (Chọn nhiều)"
    q15_col = "15. Trong 12 tháng qua, bạn đã từng từ bỏ đặt một homestay vì quá trình tư vấn chưa?"
    q18_col = "18. Khi homestay không phản hồi, bạn thường làm gì?"
    q20_col = "20. Bạn có sẵn sàng trao đổi với trợ lý tự động để hỏi thông tin phòng không?"
    q22_col = "22. Trường hợp nào bạn muốn nói chuyện trực tiếp với người phụ trách? (Chọn nhiều)"
    q23_col = "23. Bạn lo ngại điều gì khi trao đổi với trợ lý tự động? (Chọn nhiều)"
    q25_col = "25. Bạn có sẵn sàng thử nghiệm công cụ này khi tìm homestay không?"

    active_12m = sum(1 for r in guests if r[q01_col] == "Có")
    rent_2plus = sum(1 for r in guests if r[q02_col] in ("2–3", "4–6", "Trên 6"))
    ask_2_5_places = sum(1 for r in guests if r[q08_col] in ("2–3", "4–5", "Trên 5"))
    has_pain = sum(1 for r in guests if r[q13_col] != "Không gặp vấn đề")
    wait_5m_plus = sum(
        1 for r in guests
        if r[q10_col] in ("5–15 phút", "Trên 15–60 phút", "Trên 1–4 giờ", "Không nhận phản hồi")
    )
    wait_15m_plus = sum(
        1 for r in guests
        if r[q10_col] in ("Trên 15–60 phút", "Trên 1–4 giờ", "Không nhận phản hồi")
    )
    max_tol_under_30m = sum(
        1 for r in guests
        if r[q11_col] in ("Dưới 5 phút", "5–15 phút", "Trên 15–30 phút")
    )
    first_msg_tracked = [r for r in guests if r[q12_col] in ("Có", "Không")]
    first_msg_missing = sum(1 for r in first_msg_tracked if r[q12_col] == "Không")
    abandoned = sum(1 for r in guests if r[q15_col] == "Có")

    print(f"- Đã tìm/hỏi thuê homestay trong 12 tháng qua: {fmt(active_12m, n_g)}")
    print(f"- Thuê từ 2 lần/năm trở lên (2–3, 4–6, Trên 6): {fmt(rent_2plus, n_g)}")
    print(f"- Phải hỏi từ 2 homestay trở lên mỗi lần đặt:   {fmt(ask_2_5_places, n_g)}")
    print(f"- Gặp ít nhất 1 vấn đề khi hỏi/đặt phòng:       {fmt(has_pain, n_g)} (trên nhóm có thuê 12 tháng: {fmt(has_pain, active_12m)})")
    print(f"- Chờ phản hồi đầu tiên từ 5 phút đến 4 giờ+:   {fmt(wait_5m_plus, n_g)}")
    print(f"- Chờ phản hồi đầu tiên > 15 phút (hoặc k rep): {fmt(wait_15m_plus, n_g)}")
    print(f"- Chỉ chấp nhận chờ tối đa <= 30 phút:          {fmt(max_tol_under_30m, n_g)}")
    print(f"- KHÔNG nhận đủ giá & phòng trống ngay lượt 1:  {fmt(first_msg_missing, len(first_msg_tracked))} (trên tổng N=20: {fmt(first_msg_missing, n_g)})")
    print(f"- Đã từng TỪ BỎ đặt homestay vì khâu tư vấn:    {fmt(abandoned, n_g)} (trên nhóm có thuê 12 tháng: {fmt(abandoned, active_12m)})")

    print("\n  [Chi tiết vấn đề khách gặp phải - Câu 13]:")
    for kw in (
        "Phản hồi chậm",
        "Phải hỏi lại nhiều lần",
        "Không rõ giá/phụ thu",
        "Khó liên hệ ngoài giờ",
        "Không rõ phòng trống",
        "Thông tin không nhất quán",
        "Lo ngại đặt cọc",
        "Không được trả lời",
    ):
        cnt = sum(1 for r in guests if kw in r[q13_col])
        print(f"    + {kw:<28}: {fmt(cnt, n_g)}")

    bot_willing = sum(1 for r in guests if r[q20_col] in ("Có", "Tùy trường hợp"))
    trial_willing = sum(1 for r in guests if r[q25_col] in ("Có", "Có thể"))
    human_deposit = sum(1 for r in guests if "Đặt cọc/thanh toán" in r[q22_col])
    human_confirm = sum(1 for r in guests if "Xác nhận đặt phòng" in r[q22_col])
    fear_wrong_price_room = sum(
        1 for r in guests if ("Báo sai giá" in r[q23_col] or "Báo sai phòng trống" in r[q23_col])
    )
    print(f"\n- Sẵn sàng trao đổi với trợ lý tự động (Có / Tùy TH): {fmt(bot_willing, n_g)}")
    print(f"- Sẵn sàng thử nghiệm công cụ Stayra (Có / Có thể):   {fmt(trial_willing, n_g)}")
    print(f"- Lo ngại bot báo sai giá hoặc sai phòng trống:       {fmt(fear_wrong_price_room, n_g)}")
    print(f"- Cần người thật/xác nhận rõ ở bước Đặt cọc:          {fmt(human_deposit, n_g)}")
    print(f"- Cần người thật/xác nhận rõ ở bước Xác nhận đơn:     {fmt(human_confirm, n_g)}")

    print("\n==================================================================")
    print("2. TẬP KHẢO SÁT CHỦ & QUẢN LÝ HOMESTAY (evidence/survey/host_results.csv)")
    print(f"   Mẫu số (N_host): {n_h} cơ sở (H01..H22) tại Sapa, Đà Nẵng, Hà Giang, Ninh Bình, Lai Châu")
    print("==================================================================")

    hq08_col = "08. Trung bình mỗi ngày có bao nhiêu cuộc hội thoại hỏi phòng?"
    hq10_col = "10. Anh/chị đang trả lời khách bằng phương thức nào? (Chọn nhiều)"
    hq11_col = "11. Mỗi ngày anh/chị dành bao nhiêu thời gian trả lời khách?"
    hq14_col = "14. Anh/chị quản lý tình trạng phòng trống bằng cách nào? (Chọn nhiều)"
    hq18_col = "18. Anh/chị từng đặt trùng phòng hoặc báo nhầm phòng trống chưa?"
    hq20_col = "20. Anh/chị thường gặp khó khăn nào? (Chọn nhiều)"
    hq22_col = "22. Trong 30 ngày gần nhất, anh/chị bỏ sót hoặc phản hồi chậm tin nhắn bao nhiêu lần?"
    hq23_col = "23. Anh/chị có biết mình từng mất khách do phản hồi chậm không?"
    hq28_col = "28. Anh/chị có nhu cầu sử dụng công cụ như trên không?"
    hq31_col = "31. Anh/chị lo ngại điều gì? (Chọn nhiều)"
    hq33_col = "33. Anh/chị có sẵn sàng tham gia thử nghiệm không?"

    chats_5plus = sum(1 for r in hosts if r[hq08_col] in ("5–15", "16–30", "31–50"))
    manual_reply = sum(1 for r in hosts if "Thủ công" in r[hq10_col])
    manual_sheet = sum(
        1 for r in hosts if any(k in r[hq14_col] for k in ("Sổ tay", "Excel", "Google Sheets"))
    )
    time_1h_plus = sum(
        1 for r in hosts if r[hq11_col] in ("1 đến dưới 2 giờ", "2–4 giờ", "Trên 4 giờ")
    )
    time_2h_plus = sum(1 for r in hosts if r[hq11_col] in ("2–4 giờ", "Trên 4 giờ"))
    double_booked = sum(
        1 for r in hosts if r[hq18_col] in ("Thường xuyên", "Thỉnh thoảng", "Hiếm khi")
    )
    missed_30d = sum(1 for r in hosts if r[hq22_col] != "0.0")
    lost_guest_yes = sum(1 for r in hosts if r[hq23_col] == "Có")
    need_tool = sum(1 for r in hosts if r[hq28_col] in ("Rất cần", "Có thể cần"))
    host_fear_wrong = sum(
        1 for r in hosts if ("Sai giá" in r[hq31_col] or "Sai phòng trống" in r[hq31_col])
    )
    host_trial = sum(1 for r in hosts if r[hq33_col] == "Có")

    print(f"- Nhận từ 5–50 cuộc hội thoại hỏi phòng/ngày:         {fmt(chats_5plus, n_h)}")
    print(f"- Quản lý lịch bằng Sổ tay / Excel / Google Sheets:   {fmt(manual_sheet, n_h)}")
    print(f"- Trả lời khách bằng phương thức Thủ công:            {fmt(manual_reply, n_h)}")
    print(f"- Mất từ 1 đến trên 4 giờ/ngày để trả lời khách:      {fmt(time_1h_plus, n_h)}")
    print(f"- Mất từ 2 đến trên 4 giờ/ngày để trả lời khách:      {fmt(time_2h_plus, n_h)}")
    print(f"- Bỏ sót / phản hồi chậm >= 1 lần trong 30 ngày qua:  {fmt(missed_30d, n_h)}")
    print(f"- Từng đặt trùng phòng hoặc báo nhầm phòng trống:     {fmt(double_booked, n_h)}")
    print(f"- Biết chắc chắn từng MẤT KHÁCH do phản hồi chậm:     {fmt(lost_guest_yes, n_h)}")

    print("\n  [Chi tiết khó khăn của chủ homestay - Câu 20]:")
    for kw in (
        "Câu hỏi lặp lại",
        "Phản hồi chậm",
        "Mất thời gian kiểm tra phòng",
        "Mất thời gian báo giá",
        "Bỏ sót tin nhắn",
        "Quản lý nhiều kênh",
        "Khách nhắn ban đêm",
        "Chi phí nhân sự",
    ):
        cnt = sum(1 for r in hosts if kw in r[hq20_col])
        print(f"    + {kw:<28}: {fmt(cnt, n_h)}")

    print(f"\n- Có nhu cầu dùng công cụ AI (Rất cần / Có thể cần):  {fmt(need_tool, n_h)}")
    print(f"- Lo ngại công cụ báo sai giá hoặc sai phòng trống:   {fmt(host_fear_wrong, n_h)}")
    print(f"- Sẵn sàng tham gia thử nghiệm ngay (Có):             {fmt(host_trial, n_h)}")


if __name__ == "__main__":
    main()
