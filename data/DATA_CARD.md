# Data card — đặt phòng homestay qua chatbot

## Dataset 1 · Dữ liệu demo Stayra & bản trích JSON cho `codebase/`

| Mục | Mô tả |
|---|---|
| Dùng để làm gì | Kiểm tra đề xuất phòng, tra lịch, báo giá, tiền cọc, hoàn tiền, nội quy và giữ phòng qua chatbot trên cả `Stayra` (.NET/Postgres) và lát cắt Python (`codebase/tools.py`: `search_policy`, `list_rooms`, `check_availability`, `find_booking`, `quote_cancellation`). |
| Nguồn và phiên bản | Seed trong repo: `Pine Hill` là cơ sở demo chính (6 phòng + file nội quy `SeedPdf.cs`), `Sea Breeze` là cơ sở demo thứ hai (4 phòng). Bản JSON độc lập cho Python lưu tại [homestay_data.json](homestay_data.json) (ngày trích: 2026-11-27). [Mã tạo seed](../backend/src/Stayra.Infrastructure/Persistence/DatabaseSetup.cs) · [Seed PDF](../backend/src/Stayra.Infrastructure/Persistence/SeedPdf.cs) |
| Quy mô | 2 homestay và 10 phòng trong seed Postgres (6 phòng Pine Hill, 4 phòng Sea Breeze); file `homestay_data.json` gồm 6 hạng phòng Pine Hill (`PH-LOFT`..`PH-CAB`), 7 mục nội quy (`CS-01`..`CS-07`), 4 FAQ (`FAQ-01`..`FAQ-04`), 3 quy tắc hoàn tiền và 3 đơn đặt phòng mẫu ẩn danh (`STR-7K3Q9P`, `STR-8M4P2X`, `STR-9P5R3T`). |
| Xử lý | Seed nạp phòng, sức chứa, quy tắc giá (cuối tuần +20%, Tết 2027, theo giờ) và chính sách hủy vào Postgres; bản JSON chuyển hóa trực tiếp các cấu trúc này sang tiếng Việt chuẩn hóa để công cụ Python tra cứu độc lập, không dùng PII thật. |
| Nhãn | `synthetic`. Tên phòng, lịch mẫu, số điện thoại thử nghiệm (`0912345678`, `0987654321`, `0903456789`) và giao dịch demo chỉ phục vụ thử kỹ thuật. |
| Giới hạn | Lịch đặt phòng phụ thuộc dữ liệu seed; 3 đơn mẫu trong `homestay_data.json` chỉ dùng để kiểm tra tra cứu/hoàn tiền/phát hiện trùng lịch trong bộ eval offline. Dữ liệu hội thoại khách thật trên production chưa được thu vào repo. |

## Dataset 2 · Kịch bản thử hội thoại đặt phòng (`S01`–`S09`)

Có 9 kịch bản viết tay từ `S01` đến `S09` trong [spec.md](../spec.md) §5, bao phủ phòng trống, thiếu thông tin, sửa yêu cầu, chuyển chủ nhà, phòng vừa hết, giữ phòng, trạng thái chờ đặt cọc và 2 ca tấn công. Chạy với thông tin liên hệ giả lập khi test end-to-end trên web và Zalo simulator.

## Dataset 3 · Bộ câu thử tự động (`eval/benchmark.csv`)

Gồm **24 câu thử** (`B01`–`B24`: `thuong` 12 · `kho` 8 · `tu_choi` 4 gồm 2 ca prompt injection `B23`, `B24`), trong đó 9/24 câu (37,5%) lấy trực tiếp từ nút gợi ý `ChatWidget` và dữ liệu/test của hệ thống (`data_that`), 15 câu còn lại tự biên soạn (`tu_viet`). Đã chạy đánh giá thật 2 lượt với `claude-haiku-5-5` tại [eval/run-1.csv](../eval/run-1.csv) và [eval/run-2.csv](../eval/run-2.csv).
