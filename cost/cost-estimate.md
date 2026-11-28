# Chi phí khi dùng thật

> Điền ở guide bước 4.2, nộp ở CP4 14:30 Thứ Bảy 28/11. Ôn lại: ngày 13, ngày 1, ngày 14 · lab ngày 13, lab ngày 14. Chấm ở rubric R6.
> Số liệu lấy trực tiếp từ `python run.py simulate --rate-from eval/run-2.csv` trong [cost/simulate-1-summary.md](simulate-1-summary.md).

## 1. Đầu vào

- **Persona** ([cost/personas.yaml](personas.yaml)): 3 kiểu khách nhắn chat hỏi/đặt phòng trên 1 homestay quy mô cơ sở (`6–10` phòng) · tỉ lệ + số phiên/tháng + số lượt hỏi/phiên lấy từ khảo sát `n = 20` khách & `n = 22` chủ hộ tại [evidence/summary.md](../evidence/summary.md) và [spec.md](../spec.md) §2:
  - `dung_it` (`50%`, `1` phiên/tháng, `1` lượt/phiên): hỏi nhanh nội quy, giờ nhận phòng, chỗ đỗ xe, hỏi ngoài giờ (`25%`).
  - `dung_vua` (`35%`, `1` phiên/tháng, `2` lượt/phiên): hỏi phòng trống + hỏi lại giá trọn gói, phụ thu cuối tuần, tiền cọc (`50%` phải hỏi lại).
  - `dung_nhieu` (`15%`, `2` phiên/tháng, `3` lượt/phiên): đi nhóm, chọn phòng, xác nhận bản nháp giữ chỗ (`65%` cần bước xác nhận rõ ở khâu đặt cọc).
- **Số người dùng thật** (khách nhắn hỏi phòng trên 1 homestay/tháng) 3 kịch bản: thấp `150` (~5 cuộc/ngày, *(tự ước tính)*) · cơ sở `300` (~10 cuộc/ngày, trung vị nhóm `5–15 cuộc/ngày` chiếm `59,1%` ở khảo sát chủ hộ `n = 22`) · cao `750` (~25 cuộc/ngày, đại diện cao điểm nhóm `16–50 cuộc/ngày` chiếm `22,7%`, *(tự ước tính)*).
- **Giá** 2 mức model (từ `https://www.anthropic.com/pricing`, xem ngày `28/11/2026`):
  - `claude-haiku-5-5` (prompts ≤100K): `$0.10` / 1M token vào · `$0.50` / 1M token ra.
  - `claude-sonnet-5-5`: `$2.00` / 1M token vào · `$10.00` / 1M token ra.
  - Tỷ giá quy đổi: `1 USD = 26.030 ₫` (`https://www.vietcombank.com.vn`, tỷ giá bán ngày `27/11/2026`).
- **Tỉ lệ đạt** dùng để tính: `23/24` (`96%`) — lượt `run-2@20261127-174553` ([eval/run-2.csv](../eval/run-2.csv)).
- **Ghi chú đo token:** đo token thật trên model `claude-haiku-5-5`, tính giá cho `claude-haiku-5-5` và đối chiếu trên `claude-sonnet-5-5` (lưu ý nếu đổi sang họ model khác bộ tách token thì số token thật có thể lệch).

## 2. Kết quả mô phỏng

Lượt mô phỏng: [cost/simulate-1.csv](simulate-1.csv) · run ID `simulate-1@20261128-124020` · `50` phiên (`0/50` phiên lỗi) · seed `42` · trace [traces/simulate-1.jsonl](../traces/simulate-1.jsonl).

| Persona | Số phiên mô phỏng | Lượt hỏi / phiên | Token vào / phiên | Token ra / phiên | Gọi model / phiên | Gọi công cụ / phiên |
|---|---:|---:|---:|---:|---:|---:|
| `dung_it` | 21 | 1 | 5.738 | 555 | 2,0 | 1,0 |
| `dung_vua` | 21 | 2 | 11.568 | 1.406 | 4,0 | 2,2 |
| `dung_nhieu` | 8 | 3 | 17.906 | 1.766 | 6,2 | 3,6 |

