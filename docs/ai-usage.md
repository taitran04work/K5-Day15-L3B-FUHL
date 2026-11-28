# Khai báo dùng AI

README của nhóm có mục "Dùng AI vào việc gì" (2–3 dòng, bắt buộc). Ghi chi tiết vào bảng dưới đây.

> Luật của đề: dùng AI để làm bài thoải mái, nhưng **ai không giải thích được phần có tên mình thì phần đó nhận 0 điểm**. Khai thiếu không bị trừ; giấu mới bị.

| Việc | Công cụ AI | AI làm gì | Người kiểm/sửa gì | Ai phụ trách |
|---|---|---|---|---|
| Code bản chạy thử | Claude Code, Antigravity | Hỗ trợ dựng khung web Stayra (.NET/React), tích hợp Zalo, vòng lặp `MAX_STEPS = 5` trong `codebase/agent.py`, 7 hàm `@tool` trong `codebase/tools.py` và script quay video demo | Kiểm tra hợp đồng `call_model`/`answer`, chỉnh logic tính giá (+20% cuối tuần, Tết, cọc 30%), rà khóa chống đặt trùng Postgres và chạy thử thật với `ANTHROPIC_API_KEY` | Trần Hữu Tài, Nguyễn Thành Công, Nguyễn Ngọc Bách |
| Prompt / thiết kế lời gọi mô hình | Claude Code, Antigravity | Soạn khung system prompt cho `concierge.md` và `SYSTEM` trong `codebase/agent.py`; đề xuất chỉnh sửa rule xử lý thuê theo giờ & tạo bản nháp sau `run-1` | Rà các rule chống bịa giá, bắt buộc xác thực `code + phone`, giữ bước khách xác nhận trước khi chốt, chạy lại `run-2` kiểm tra | Nguyễn Thành Công, Trần Hữu Tài |
| Đào data (viết script đếm, gợi ý nhãn) | Antigravity | Viết script `evidence/count.py` và tổng hợp bảng `x/N (%)` sang `evidence/data-mining.md`, `evidence/summary.md` | Kiểm tay 20 phiếu khách + 22 phiếu chủ (khớp 42/42 dòng), chạy lại `python evidence/count.py` kiểm chứng tách riêng mẫu số hai vai | Đồng Văn Quyến, Trần Hữu Tài |
| Rà câu hỏi phỏng vấn / khảo sát | ChatGPT, Antigravity | Chỉ rà câu dẫn dắt và độ rõ ràng của câu hỏi khảo sát trước khi gửi | Nhóm tự hoàn thiện 63 cột câu hỏi trong `evidence/survey/questions.md` và tự thu thập 42 phiếu thật từ khách thuê & chủ homestay ngoài nhóm | Đồng Văn Quyến |
| Viết câu thử (benchmark) | Antigravity | Gợi ý nhóm câu `kho` và câu tấn công `tu_choi` (`B13`–`B24`) bám theo 4 lớp chỗ khó ở `spec.md` §5 | Gắn đủ `source` (`9/24 data_that`, `15/24 tu_viet`), viết `expected` & `pass_criterion`, kiểm hợp lệ bằng `python run.py check` | Trần Hữu Tài, Nguyễn Thành Công |
| Sinh data `synthetic` (nếu có) | Claude Code, Antigravity | Hỗ trợ sinh dữ liệu seed cho Pine Hill & Sea Breeze (`DatabaseSetup.cs`, `SeedPdf.cs`) và trích sang `data/homestay_data.json` | Seed `2` homestay, `10` phòng (6 Pine Hill + 4 Sea Breeze), `3` đơn mẫu ẩn danh; kiểm tay toàn bộ giá phòng, nội quy `CS-01..07` và `data/DATA_CARD.md` | Trần Hữu Tài |
| Chấm cột `pass` bằng LLM (nếu có) | Không dùng | Không dùng LLM để tự chấm cột `pass` | Kiểm tra thủ công toàn bộ `24/24` câu ở cả `eval/run-1.csv` và `eval/run-2.csv` theo `eval/metric_spec.yaml`, tính điểm bằng `python run.py score` | Trần Hữu Tài, Đồng Văn Quyến |
| Slide, văn bản | Antigravity | Tổng hợp số liệu sang `spec.md`, `cost/cost-estimate.md`, dựng HTML/PDF cho `demo-slides.pdf` (8 trang) và quay + lồng tiếng video `docs/demo-ai-30s.mp4` | Đối chiếu từng con số trên slide với `evidence/summary.md`, `eval/report.md`, `cost/simulate-1-summary.md`; rà PDF 8 trang, video dự phòng và tải lên Google Drive | Đồng Văn Quyến, Trần Hữu Tài, Nguyễn Ngọc Bách |

**Không dùng AI để:** tạo người được phỏng vấn, trích dẫn, câu trả lời khảo sát; sửa kết quả các lượt đã chạy (`eval/run-*.csv`, `cost/simulate-*.csv`, `traces/`).
