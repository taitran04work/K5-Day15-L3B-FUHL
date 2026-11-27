# Deplao T123

Deplao T123 là cổng web vận hành kết nối đa kênh cho P-123. Ứng dụng giữ phiên
đăng nhập Zalo, Facebook và Telegram, cung cấp giao diện operator, API, webhook
và hàng đợi gửi tin. P-123 chỉ cần truy cập URL và API key.

## Kiến trúc

Operator → Deplao T123 → Zalo / Facebook / Telegram

P-123 → Deplao T123 API

P-123 ← webhook có chữ ký ← Deplao T123

Repo này và repo P-123 là hai repo độc lập. Không cần triển khai CGW, node-agent
hoặc forwarder riêng. Deplao chạy Electron headless trên VPS, người dùng làm
việc qua trình duyệt.

## Phạm vi

Bản web tập trung vào account đa kênh, chat kiểm tra, API key, webhook, delivery
queue, nhật ký và trang hàng đợi tại /operations.

CRM, ERP/POS, workflow, AI assistant, marketing và plugin không được khởi động
trong profile web DEPLAO_CHANNELS_ONLY=1.

## Cài đặt, cấu hình và chạy

Local và VPS dùng cùng một quy trình. Khác biệt của VPS chỉ nằm ở môi trường
Electron headless, systemd và proxy/domain.

Yêu cầu Node.js 22.12+, npm và môi trường chạy được Electron.

    npm ci
    npm run rebuild:native
    cp .env.example .env
    chmod 600 .env

File .env.example là mẫu tối thiểu:

    NODE_ENV=development
    DEPLAO_WEB=1
    DEPLAO_CHANNELS_ONLY=1
    DEPLAO_WEB_PASSWORD=mat-khau-local-dai-hon-12-ky-tu
    DEPLAO_WEB_PORT=27800
    DEPLAO_WEB_SECURE=0

Không commit .env, API key, cookie, secret webhook hoặc profile đăng nhập.

Khởi động ở local:

    npm run web

Khởi động lại khi source không đổi:

    npm run start:web

Mở các địa chỉ:

    http://127.0.0.1:27800/
    http://127.0.0.1:27800/operations
    http://127.0.0.1:27800/api/v1

Dùng 127.0.0.1 thay cho localhost vì gateway kiểm tra Host. Cấu hình tự đọc từ
.env; biến đã có trong shell được ưu tiên. Linux không có display cần Xvfb.
Facebook E2EE cần npm run build:bridge-e2ee.

## Kiểm tra với P-123

P-123 tự quản kết nối: API key và secret webhook lưu mã hoá trong DB của P-123,
P-123 tự tạo webhook của nó. Không chép key vào .env, không tạo webhook tay.

1. Tạo API key (thẻ API → API key → Tạo API key):
   - Quyền: accounts:read, chat:read, chat:send, contacts:read, webhooks:manage.
   - Tài khoản được dùng: Tất cả tài khoản. Deplao này chỉ chứa nick của P-123,
     nick đăng nhập sau tự dùng được.
2. .env của P-123 chỉ cần:

       DEPLAO_BASE_URL=http://127.0.0.1:27800/api/v1
       INTERNAL_API_TOKEN=chuoi-ngau-nhien

3. Gửi key cho P-123 (PUT /internal/deplao/connection, header X-Internal-Token,
   body api_key + webhook_url). P-123 kiểm key, tạo webhook tên Porter
   (message.received, group.event, group.updated, mọi nick) và dùng ngay.

Hướng dẫn từng bước và lệnh mẫu: docs/setup_deplao_t123.md của repo P-123.

Webhook URL phải là địa chỉ Deplao truy cập được. Nếu P-123 chạy trong Docker,
WSL hoặc máy khác, localhost không tự chia sẻ; Deplao chặn URL nội bộ trừ khi
bật api_allow_private_urls.

## Bổ sung khi chạy trên VPS

