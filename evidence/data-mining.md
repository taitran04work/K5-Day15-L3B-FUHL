# Đào data & Thống kê tái lập — cách đếm và kết quả

> Điền ở guide bước 1.2. Script đếm tự động nằm tại [evidence/count.py](count.py), đọc trực tiếp từ bộ dữ liệu khảo sát đã ẩn danh trong `evidence/survey/`.
> Bất kỳ ai chạy lệnh `python evidence/count.py` từ thư mục gốc repo đều thu được chính xác 100% các con số `x/N (%)` dưới đây.

## 1. Cách đếm — viết TRƯỚC khi chạy

- **Data dùng:** Bộ dữ liệu khảo sát thực tế đã ẩn danh thu thập ngày `27/11/2026`, gồm 2 tập độc lập:
  1. [evidence/survey/guest_results.csv](survey/guest_results.csv) — **20 phiếu khách thuê homestay** (`G01`–`G20`).
  2. [evidence/survey/host_results.csv](survey/host_results.csv) — **22 phiếu chủ & quản lý homestay** (`H01`–`H22`) tại 5 địa phương du lịch: Sapa (`6`), Đà Nẵng (`5`), Hà Giang (`4`), Ninh Bình (`4`), Lai Châu (`3`).
- **Đếm gì · trên tập nào · lọc gì:**
  - Trên tập Khách thuê (`G01`–`G20`): đếm tỉ lệ khách gặp vấn đề khi hỏi/đặt phòng (câu 13 khác `"Không gặp vấn đề"`), thời gian chờ phản hồi đầu tiên (câu 10), tỉ lệ không nhận đủ thông tin giá & phòng trống ở lượt trao đổi đầu tiên (câu 12), tỉ lệ từng từ bỏ đặt homestay vì khâu tư vấn (câu 15), và mức độ chấp nhận trợ lý tự động / yêu cầu chuyển người thật (câu 20, 22, 23, 25).
  - Trên tập Chủ/Quản lý homestay (`H01`–`H22`): đếm tỉ lệ quản lý lịch bằng Sổ tay/Excel/Google Sheets (câu 14), tỉ lệ trả lời thủ công (câu 10), thời gian tiêu tốn mỗi ngày (câu 11), tần suất bỏ sót/phản hồi chậm tin nhắn trong 30 ngày qua (câu 22), tỉ lệ từng báo nhầm/đặt trùng phòng (câu 18), và tỉ lệ biết chắc đã mất khách do phản hồi chậm (câu 23).
- **Mẫu số là gì:**
  - **Không cộng gộp hai vai.** Đếm riêng mẫu số **`N_guest = 20`** cho khách thuê homestay và **`N_host = 22`** cho chủ/quản lý homestay.
  - Với câu 12 của khách thuê (*"Lần gần nhất bạn có nhận đủ thông tin giá và phòng trống ngay trong lần trao đổi đầu tiên không?"*), trình bày cả trên mẫu số khách có nhắn tin/nhớ rõ (`n = 16`, loại 4 phiếu `"Không nhớ/không áp dụng"`) lẫn trên tổng mẫu (`N_guest = 20`).
- **Script chạy lại kết quả:**
  ```bash
  python evidence/count.py
  ```

## 2. Đọc trước, đếm sau

Đã đọc toàn bộ `20` dòng dữ liệu khách thuê, `22` dòng dữ liệu chủ homestay và từ điển 63 cột câu hỏi tại [evidence/survey/questions.md](survey/questions.md). Các *kiểu* hành vi nổi bật thấy được từ dữ liệu thô:
- **Kiểu 1 — "Rải tin hỏi nhiều nơi, bên nào rep nhanh & báo giá rõ thì chốt":** Khách xem TikTok/Facebook rồi nhắn cùng lúc `2–5` homestay. Nếu một bên ngâm tin nhắn quá `15–30 phút` hoặc báo giá thiếu phụ thu, khách chốt ngay bên khác phản hồi trong `5 phút` (`G06`, `G09`, `G13`, `G15`).
- **Kiểu 2 — "Tra lịch Excel/Sổ tay thủ công gây nghẽn dây chuyền":** Chủ nhà nhận `5–30+` cuộc hội thoại/ngày qua Zalo/Messenger nhưng lịch phòng lại nằm trên Sổ tay hoặc file Excel/Google Sheets rời rạc với Booking/Agoda/Airbnb. Mỗi lần khách hỏi là một lần mở sheet tra tay, nhẩm phụ thu cuối tuần/lễ rồi sau khi khách cọc lại phải tự sửa sheet bằng tay (`H01`, `H03`, `H08`, `H14`).
- **Kiểu 3 — "Dị ứng với phụ thu ẩn và chatbot trả lời chung chung":** Khách không ghét chatbot, nhưng sẽ bỏ đi ngay nếu chatbot chỉ trả lời kịch bản cứng không đúng trọng tâm (`G18`) hoặc báo giá ban đầu rẻ rồi lúc chốt mới cộng thêm phí dọn phòng/cuối tuần (`G13`, `G14`).

