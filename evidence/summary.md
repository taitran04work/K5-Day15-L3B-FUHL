# Tổng hợp bằng chứng pain

**Lát cắt.** Đặt mới một phòng homestay qua chatbot đến khi khách nhận mã giữ phòng và thẻ đặt cọc. Kiểm giả thuyết: khách đặt homestay qua tin nhắn phải chờ chủ nhà tra lịch thủ công (Sổ tay / Excel / Google Sheets), báo giá và hỏi đi hỏi lại nhiều lượt mới biết còn phòng và tổng chi phí để giữ chỗ. [Canvas](../canvas.md) · [Kế hoạch &amp; Giả thuyết](hypothesis.md) · [Bộ câu hỏi &amp; Dữ liệu khảo sát](survey/questions.md)

> Điền ở guide bước 1.2, xong trước **CP3 10:00 Thứ Bảy 28/11**. Chấm ở rubric R1.
> Ba nguồn ngang nhau — tối thiểu **≥1 nguồn đạt ngưỡng**. Mạnh nhất: đào data ra insight → hỏi người dùng để kiểm lại (hoặc ngược lại).

## 1. Nguồn đã dùng

| Nguồn                                                           | Đạt ngưỡng? | File                                                                  |
| ---------------------------------------------------------------- | --------------- | --------------------------------------------------------------------- |
| Đào data (x/N, %, cách đếm chạy lại được, ≥5 ví dụ) | ☑              | `evidence/data-mining.md` · `evidence/count.py`                      |
| Phỏng vấn (≥3 người ngoài nhóm, đúng người dùng)     | ☐              | `evidence/interviews/P1.md`…                                       |
| Khảo sát (≥20 người ngoài nhóm, đúng người dùng)     | ☑              | `evidence/survey/questions.md` · `evidence/survey/results.csv` · `evidence/survey/guest_results.csv` · `evidence/survey/host_results.csv` |

*(Ghi chú: Nhóm thực hiện 2 khảo sát độc lập với tổng **N = 42 người ngoài nhóm**, trong đó riêng tệp **Khách thuê homestay đạt `n = 20`** và tệp **Chủ/Quản lý homestay đạt `n = 22`** tại Sapa, Đà Nẵng, Hà Giang, Ninh Bình, Lai Châu — cả hai vai đều đạt ngưỡng `≥ 20` người của BTC).*

## 2. Số chính

- **Khảo sát Khách thuê homestay (`n = 20`, mã `G01`–`G20`, chi tiết tại [guest_results.csv](survey/results.csv)):**

  - **Đối tượng & tần suất:** `18/20 (90%)` đã tìm/hỏi thuê homestay trong 12 tháng qua (`10/20 = 50%` thuê `2–3 lần/năm`, `4/20 = 20%` thuê `4–6+ lần/năm`); `12/20 (60%)` phải nhắn hỏi từ **`2–5` homestay** mỗi chuyến đi để so sánh phòng trống và giá trước khi chốt.
  - **Tỉ lệ gặp pain khi hỏi/đặt phòng:** **`16/20 (80%)`** gặp ít nhất 1 vấn đề cản trở quá trình đặt phòng (hoặc `16/18 = 88,9%` trên nhóm có hỏi thuê trong 12 tháng qua).
  - **Thời gian chờ phản hồi & hỏi lại nhiều lượt:**
    - **`14/20 (70%)`** phải chờ từ `5 phút` đến `trên 1–4 giờ` (hoặc không nhận được phản hồi) mới có tin nhắn đầu tiên; riêng nhóm phải chờ lâu **`trên 15 phút đến 4 giờ+` (hoặc không được trả lời) chiếm `8/20 (40%)`** (tương đương `8/17 = 47,1%` trong số 17 khách có nhắn/liên hệ trực tiếp).
    - **`8/16 (50%)`** khách có trao đổi trực tiếp xác nhận **không nhận đủ thông tin giá và phòng trống ngay trong lần trao đổi đầu tiên** (phải nhắn hỏi đi hỏi lại).
    - Các pain phổ biến nhất: **Phản hồi chậm** (`8/20 = 40%`), **Phải hỏi lại nhiều lần** (`7/20 = 35%`), **Không rõ giá/phụ thu** (`7/20 = 35%`), **Khó liên hệ ngoài giờ** (`5/20 = 25%`), **Không rõ phòng trống** (`4/20 = 20%`), **Thông tin không nhất quán** (`4/20 = 20%`).
  - **Hệ quả bỏ cuộc (Drop-off):** **`8/20 (40%)`** (tức `8/18 = 44,4%` khách từng thuê trong 12 tháng qua) xác nhận **đã từng từ bỏ đặt một homestay vì quá trình tư vấn** — lý do chính là *Thông tin không rõ* (`8/8`), *Chờ quá lâu* (`6/8`) và *Không được phản hồi* (`3/8`). Khi chủ không phản hồi kịp, khách sẽ *Nhắn lại* (`7/20 = 35%`), *Tìm homestay khác ngay* (`5/20 = 25%`) hoặc *Gọi điện* (`4/20 = 20%`).
  - **Mức sẵn sàng đón nhận giải pháp:** **`16/20 (80%)`** sẵn sàng trao đổi với trợ lý tự động (`9 Có`, `7 Tùy trường hợp`) và **`18/20 (90%)`** sẵn sàng thử nghiệm công cụ (`9 Có`, `9 Có thể`). Tuy nhiên, khách yêu cầu có người thật/chủ hộ hoặc bước xác nhận rõ ràng ở khâu **Đặt cọc/thanh toán (`13/20 = 65%`)** và **Xác nhận đặt phòng (`12/20 = 60%`)**.