Clone repo tại /opt/deplao-builder-t123. VPS cần thêm Xvfb, git và user riêng,
ví dụ deplao. Sau các bước cài đặt chung ở trên, đổi .env sang production:

    NODE_ENV=production
    DEPLAO_WEB=1
    DEPLAO_CHANNELS_ONLY=1
    DEPLAO_WEB_PASSWORD=mat-khau-production-rieng
    DEPLAO_WEB_PORT=27800
    DEPLAO_WEB_ORIGIN=https://channels.example.com
    DEPLAO_WEB_SECURE=1

Chạy thủ công trên Linux:

    xvfb-run -a npm run start:web

Để tự khởi động sau reboot, dùng deploy/deplao-web.service. Ứng dụng chỉ mở
HTTP tại 127.0.0.1:27800. Proxy hoặc tunnel của bạn trỏ domain HTTPS vào port
này; Nginx không phải yêu cầu. Proxy cần giữ SSE và hỗ trợ upload tối đa 64 MB.

## Quy trình operator

1. Mở domain và đăng nhập bằng mật khẩu web.
2. Thêm account và hoàn tất bước xác thực.
3. Bật API, tạo key cho P-123 như mục "Kiểm tra với P-123" và gửi key cho P-123.
4. Theo dõi webhook Porter và delivery trong giao diện.
5. Đổi quyền hoặc tài khoản của key: bấm Sửa ở key, key giữ nguyên nên P-123
   không phải đổi gì. Sửa webhook (tên, URL, sự kiện, tài khoản): bấm Sửa ở
   webhook, secret giữ nguyên. Webhook Porter do P-123 quản, P-123 tự đặt lại
   sự kiện khi khởi động.

Cookie web chỉ dùng cho operator. P-123 luôn dùng Authorization Bearer API key.

## API chính cho P-123

Base URL là https://channels.example.com/api/v1.

- GET /accounts (accounts:read): danh sách account và trạng thái.
- POST /deliveries (chat:send): ghi lệnh gửi vào hàng đợi.
- GET /deliveries, GET /deliveries/{outbound_id} (chat:send): tra delivery.
- GET /accounts/{id}/groups/{gid}, .../members (chat:read): thông tin và thành
  viên nhóm.
- GET /accounts/{id}/users/{uid}, /accounts/{id}/users/lookup?phone=
  (contacts:read): hồ sơ người dùng, tra theo số điện thoại.
- GET/POST/PATCH/DELETE /webhooks (webhooks:manage): P-123 tự quản webhook.
- GET /docs: tài liệu API.

Body gửi gồm outbound_id, account_id, conversation_id, text và thread_type.
Giữ nguyên outbound_id khi retry. PENDING là đã lưu; SENT là nền tảng đã nhận
lệnh; FAILED có thể retry; UNKNOWN cần đối chiếu trước khi gửi lại.

## CI/CD

CI chạy khi mở PR hoặc push main: cài dependency, rebuild native module, test,
kiểm tra TypeScript và build web/Electron.

CD chạy khi push main hoặc thủ công: SSH vào VPS, lấy đúng commit đã kiểm tra,
build, giữ nguyên .env/profile/SQLite/media, restart deplao-web và health-check.

Tạo GitHub Environment production với:

    VPS_HOST
    VPS_USER
    VPS_PORT
    VPS_SSH_KEY
    VPS_KNOWN_HOSTS

Chi tiết nằm trong .github/workflows và thư mục deploy.

## Kiểm thử và xử lý sự cố

    npm run build:electron
    npm run build:web
    npm run test:web
    npm run test:delivery

Web 403: kiểm tra Host proxy và DEPLAO_WEB_ORIGIN.
API 401/403: kiểm tra key, scope và account.
Delivery PENDING lâu: kiểm tra account online và service.
Webhook lỗi: kiểm tra URL, secret và log P-123.
Service không lên: xem journalctl, Xvfb và native module.

Backup profile/workspace của user deplao khi bảo trì; dữ liệu gồm phiên đăng nhập,
SQLite và media.
