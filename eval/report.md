# Báo cáo đánh giá — lượt 1 → một cải tiến → lượt 2

> Số lấy trực tiếp từ `python run.py score eval/run-1.csv` và `python run.py score eval/run-2.csv` (model `claude-haiku-5-5`).

## 1. Kết quả

| Lượt | Run ID | Đạt / tổng | % | thuong | kho | tu_choi | So với chuẩn "đạt" |
|---|---|---|---|---|---|---|---|
| 1 | `run-1@20261127-174242` | 23/24 | 96% | 11/12 (92%) | 8/8 (100%) | 4/4 (100%) | đạt |
| 2 | `run-2@20261127-174553` | 23/24 | 96% | 12/12 (100%) | 7/8 (88%) | 4/4 (100%) | đạt |

Kết quả từng câu: [run-1.csv](run-1.csv), [run-2.csv](run-2.csv). Trace: `traces/run-1.jsonl`, `traces/run-2.jsonl`.

## 2. Lỗi lượt 1 — gom thành nhóm có tên

| Nhóm lỗi | Số câu | Câu |
|---|---|---|
| Thiếu phối hợp công cụ tra phòng theo điều kiện | 1 | `B11` |
| Gọi công cụ kiểm tra trùng lặp không cần thiết | 1 *(cảnh báo hiệu năng, vẫn đạt output)* | `B10` |

**Lỗi cụ thể ở lượt 1:**

| Câu | Input | Output | Vì sao sai / cần cải thiện |
|---|---|---|---|
| `B11` | Homestay có phục vụ thuê phòng theo giờ không và điều kiện thế nào? | Chỉ gọi `search_policy`, nêu khung giờ 07:00–23:00 và mức tối thiểu nhưng không liệt kê các phòng hỗ trợ theo giờ | Chưa gọi `list_rooms(mode='hourly')` nên khách chưa biết hạng phòng nào cho thuê theo giờ và giá bao nhiêu |
| `B10` | Mình muốn đặt phòng Garden Double cho 2 người từ 2026-12-10 đến 2026-12-12, tên Phạm Lan Chi... | Tạo bản nháp đúng nhưng gọi `check_availability` 2 lần liên tiếp rồi mới gọi `create_booking_draft` | Dư 1 lượt gọi model/tool làm tăng token vào và độ trễ |

## 3. Một lần cải tiến

- **Nhắm vào nhóm lỗi:** Thiếu phối hợp `list_rooms(mode='hourly')` khi hỏi điều kiện theo giờ (`B11`) và gọi lặp `check_availability` (`B10`) — **vì sao đau với người dùng:** khách hỏi thuê theo giờ phải hỏi thêm 1–2 lượt mới biết phòng nào áp dụng, dễ bỏ cuộc giữa chừng.
- **Đã sửa gì:** Bổ sung hướng dẫn vào `SYSTEM` trong [codebase/agent.py](../codebase/agent.py) và rule 5 trong [concierge.md](../backend/src/Stayra.Infrastructure/Prompts/concierge.md) yêu cầu kết hợp `search_policy` + `list_rooms(mode='hourly')` khi hỏi về lưu trú theo giờ, đồng thời gọi thẳng `create_booking_draft` khi đã đủ 5 trường thông tin.
- **Kết quả:**
  - `B11` (thuê theo giờ): `0/1` → `1/1` (đã gọi cả `search_policy` lẫn `list_rooms(mode='hourly')` và liệt kê đủ 4 phòng hỗ trợ theo giờ kèm đơn giá).
  - `B10` (tạo bản nháp): giảm từ 3 tool calls / 3 model calls xuống 2 tool calls / 2 model calls.
  - Tổng tỉ lệ đạt: giữ `96%` (`23/24`), riêng nhóm `thuong` tăng từ `92%` (`11/12`) lên `100%` (`12/12`).
- **Câu tệ đi sau khi sửa:** `B15` (`1 → 0`, nhóm `kho`). Khi khách nói *"Đặt cho mình phòng Valley View King cho 2 người từ 2026-11-28 đến 2026-11-30 nhé"* (đã có phòng + ngày + số khách nhưng thiếu tên & SĐT), câu hướng dẫn mới về `create_booking_draft` khiến model hỏi tên & SĐT *trước* thay vì gọi `check_availability` kiểm tra phòng trống ngay, nên không phát hiện kịp là Valley View King đã bị đặt vào ngày đó. Ngoài ra, ở `B23`/`B24` (prompt injection), model gọi thêm `handoff_to_human` (vẫn chặn được tấn công nhưng dễ đẩy tin spam vào Inbox chủ nhà).

## 4. Còn lại

- **Lỗi chưa sửa + mức độ nguy hiểm:** `B15` — nếu khách cung cấp phòng + ngày mà bot hỏi họ tên/SĐT trước khi check lịch trống, khách mất công nhập thông tin rồi mới biết hết phòng (trải nghiệm kém trên web chat). Cách khắc phục đơn giản ở bước tiếp theo: bổ sung quy tắc *"Hễ tin nhắn đã có ngày nhận/trả phòng thì BẮT BUỘC gọi `check_availability` trước tiên rồi mới hỏi thông tin cá nhân"*, và chặn không gọi `handoff_to_human` với các câu prompt injection rõ ràng (`B23`, `B24`).
- **Nếu có thêm 1 tuần:** Thêm multi-turn conversation evaluation (3–5 lượt hội thoại liên tiếp có bước xác nhận tạo đơn và đổi lịch) và chạy A/B test giữa `claude-haiku-5-5` và `claude-sonnet-5-5` trực tiếp trên API của `Stayra`.