- **Khảo sát Chủ & Quản lý homestay (`n = 22`, mã `H01`–`H22`, chi tiết tại [host_results.csv](survey/host_results.csv)):**

  - **Quy mô & khối lượng tin nhắn:** Phân bổ tại Sapa (`6`), Đà Nẵng (`5`), Hà Giang (`4`), Ninh Bình (`4`), Lai Châu (`3`); quy mô phổ biến `6–10 phòng` (`11/22 = 50%`) và `11–20+ phòng` (`5/22 = 22,7%`). Mỗi ngày tiếp nhận `5–15 cuộc hội thoại` (`13/22 = 59,1%`) hoặc `16–50 cuộc hội thoại` (`5/22 = 22,7%`).
  - **Quy trình tra lịch & báo giá thủ công:** **`21/22 (95,5%)`** quản lý lịch phòng qua **Sổ tay, Excel hoặc Google Sheets**; **`19/22 (86,4%)`** vẫn phải gõ trả lời **thủ công** (kết hợp tin nhắn mẫu).
  - **Thời gian tiêu tốn mỗi ngày:** **`19/22 (86,4%)`** mất từ **`1 đến trên 4 giờ/ngày`** chỉ để trả lời tin nhắn khách hỏi phòng (trong đó **`13/22 = 59,1%` mất từ `2–4+ giờ/ngày`**).
  - **Tỉ lệ gặp pain & sai sót vận hành:**
    - **`20/22 (90,9%)`** gặp khó khăn vì **Câu hỏi lặp lại** (giá, phòng trống, tiện nghi, phụ thu, giờ check-in); **`14/22 (63,6%)`** bị **Phản hồi chậm**; **`13/22 (59,1%)`** mất thời gian kiểm tra phòng và **`13/22 (59,1%)`** mất thời gian tính/báo giá.
    - **`20/22 (90,9%)`** thừa nhận đã **bỏ sót hoặc phản hồi chậm tin nhắn** ít nhất `1–10+ lần` trong 30 ngày gần nhất (`14/22` bị `1–5 lần`, `6/22` bị `6–10+ lần`).
    - **`19/22 (86,4%)`** từng **đặt trùng phòng hoặc báo nhầm phòng trống** (`1/22 = 4,5%` thường xuyên, `12/22 = 54,5%` thỉnh thoảng, `6/22 = 27,3%` hiếm khi) do phải cập nhật tay lên Excel/Sheet/Sổ tay sau khi khách cọc.
    - **`9/22 (40,9%)`** biết chắc chắn mình **đã từng mất khách do phản hồi chậm** (và `6/22 = 27,3%` không xác định được số khách đã âm thầm rời đi).
  - **Nhu cầu tự động hóa:** **`19/22 (86,4%)`** đánh giá công cụ hỗ trợ tư vấn & giữ phòng tự động là **`Rất cần` (`14/22 = 63,6%`)** hoặc **`Có thể cần` (`5/22 = 22,7%`)**; **`18/22 (81,8%)`** sẵn sàng tham gia thử nghiệm ngay.
