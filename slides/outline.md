# Dàn slide → lấy số từ file nào

> Làm ở guide bước 5.1. Luật: **không có bằng chứng thì không có slide** — mỗi trang ≥1 con số / trích dẫn có nguồn / kết quả đo.
> Xuất PDF thành `demo-slides.pdf` ở thư mục gốc repo, nộp tại CP4 14:30 Thứ Bảy 28/11. Nộp PDF, không nộp link.

| # | Trang | Có gì | Số lấy từ | Xong |
|---|---|---|---|---|
| 1 | Người dùng & pain | `N=42` (`20` khách `G01`–`G20`, `22` chủ `H01`–`H22`) · `80%` khách gặp pain, `40%` bỏ đặt · `95,5%` chủ dùng Excel/Sheet, `86,4%` mất `1–4+h/ngày` + trích `G06`, `H01` | `evidence/summary.md` | ☑ |
| 2 | Vì sao chọn bài này | Bảng impact rút gọn (`~92h` chờ của khách + `~60h` công chủ hộ/tháng) + hướng bị loại | `spec.md` §2 | ☑ |
| 3 | Giải pháp | Lát cắt một câu · sơ đồ 5 bước · AI tự làm đến đâu (`7` deterministic tools + giữ chỗ 15p + `handoff_to_human`) · 3 điều KHÔNG làm | `spec.md` §4 | ☑ |
| 4 | Demo live | Ca thường `B03`/`S01` (`Pine Loft` cuối tuần `2.040.000₫`, cọc `612.000₫`, mã giữ chỗ + QR MoMo) + Ca khó `B15`/`B23` + Video dự phòng `docs/demo-ai-30s.mp4` | `eval/benchmark.csv`, `docs/demo-ai-30s.mp4` | ☑ |
| 5 | **Đánh giá thế nào** | `24` câu thử (`9/24 = 37,5% data_that`), 4 metric, `run-1` (`23/24 = 96%`, lỗi `B11`) → 1 cải tiến → `run-2` (`23/24 = 96%`, `thuong 100%`, hồi quy `B15`) | `eval/README.md`, `eval/report.md` | ☑ |
| 6 | **Chi phí khi dùng thật** | `simulate-1` (`50` phiên, `0/50` lỗi) · `claude-haiku-5-5`: `43 ₫/task thành công`, `14.671 ₫/tháng` (300 khách) · so sánh `claude-sonnet-5-5` & Impact | `cost/cost-estimate.md`, `cost/simulate-1-summary.md` | ☑ |
| 7 | Kết luận | **GO** với Human-in-the-loop (`claude-haiku-5-5`) — dẫn số từ trang 1, 5, 6 | Trang 1, 5, 6 | ☑ |
| 8 | Nếu có thêm 1 tuần | Sửa hồi quy `B15` & chặn `handoff_to_human` khi prompt injection · eval đa lượt + A/B `haiku-5-5` vs `sonnet-5-5` · thử nghiệm thực tế (`validation/log.md`) | `eval/report.md` §4 · `validation/log.md` | ☑ |

**Trước khi lên:** tải repo về một máy khác (hoặc thư mục mới), chạy theo mục "Chạy trong 3 phút" của `README.md` · `.env` có trên máy demo, đã gọi thử 1 câu trong vòng 1 giờ trước giờ demo · video dự phòng mở được bằng cửa sổ ẩn danh · biết bản chạy thử sẽ làm gì với **1 câu thử lạ** của giám khảo.

Ai nói trang nào (mỗi người ≥1 phần):

| Trang | Người nói |
|---|---|
| 1–2 | Đồng Văn Quyến / Trần Hữu Tài *(nhóm điền tên phân công cuối)* |
| 3–4 | Nguyễn Thành Công / Nguyễn Ngọc Bách *(nhóm điền tên phân công cuối)* |
| 5–6 | Trần Hữu Tài / Nguyễn Thành Công *(nhóm điền tên phân công cuối)* |
| 7–8 | Cả nhóm chốt & Q&A |