## 3. Kết quả (`python evidence/count.py`)

### 3.1. Tập Khách thuê homestay (`N = 20`)

| Đếm gì | x / N | % | Ghi chú |
|---|---|---|---|
| Đã tìm/hỏi thuê homestay trong 12 tháng qua | `18/20` | `90,0%` | `14/20 (70,0%)` thuê từ `2–6+ lần/năm` |
| Phải nhắn hỏi từ `2–5+` homestay mỗi chuyến đi trước khi chốt | `12/20` | `60,0%` | Để so giá, phòng trống và chờ phản hồi |
| **Gặp ít nhất 1 vấn đề (pain) khi hỏi hoặc đặt phòng** | **`16/20`** | **`80,0%`** | Tương đương `16/18 (88,9%)` nhóm có thuê trong 12 tháng |
| Phải chờ phản hồi đầu tiên từ `5 phút` đến `4 giờ+` (hoặc không được rep) | `14/20` | `70,0%` | Chỉ `3/20 (15,0%)` nhận phản hồi dưới 5 phút |
| **Phải chờ phản hồi đầu tiên `> 15 phút` đến `4 giờ+` (hoặc không được rep)** | **`8/20`** | **`40,0%`** | Trong khi `15/20 (75,0%)` chỉ chấp nhận chờ tối đa `≤ 30 phút` |
| **Không nhận đủ thông tin giá & phòng trống ngay ở lượt trao đổi đầu** | **`8/16`** | **`50,0%`** | Tính trên 16 khách có nhắn hỏi (`8/20 = 40,0%` tổng mẫu) |
| Gặp vấn đề **Phản hồi chậm** (câu 13) | `8/20` | `40,0%` | Pain phổ biến số 1 phía khách thuê |
| Gặp vấn đề **Phải hỏi lại nhiều lần** / **Không rõ giá & phụ thu** | `7/20` | `35,0%` | Mỗi vấn đề đều chiếm `7/20 (35,0%)` |
| **Đã từng TỪ BỎ đặt một homestay vì quá trình tư vấn** | **`8/20`** | **`40,0%`** | Tương đương `8/18 (44,4%)` khách có tìm thuê 12 tháng qua |
| Lo ngại trợ lý tự động **báo sai giá hoặc báo sai phòng trống** | `14/20` | `70,0%` | Lý do Stayra bắt buộc dùng công cụ tính giá/lịch deterministic |
| Yêu cầu người thật / bước xác nhận rõ ở khâu **Đặt cọc / thanh toán** | `13/20` | `65,0%` | Và `12/20 (60,0%)` ở bước **Xác nhận đặt phòng** |
| Sẵn sàng thử nghiệm công cụ trợ lý đặt phòng (`Có` / `Có thể`) | `18/20` | `90,0%` | `16/20 (80,0%)` sẵn sàng chat với trợ lý tự động |

### 3.2. Tập Chủ & Quản lý homestay (`N = 22`)

| Đếm gì | x / N | % | Ghi chú |
|---|---|---|---|
| Tiếp nhận từ `5–50` cuộc hội thoại hỏi phòng mỗi ngày | `18/22` | `81,8%` | `13/22 (59,1%)` nhận `5–15 cuộc/ngày`; `5/22 (22,7%)` nhận `16–50 cuộc/ngày` |
| **Quản lý lịch phòng trống bằng Sổ tay, Excel hoặc Google Sheets** | **`21/22`** | **`95,5%`** | Chỉ `1/22 (4,5%)` dùng hoàn toàn phần mềm quản lý tự động |
| **Trả lời khách bằng phương thức Thủ công** (kèm tin nhắn mẫu) | **`19/22`** | **`86,4%`** | Phải tự mở lịch đối chiếu và gõ tin nhắn trả lời |
| **Mất từ `1 đến trên 4 giờ/ngày` để trả lời tin nhắn khách** | **`19/22`** | **`86,4%`** | Trong đó **`13/22 (59,1%)` mất từ `2–4+ giờ/ngày`** |
| Gặp khó khăn do **Câu hỏi lặp lại** (giá, lịch trống, tiện nghi, giờ giấc) | `20/22` | `90,9%` | Pain phổ biến số 1 phía chủ homestay |
| Gặp khó khăn do **Phản hồi chậm** | `14/22` | `63,6%` | Kèm `13/22 (59,1%)` mất thời gian tra phòng & `13/22 (59,1%)` mất thời gian báo giá |
| **Bỏ sót hoặc phản hồi chậm tin nhắn `≥ 1 lần` trong 30 ngày gần nhất** | **`20/22`** | **`90,9%`** | `14/22` bị `1–5 lần/tháng`; `6/22` bị `6–10+ lần/tháng` |
| **Từng đặt trùng phòng hoặc báo nhầm phòng trống** | **`19/22`** | **`86,4%`** | `1/22` thường xuyên, `12/22` thỉnh thoảng, `6/22` hiếm khi |
| **Biết chắc chắn mình từng MẤT KHÁCH do phản hồi chậm** | **`9/22`** | **`40,9%`** | Thêm `6/22 (27,3%)` không xác định được số khách đã rời đi |
| Có nhu cầu sử dụng công cụ AI tư vấn & giữ phòng (`Rất cần` / `Có thể cần`) | `19/22` | `86,4%` | `14/22 (63,6%)` đánh giá **`Rất cần`**; `18/22 (81,8%)` sẵn sàng thử nghiệm |