- **Tổng hợp theo từng vai (đếm riêng theo quy tắc không cộng gộp hai vai):**

| Vai khảo sát                                         | Cỡ mẫu (`n`) | Tỉ lệ gặp pain chính                                                                                                               | Tần suất xảy ra                                                                               | Thời gian mất hiện tại                                                                                                                        | Đang xoay xở bằng                                                                                                                                       |
| ------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Khách thuê homestay** (`G01`–`G20`)     | `n = 20`       | **`16/20 (80%)`** gặp vấn đề khi hỏi/đặt phòng; **`8/20 (40%)`** từng bỏ cuộc giữa chừng                  | Thuê `2–6+ lần/năm` (`14/20`); mỗi lần nhắn hỏi `2–5 homestay` (`12/20`)        | Chờ phản hồi đầu `5–60+ phút` (`14/20`), trong đó `8/20 (40%)` chờ `15 phút – 4 giờ+`; `50%` phải hỏi lại nhiều lượt | Nhắn cùng lúc `2–5 nơi` để so giá; nhắn giục lại (`35%`), gọi điện (`20%`) hoặc bỏ sang chỗ khác rep nhanh hơn (`25%`)          |
| **Chủ / Quản lý homestay** (`H01`–`H22`) | `n = 22`       | **`20/22 (90,9%)`** quá tải câu hỏi lặp lại & trễ tin nhắn; **`19/22 (86,4%)`** từng báo nhầm/trùng phòng | `5–30+ cuộc hội thoại/ngày` (`18/22`); trễ/sót tin `1–10+ lần/tháng` (`20/22`) | **`1–4+ giờ/ngày`** (`19/22 = 86,4%`), trong đó `13/22 (59,1%)` mất `2–4+ giờ/ngày`                                        | Mở Sổ tay / Excel / Google Sheets tra tay (`21/22 = 95,5%`), dùng tin nhắn mẫu rồi tự cộng giá & cập nhật sheet bằng tay sau khi khách cọc |

## 3. ≥5 trích dẫn hoặc ví dụ nguyên văn (có nguồn, bỏ tên)

Dưới đây là **8 trích dẫn nguyên văn** từ phiếu khảo sát của cả Khách thuê (`G01`–`G20`) và Chủ homestay (`H01`–`H22`) trong [results.csv](survey/results.csv):