| Model (giá) | Chi phí / phiên | Chi phí / task thành công | Chi phí / câu hỏi đạt | Chi phí / tháng — thấp (150 người) | Chi phí / tháng — cơ sở (300 người) | Chi phí / tháng — cao (750 người) | Chi phí / người / tháng (cơ sở) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `claude-haiku-5-5` (vào 0.1 · ra 0.5 $/1M) | $0.0016 (≈ 41 ₫) | $0.0016 (≈ 43 ₫) | $0.00094 (≈ 24 ₫) | $0.2818 (≈ 7.335 ₫) | $0.5636 (≈ 14.671 ₫) | $1.41 (≈ 36.676 ₫) | $0.0019 (≈ 49 ₫) |
| `claude-sonnet-5-5` (vào 2.0 · ra 10.0 $/1M) | $0.0313 (≈ 816 ₫) | $0.0327 (≈ 851 ₫) | $0.0188 (≈ 489 ₫) | $5.64 (≈ 146.706 ₫) | $11.27 (≈ 293.412 ₫) | $28.18 (≈ 733.530 ₫) | $0.0376 (≈ 978 ₫) |

Chi phí / task thành công = chi phí trung bình mỗi phiên ÷ tỉ lệ đạt (`96%` từ `eval/run-2.csv`).

## 3. So với impact

- **Impact / tháng trên 1 homestay cơ sở (`~300` phiên/tháng, [spec.md](../spec.md) §2):** tiết kiệm **`~92 giờ chờ đợi/tháng`** cho khách (`25 phút → ~2 phút`/phiên) và **`~60 giờ công/tháng`** (`~2 giờ/ngày`) cho chủ hộ khỏi tra Excel/Sheet thủ công; đồng thời giảm nguy cơ mất đơn do phản hồi chậm (`40%` khách từng bỏ cuộc, `40,9%` chủ hộ xác nhận mất khách).
- **Chi phí / tháng & / người / tháng (cơ sở, model `claude-haiku-5-5`):** **`$0.5636/tháng` (≈ `14.671 ₫/tháng`)** cho cả homestay (tương đương **`49 ₫/khách/tháng`** và **`43 ₫/task thành công`**).
- **Kết luận một dòng — đáng làm không:** **Rất đáng làm (GO)** với `claude-haiku-5-5` — chỉ cần giữ lại 1 đơn đặt phòng/tháng (cọc 30% từ `165.000–612.000 ₫`) đã lớn hơn **11–42 lần** toàn bộ chi phí AI cả tháng (`14.671 ₫`), trong khi `claude-sonnet-5-5` (`293.412 ₫/tháng`) chỉ nên dùng dự phòng cho tác vụ phức tạp.

## 4. Cần gạt tối ưu & chi phí vận hành

- **Cần gạt giảm chi phí token:** (1) bật **Anthropic Prompt Caching** cho `SYSTEM` prompt & tool definitions (giảm tới ~90% chi phí token đọc lại từ lượt 2 trở đi, hiện hệ thống `Stayra` `.NET` đã gắn `CacheControlEphemeral` ở `ConciergeService.cs`); (2) giữ `MAX_STEPS = 5` và loại bỏ gọi trùng `check_availability` trước `create_booking_draft` (đã giúp `B10` giảm 1 lượt gọi model/tool ở Lượt 2); (3) nén JSON trả về của `list_rooms` / `check_availability` chỉ giữ trường cần thiết.
- **Chi phí ngoài model:** hạ tầng Docker (.NET API + PostgreSQL pgvector + React static) có thể chạy trên 1 VPS cơ bản (~150.000–300.000 ₫/tháng cho nhiều homestay dùng chung) và chủ hộ chỉ tốn giờ công xử lý các ca `handoff_to_human` (khiếu nại / xin ngoại lệ).
