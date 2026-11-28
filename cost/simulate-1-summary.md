# Tóm tắt mô phỏng simulate-1@20261128-124020

Do `python run.py simulate` sinh ra — không sửa tay. Chép bảng sang `cost/cost-estimate.md`.

| Persona | Số phiên mô phỏng | Lượt hỏi / phiên | Token vào / phiên | Token ra / phiên | Gọi model / phiên | Gọi công cụ / phiên |
|---|---:|---:|---:|---:|---:|---:|
| dung_it | 21 | 1 | 5738 | 555 | 2.0 | 1.0 |
| dung_vua | 21 | 2 | 11568 | 1406 | 4.0 | 2.2 |
| dung_nhieu | 8 | 3 | 17906 | 1766 | 6.2 | 3.6 |

Tỉ lệ đạt dùng để tính: 23/24 (96%) — lượt run-2@20261127-174553

- Tỉ lệ đạt lấy từ lượt nhóm chọn: eval/run-2.csv (--rate-from).

| Model (giá) | Chi phí / phiên | Chi phí / task thành công | Chi phí / câu hỏi đạt | Chi phí / tháng — thấp (150 người) | Chi phí / tháng — cơ sở (300 người) | Chi phí / tháng — cao (750 người) | Chi phí / người / tháng (cơ sở) |
|---|---:|---:|---:|---:|---:|---:|---:|
| claude-haiku-5-5 (vào 0.1 · ra 0.5 $/1M) | $0.0016 (≈ 41 ₫) | $0.0016 (≈ 43 ₫) | $0.00094 (≈ 24 ₫) | $0.2818 (≈ 7.335 ₫) | $0.5636 (≈ 14.671 ₫) | $1.41 (≈ 36.676 ₫) | $0.0019 (≈ 49 ₫) |
| claude-sonnet-5-5 (vào 2.0 · ra 10.0 $/1M) | $0.0313 (≈ 816 ₫) | $0.0327 (≈ 851 ₫) | $0.0188 (≈ 489 ₫) | $5.64 (≈ 146.706 ₫) | $11.27 (≈ 293.412 ₫) | $28.18 (≈ 733.530 ₫) | $0.0376 (≈ 978 ₫) |

- Chi phí / task thành công = chi phí / phiên ÷ tỉ lệ đạt. Chi phí / câu hỏi đạt = chi phí / phiên ÷ số lượt hỏi trung bình mỗi phiên (1.7) ÷ tỉ lệ đạt — tỉ lệ đạt đo theo từng câu thử.
- Token đo trên model: claude-haiku-5-5. Giá tính theo từng model trong bảng — model khác bộ tách token thì số token thật có thể lệch; ghi rõ "đo trên model X, tính giá model Y" trong cost/cost-estimate.md.
- Phiên lỗi (không tính vào trung bình): 0/50.
- Tỷ giá: 1 USD = 26.030 ₫ (https://www.vietcombank.com.vn (tỷ giá bán USD/VND Vietcombank, 27/11/2026)).