1. *"Thấy homestay trên TikTok, nhắn Messenger hỏi giá cuối tuần, đợi hơn 2 tiếng không ai rep nên qua chỗ khác, chỗ mới rep trong 5 phút là chốt luôn."* — **Phiếu khảo sát khách `G06`** (Câu 09 · Chờ `Trên 1–4 giờ`, từng bỏ đặt phòng)
2. *"Muốn biết giá cuối cùng và phòng còn trống ngay từ tin nhắn đầu tiên, khỏi hỏi đi hỏi lại."* — **Phiếu khảo sát khách `G03`** (Câu 19 · Chờ `5–15 phút`, phải hỏi lại nhiều lần mới chốt qua Zalo)
3. *"Cuối tuần rủ nhóm bạn đi homestay gần Hà Nội, tìm trên Facebook, nhắn 3 chỗ, chỗ rẻ nhất thì rep chậm, cuối cùng chốt chỗ rep nhanh nhất dù đắt hơn một chút. ... Báo giá trọn gói luôn cả phụ thu, đừng để đến lúc thanh toán mới cộng thêm."* — **Phiếu khảo sát khách `G13`** (Câu 09 & Câu 19 · Nhóm `3–5 người`)
4. *"Tìm homestay ở Đà Lạt, hỏi 5 chỗ để so giá, có chỗ báo giá rẻ nhưng đến lúc chốt lại cộng thêm phí dọn phòng và phí cuối tuần nên vượt ngân sách, đành bỏ."* — **Phiếu khảo sát khách `G14`** (Câu 09 · Chờ `Trên 15–60 phút`, từ bỏ vì báo giá không nhất quán)
5. *"Nhắn hỏi homestay ở Mộc Châu từ tối hôm trước, sáng hôm sau vẫn chưa thấy rep, gọi điện cũng không nghe máy nên đặt chỗ khác qua Booking luôn."* — **Phiếu khảo sát khách `G15`** (Câu 09 · Khó liên hệ ngoài giờ / không nhận được phản hồi)
6. *"Thường đặt qua Airbnb vì có bảo vệ thanh toán, có lần thử nhắn homestay qua web nhưng chatbot trả lời chung chung nên bỏ, quay lại đặt trên nền tảng. ... Trả lời đúng câu hỏi của khách, đừng trả lời chung chung như máy."* — **Phiếu khảo sát khách `G18`** (Câu 09 & Câu 19 · Từng bỏ chatbot kịch bản cứng vì không giải quyết được câu hỏi cụ thể)
7. *"mình phải vào sheet xem còn phòng không, hiện trạng như nào rồi mới báo cho khách được ... mình phải tự lên sheet cập nhật bằng tay"* — **Phiếu khảo sát chủ hộ `H01`** (Câu 12 & Câu 17 · Chủ homestay tại Hà Giang, quy mô `6–10 phòng`, mất `2–4 giờ/ngày` trả lời khách)
8. *"Kiểm tra trên website và sheet rồi báo khách ... Nhắn vào nhóm Zalo nội bộ để mọi người cùng biết"* — **Phiếu khảo sát chủ hộ `H08`** (Câu 12 & Câu 17 · Chủ homestay tại Đà Nẵng, quy mô `6–10 phòng`, trễ/sót tin `6–10 lần/tháng`, từng mất khách do phản hồi chậm)

## 4. Các nguồn có khớp nhau không

Khảo sát hai phía (**Khách thuê `n = 20`** và **Chủ homestay `n = 22`**) cộng hưởng và giải thích trực tiếp nguyên nhân – hệ quả của nhau:

- **Khách thuê nói:** `75%` (`15/20`) chỉ chấp nhận chờ tối đa dưới 30 phút (trong đó `35%` chỉ chờ tối đa `5–15 phút`), nên họ thường nhắn hỏi `2–5 homestay` cùng lúc (`60%`). Tuy nhiên, `50%` khách nhắn tin không nhận đủ thông tin phòng trống và tổng giá ngay ở lượt đầu, phải hỏi đi hỏi lại về phụ thu cuối tuần/thêm người, dẫn tới `40%` (`8/20`) đã bỏ cuộc chuyển sang homestay khác trả lời nhanh hơn.
- **Chủ homestay nói:** `95,5%` (`21/22`) đang quản lý lịch bằng Sổ tay, Excel hoặc Google Sheets phân tán với OTA (Booking, Agoda, Airbnb). Mỗi khi khách nhắn hỏi, chủ hoặc nhân viên phải mở file Excel/Sheet đối chiếu lịch trống, tự nhẩm tính giá theo loại phòng + số khách + phụ thu cuối tuần/lễ (`15/22 = 68,2%` tính giá theo cuối tuần/lễ và số khách), rồi mới nhắn lại. Khi khách nhắn vào buổi tối hoặc lúc chủ đang bận (`20/22 = 90,9%` bị sót/chậm tin nhắn), toàn bộ luồng bị nghẽn.
- **Điểm khớp hoàn toàn:**
  1. **Nút thắt cổ chai nằm ở khâu "Tra lịch + Tính tổng giá kèm phụ thu":** Khách phàn nàn *"không rõ giá/phụ thu, phải hỏi lại nhiều lần"* (`35%`), khớp hoàn toàn với việc `59,1%` chủ nhà thừa nhận *"mất thời gian kiểm tra phòng"* và *"mất thời gian báo giá"* từ bảng Excel.
  2. **Nỗi sợ "báo sai giá / sai phòng trống":** Đây là nỗi lo số 1 của cả hai phía khi dùng AI — `14/20 (70%)` khách thuê lo bot *báo sai giá* hoặc *báo sai phòng trống*, và `19/22 (86,4%)` chủ nhà cũng lo ngại đúng 2 điểm này. Điều này chứng minh thiết kế của nhóm (**tuyệt đối không để LLM tự nhẩm giá hay tự đoán lịch mà bắt buộc gọi deterministic tools + kiểm khóa Postgres `btree_gist` exclusion constraint**) là hoàn toàn trúng đích.
