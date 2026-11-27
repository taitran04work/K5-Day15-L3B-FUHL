# Data card — dữ liệu bản chạy thử dùng

> Dữ liệu chạy thử của lát cắt **AI Concierge trên Web cho chủ hộ homestay** lưu trong [homestay_data.json](homestay_data.json). Không chứa dữ liệu cá nhân thật của khách hàng.

## Dataset 1 · Dữ liệu cơ sở, phòng, quy tắc giá & nội quy Pine Hill Homestay

| | |
|---|---|
| Dùng để làm gì | Nguồn sự thật cho các công cụ tra cứu trong `codebase/tools.py` (`search_policy`, `list_rooms`, `check_availability`, `quote_cancellation`, `find_booking`) và bộ câu thử `eval/benchmark.csv` |
| Từ đâu | Trích xuất trực tiếp từ dữ liệu mẫu (seed) của hệ thống `Stayra`: `backend/src/Stayra.Infrastructure/Persistence/DatabaseSetup.cs` và tài liệu nội quy `backend/src/Stayra.Infrastructure/Persistence/SeedPdf.cs` |
| Xử lý những bước gì | Chuyển cấu trúc C# & nội dung PDF thành JSON chuẩn hóa tiếng Việt (`policy_sections` CS-01..CS-07, `faqs` FAQ-01..FAQ-04, 6 hạng phòng PH-LOFT..PH-CAB, quy tắc giá cuối tuần +20% / Tết / theo giờ, 3 mức hoàn tiền) |
| Số dòng / số đoạn | 6 hạng phòng · 7 mục nội quy (`CS-01`..`CS-07`) · 4 FAQ · 3 quy tắc hoàn tiền · 3 đơn đặt phòng mẫu ẩn danh |
| Phiên bản / ngày lấy | 2026-11-27 |
| Nhãn | `synthetic` (dữ liệu seed mô phỏng chuẩn của hệ thống, không có PII thật) |
| Giới hạn | Dữ liệu đơn đặt phòng mẫu chỉ có 3 đơn giả lập (`STR-7K3Q9P`, `STR-8M4P2X`, `STR-9P5R3T`) dùng để kiểm tra tra cứu/tính hoàn tiền/phát hiện trùng lịch; khi chạy trên web thật (`Stayra`), công cụ truy vấn trực tiếp PostgreSQL theo từng `TenantId`. |

**Data `synthetic` (dữ liệu đặt phòng giả lập):** 3 mã đặt phòng sử dụng tên giả và số điện thoại thử nghiệm (`0912345678`, `0987654321`, `0903456789`) do nhóm kiểm tra thủ công toàn bộ số tiền (tính theo công thức `PricingEngine`: làm tròn đến 1.000 ₫, +20% đêm thứ Sáu & thứ Bảy, cọc 30%).