## 4. ≥5 ví dụ cụ thể (mã dòng đã ẩn danh trong `evidence/survey/`)

1. **`G06` (`evidence/survey/guest_results.csv` dòng 7):** Khách thuê `2–3 lần/năm`, nhóm `3–5 người`, chờ phản hồi `Trên 1–4 giờ`, không nhận đủ giá/phòng trống ở lượt đầu → *"Thấy homestay trên TikTok, nhắn Messenger hỏi giá cuối tuần, đợi hơn 2 tiếng không ai rep nên qua chỗ khác, chỗ mới rep trong 5 phút là chốt luôn."*
2. **`G14` (`evidence/survey/guest_results.csv` dòng 15):** Khách đi Đà Lạt, hỏi `4–5 homestay`, chờ `Trên 15–60 phút`, từng bỏ đặt phòng → *"Tìm homestay ở Đà Lạt, hỏi 5 chỗ để so giá, có chỗ báo giá rẻ nhưng đến lúc chốt lại cộng thêm phí dọn phòng và phí cuối tuần nên vượt ngân sách, đành bỏ."*
3. **`G15` (`evidence/survey/guest_results.csv` dòng 16):** Khách đi gia đình `3–5 người`, nhắn Messenger buổi tối nhưng `Không nhận phản hồi` → *"Nhắn hỏi homestay ở Mộc Châu từ tối hôm trước, sáng hôm sau vẫn chưa thấy rep, gọi điện cũng không nghe máy nên đặt chỗ khác qua Booking luôn."*
4. **`H01` (`evidence/survey/host_results.csv` dòng 2):** Chủ homestay tại Hà Giang, quy mô `6–10 phòng`, `5–15 cuộc hội thoại/ngày`, mất `2–4 giờ/ngày` trả lời khách, quản lý bằng Sổ tay/Excel/Google Sheets → *"mình phải vào sheet xem còn phòng không, hiện trạng như nào rồi mới báo cho khách được ... mình phải tự lên sheet cập nhật bằng tay"*.
5. **`H02` (`evidence/survey/host_results.csv` dòng 3):** Chủ homestay tại Hà Giang, quy mô `11–20 phòng`, mất `Trên 4 giờ/ngày` trả lời khách, bỏ sót/phản hồi chậm `Trên 10 lần/tháng`, `Thường xuyên` bị đặt trùng/báo nhầm phòng và xác nhận `Có` mất khách do phản hồi chậm.
6. **`H14` (`evidence/survey/host_results.csv` dòng 15):** Chủ homestay tại Lai Châu, quy mô `6–10 phòng`, `16–30 cuộc hội thoại/ngày`, mất `2–4 giờ/ngày`, dữ liệu phân tán giữa Booking và Google Sheets, trễ tin nhắn `6–10 lần/tháng` và xác nhận `Có` mất khách do phản hồi chậm → *"Mở Booking và sheet kiểm tra rồi báo khách ... Nhân viên cập nhật sheet sau khi khách cọc"*.

## 5. Giới hạn của data

- **Giới hạn:** Dữ liệu khảo sát ghi nhận chính xác tần suất, khoảng thời gian chờ theo bậc (`5–15 phút`, `15–60 phút`, `1–4 giờ`) và hành vi tự thuật của `42` người dùng thật, nhưng chưa đo log timestamp từng giây trên khung chat production khi khách thao tác thanh toán MoMo.
- **Cách kiểm chứng bổ sung:** Nhóm đối chiếu trực tiếp các kịch bản đau nhất từ dữ liệu khảo sát (`G03` hỏi giá cuối tuần trọn gói, `G08` nhóm đông quá sức chứa, `G14` phụ thu cuối tuần/thêm khách, `H02`/`H14` tránh đặt trùng phòng) vào **24 câu thử tự động** trong [eval/benchmark.csv](../eval/benchmark.csv) và kiểm thử khóa chống đặt trùng Postgres `btree_gist` trong `Stayra.Tests`.
