# Data card — đặt phòng homestay qua chatbot

## Dataset 1 · Dữ liệu demo Stayra

| Mục | Mô tả |
|---|---|
| Dùng để làm gì | Kiểm tra đề xuất phòng, tra lịch, báo giá, tiền cọc và giữ phòng qua chatbot. |
| Nguồn và phiên bản | Seed trong repo. Pine Hill là cơ sở demo chính, Sea Breeze là cơ sở demo thứ hai, có cấu hình khác. [Mã tạo seed](../backend/src/Stayra.Infrastructure/Persistence/DatabaseSetup.cs) |
| Quy mô | 2 homestay và 10 phòng trong seed, gồm 6 phòng Pine Hill và 4 phòng Sea Breeze. |
| Xử lý | Seed nạp phòng, sức chứa, quy tắc giá và đặt phòng mẫu vào Postgres. Chatbot tra theo cơ sở hiện tại, ngày ở và số khách. Giá và tiền cọc được tính tại thời điểm tra. |
| Nhãn | `synthetic`. Tên phòng, lịch mẫu và giao dịch demo phục vụ thử kỹ thuật. |
| Giới hạn | Lịch phụ thuộc ngày chạy và các lượt giữ phòng được tạo trong demo. Dữ liệu người dùng thật chưa được thu trong repo. |

## Dataset 2 · Kịch bản thử chat đặt phòng

Có 9 kịch bản viết tay, từ S01 đến S09, ở [spec.md](../spec.md). Chúng bao phủ phòng trống, thiếu thông tin, sửa yêu cầu, chuyển chủ nhà, phòng vừa hết, giữ phòng và trạng thái chờ đặt cọc. Chạy với thông tin liên hệ giả lập và ghi kết quả theo từng bước. Câu thử từ khách thật sẽ có nguồn và được ẩn danh trước khi nhập vào bộ đánh giá.