- **Điểm lệch / phát hiện mới rất đáng chú ý:**
  - Ban đầu nhóm chỉ nghĩ khách bỏ đi vì *chờ lâu*. Khảo sát chỉ ra thêm **2 lý do sống còn khác**: (1) **Chi phí ẩn lúc chốt** (`G13`, `G14`: ban đầu báo giá gốc rẻ, lúc chốt mới cộng phụ thu cuối tuần/thêm người làm vỡ ngân sách) và (2) **Chatbot trả lời máy móc chung chung + đòi cọc 100% thiếu minh bạch** (`G11`, `G18`). Khách chỉ tin tưởng xuống tiền khi thấy **bảng tóm tắt minh bạch toàn bộ phụ thu, mức cọc hợp lý (30%) và có cơ chế chuyển người thật (`handoff_to_human`) bất cứ lúc nào**.

## 5. Kết luận

- Giả thuyết ở [evidence/hypothesis.md](hypothesis.md): **ĐÚNG và ĐƯỢC MỞ RỘNG** — vì:
  1. Dữ liệu thực tế từ `42` người dùng thật (`20` khách, `22` chủ) xác nhận việc tra lịch trên Excel/Sổ tay (`95,5%` chủ hộ) khiến khách phải chờ đợi hoặc hỏi lại nhiều lượt (`50%` không đủ thông tin ở lượt đầu; `40%` từng bỏ đặt phòng vì quá trình tư vấn chậm/mơ hồ; `40,9%` chủ hộ xác nhận đã mất khách vì phản hồi chậm).
  2. Mở rộng quan trọng cho thiết kế sản phẩm: Giải pháp không chỉ cần **phản hồi tức thì (< 10 giây)** mà bắt buộc phải **báo giá trọn gói chính xác 100% (gồm cả phụ thu cuối tuần +20%, phụ thu khách thêm, tiền cọc 30%) ngay từ đầu**, giữ chỗ tạm thời 15 phút chống đặt trùng, và **chuyển chủ nhà (`handoff_to_human`)** ngay khi khách cần thương lượng hoặc có yêu cầu đặc biệt.
- **Điều vẫn chưa biết (cần đo tiếp khi vận hành thật):** Tỉ lệ chuyển đổi thực tế từ bước *Nhận bản tóm tắt & thẻ cọc MoMo 30%* sang *Hoàn tất thanh toán cọc thành công trong 15 phút* trên tệp khách vãng lai ban đêm là bao nhiêu phần trăm.

## Lịch thu thập bằng chứng (CP2 / CP3 — chỉ ghi vai và giờ, không tên)

| Vai                                                                 | Thời điểm thu thập            | Đã xong?                                           |
| ------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `20` Khách thuê homestay (`G01`–`G20`, ngoài nhóm)       | Ngày 27/11/2026 (15:16 – 17:38) | ☑ Đã xong (`evidence/survey/guest_results.csv`) |
| `22` Chủ & Quản lý homestay (`H01`–`H22`, 5 tỉnh/thành) | Ngày 27/11/2026 (14:32 – 14:47) | ☑ Đã xong (`evidence/survey/host_results.csv`)  |
