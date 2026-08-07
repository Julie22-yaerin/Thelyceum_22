# The Lyceum — Beta Test Quickstart

Gói này chứa bản **build sẵn** (`dist/`) của ba công cụ — `thrift`, `brake`, `redteam` — không kèm mã nguồn TypeScript. Bạn có thể cài và chạy thử ngay trên máy để đánh giá chức năng trước khi quyết định mua source code.

**Yêu cầu:** Node.js ≥ 22.5.0 (`node -v` để kiểm tra).

**Thời hạn dùng thử:** 7 ngày kể từ lúc kích hoạt key bên dưới, tối đa 10 lần gọi thực (scan/challenge/compress) mỗi ngày UTC trên cả ba công cụ cộng lại. Giới hạn này được xác thực bởi server của chúng tôi ở mỗi lần gọi — không phải giới hạn phía client có thể chỉnh sửa được. Các lệnh xem trạng thái/báo cáo (`status`, `report`, `rules`) không tính vào giới hạn.

---

## 0. Kích hoạt beta key

```bash
node beta-activate.mjs LYCEUM-BETA-xxxxxxxx...   # key được gửi kèm email riêng
```

Chỉ cần chạy một lần — cả ba công cụ đều đọc chung key này.

**Quan trọng — trỏ đúng server:** key này được xác thực bởi một license
server (BYOC, tự host trên hạ tầng của chúng tôi cho đợt beta). Trước khi
chạy `scan`/`challenge`/`compress` lần đầu, set biến môi trường này (địa
chỉ cụ thể gửi kèm email cùng key):

```bash
export LYCEUM_SERVER_URL=http://<địa-chỉ-server-được-cấp>
```

Thiếu bước này, công cụ sẽ tự động thử gọi server mặc định (chưa sẵn sàng
cho đợt beta) và mọi lệnh sẽ báo lỗi ngay từ lần đầu — không phải do key sai.

---

## 1. Cài đặt

Mỗi công cụ là một file `.tgz` (npm package tarball). Cài từng cái:

```bash
npm install -g ./thrift-1.0.0.tgz
npm install -g ./brake-1.0.0.tgz
npm install -g ./redteam-1.0.0.tgz
```

Kiểm tra đã cài đúng:

```bash
thrift --version
brake --version
redteam --version
```

---

## 2. Test `brake` — chặn hành vi nguy hiểm

```bash
# Quét một câu lệnh nguy hiểm — sẽ bị chặn (exit code 1)
brake scan "rm -rf /var/db/production_data"

# Quét một câu lệnh bình thường — sẽ pass
brake scan "ls -la ./src"

# Xem log các lần brake đã can thiệp
brake status
```

Kỳ vọng: lệnh nguy hiểm bị chặn với thông báo rõ loại nguy hiểm (`destructive_operation`, `remote_code_execution`, `credential_access`...), độ trễ dưới 3ms.

---

## 3. Test `redteam` — phát hiện lập luận một chiều

```bash
# Một câu khẳng định quá tự tin — sẽ bị BLOCK
redteam challenge "Giải pháp này hoàn hảo, không có rủi ro gì cả, chắc chắn 100%."

# Một câu lập luận cân bằng hơn — sẽ pass
redteam challenge "Giải pháp này giải quyết được vấn đề X nhưng đánh đổi bằng Y."

# Xem 9 lớp lỗi lập luận được quét
redteam rules
```

Kỳ vọng: câu one-sided bị gắn cờ với lý do cụ thể (`confirmation_bias`, `overconfidence`...) và đề xuất phản biện.

---

## 4. Test `thrift` — nén context / khử trùng lặp

```bash
# Nén một file log dài
thrift compress ./path/to/big-log.txt

# Đọc cùng một file lần 2 trong cùng phiên — lần này sẽ chỉ trả về pointer
thrift read ./path/to/big-log.txt
thrift read ./path/to/big-log.txt

# Xem báo cáo token đã tiết kiệm được thực tế trong phiên này
thrift report
```

Kỳ vọng: lần đọc thứ hai của cùng một file trả về gần như tức thì với payload rất nhỏ, không phải toàn bộ nội dung.

---

## 5. Cách dùng thật: gắn vào Claude Desktop / Claude Code / ChatGPT

Cả ba tool đều có lệnh cài tự động vào AI host, để agent tự gọi công cụ mà không cần user gõ lệnh thủ công:

```bash
brake install all
redteam install all
```

Sau bước này, `brake` và `redteam` sẽ tự động được model gọi khi nó chuẩn bị chạy hành động nguy hiểm hoặc trình bày một kết luận một chiều — đúng như cách chúng vận hành trong production.

---

## 6. Nếu có thắc mắc trong lúc test

Đối chiếu số liệu benchmark gốc trong `Lyceum-Benchmark-Report.md` đi kèm gói này. Mọi câu hỏi về hành vi cụ thể của từng rule, xin liên hệ trực tiếp để được giải thích logic đứng sau (không lộ source, chỉ giải thích hành vi).
