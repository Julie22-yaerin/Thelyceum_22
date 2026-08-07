# The Lyceum — Báo cáo Benchmark & Breakdown Kỹ thuật

**Chuẩn bị cho:** Khách hàng đánh giá trước khi mua source code
**Ngày:** 06/08/2026
**Phạm vi:** 4 package trong monorepo — `thrift`, `brake`, `redteam`, `server`
**Loại kiểm thử:** Empirical — chạy thật trên máy local (`npm test`) và trên GitHub Actions cloud runner thật (x64 + arm64), không phải số liệu mô phỏng

---

## 1. Tóm tắt điều hành

The Lyceum là bộ ba circuit breaker cho AI agent — `brake` (chặn hành vi nguy hiểm), `redteam` (chặn kết luận một chiều/code có rủi ro), `thrift` (nén context, khử trùng lặp token) — cộng một lớp hạ tầng vận hành (`server`, dùng nếu chọn mô hình SaaS/subscription).

| Package | Vai trò | Test Pass | Throughput (cloud, x64) | Floor gate |
| :--- | :--- | :---: | :--- | :--- |
| `brake` | Circuit breaker khẩn cấp | 39/39 | 1.45M calls/sec | 200k (7.3× floor) |
| `redteam` | Phát hiện lỗi lập luận & code | 54/54 | 295.3k calls/sec | 100k (2.9× floor) |
| `thrift` | Nén context, khử trùng lặp token | 72/72 | 47.5k calls/sec | 8k (5.9× floor) |
| `server` | Telemetry, license, beta trial, usage | 109/109 | — | — |
| **Tổng** | **Toàn bộ monorepo** | **274/274** | | |

Toàn bộ 274 test pass 100%, đo tại `2026-08-06`. Số liệu throughput lấy từ lần chạy CI thành công gần nhất trên GitHub Actions cloud runner thật (không phải máy dev), cả x64 lẫn arm64 — dẫn nguồn cụ thể ở mục 5.

---

## 2. Phương pháp đo

- **Test suite:** `npm test --workspace brake --workspace redteam --workspace thrift --workspace @lyceum/server` — Vitest v3.2.7, chạy trực tiếp trên máy đang chuẩn bị gói beta này ngay trước khi viết báo cáo.
- **Throughput/latency:** `scripts/benchmark.mjs` — best-of-N trên corpus cố định, chạy qua GitHub Actions CI (`.github/workflows/throughput.yml`) trên **cả `ubuntu-latest` (x64) và `ubuntu-24.04-arm` (arm64)**, không phải máy dev cá nhân. CI fail cứng (exit 1) nếu bất kỳ số nào tụt dưới floor đã định — nghĩa là các con số dưới đây không thể "âm thầm thối" theo thời gian mà không ai biết.
- **MCP wire latency:** đo handshake `initialize → tools/list` qua stdio thật, dùng chính MCP SDK client, không mock transport.
- **`brake`/`redteam` là tính toán cục bộ thuần túy** (regex + heuristic trên chuỗi văn bản) — không gọi mạng, không gọi LLM API nào. Đây là lý do chúng an toàn để chạy trên *mọi* tool call thay vì lấy mẫu, và cũng là lý do benchmark của chúng không cần (và không có) bất kỳ API key ngoài nào.

---

## 3. Breakdown theo package

### 3.1 `brake` — Circuit breaker khẩn cấp

Quét ý định của agent trước khi hành động chạy, dừng khẩn cấp nếu khớp một trong các lớp nguy hiểm. Bộ rule hiện tại phủ **11 lớp nguy hiểm** (21 rule cụ thể): `prompt_injection`, `remote_code_execution`, `credential_access`, `data_exfiltration`, `destructive_operation`, `financial_movement`, `impersonation`, `infrastructure_attack`, `pii_leak`, `sandbox_escape`, `unauthorized_cloud_access`.

| Chỉ số | Giá trị (cloud x64) | Giá trị (cloud arm64) | Floor CI |
|---|---|---|---|
| Throughput | 1.45M calls/sec | 1.36M calls/sec | 200k |
| Latency p50 | 0.80µs | 0.86µs | — |
| Latency p95 | 1.59µs | 1.08µs | gate 1000ms |
| Latency p99 | 1.92µs | 1.16µs | — |

SLA mục tiêu cho việc dừng khẩn cấp là 1000ms — thực đo dưới 2 micro-giây, nhanh hơn mục tiêu khoảng 500,000 lần vì đây là tính toán cục bộ thuần túy, không round-trip mạng.

### 3.2 `redteam` — Phát hiện lỗi lập luận & code

Chặn kết luận nghe tự tin nhưng một chiều, hoặc code có nguy cơ crash/rò rỉ, trước khi nó được trình bày như sự thật. Phủ **21 lớp lỗi**: 9 lỗi lập luận (overconfidence, confirmation bias, false dichotomy, missing tradeoff, strawman, anecdote-as-evidence, slippery slope, unchecked assumption, security bypass), 2 lỗi vòng lặp đa-agent (`context_drift`, `ping_pong_loop`), và 10 lỗi code (crash chắc chắn, async không xử lý, null pointer, type safety, resource leak, malicious payload, infinite loop, hallucinated package, v.v.).

| Chỉ số | Giá trị (cloud x64) | Giá trị (cloud arm64) | Floor CI |
|---|---|---|---|
| Throughput | 295.3k calls/sec | 262.9k calls/sec | 100k |
| Latency p50 | 3.07µs | 3.76µs | — |
| Latency p95 | 4.33µs | 4.96µs | gate 1000ms |
| Latency p99 | 7.05µs | 5.44µs | — |

Có cơ chế loại trừ false positive: code comment (`// Note: rm -rf...`) được nhận diện là tài liệu, không bị chặn nhầm.

### 3.3 `thrift` — Nén context & khử trùng lặp token

Bài toán: agent đọc lại file/log/output dài lặp lại trong một phiên, đốt token vô ích. `thrift` chặn việc này ở đúng thời điểm dữ liệu được trả về, trước khi vào context — bốn cơ chế: dedupe (đọc lại → trả pointer), strip (bỏ noise: mã ANSI, log lặp, base64 blob), slice (cắt theo query khi file lớn, có đánh dấu rõ phần bị cắt), cap (ngân sách cứng, hard-data-aware — dữ liệu code/config/limit không bao giờ bị cắt, chỉ prose mới bị nén).

| Chỉ số | Giá trị (cloud x64) | Giá trị (cloud arm64) | Floor CI |
|---|---|---|---|
| Throughput | 47.5k calls/sec | 53.0k calls/sec | 8k |
| Latency p50 | 16.63µs | 18.04µs | — |
| Latency p95 | 51.40µs | 36.25µs | gate 10ms |
| Latency p99 | 55.29µs | 42.16µs | — |
| Agent-loop saving (12 file × 5 pass) | **87.2%** saved, 39.6% trong đó lossless | | |
| Token-guard edge case | JWT: 0% saved (giữ nguyên byte, không cắt) ✓ · image base64: 97.8% ✓ · JSON response: 95.6% ✓ | | |

Token-guard edge case là bộ test cố ý thử "phá": một JWT không bao giờ được cắt dù chỉ 1 ký tự (0% saved đúng là kỳ vọng — nghĩa là dữ liệu cứng được bảo toàn tuyệt đối), trong khi ảnh base64 và JSON response dài được nén sâu.

### 3.4 `server` — Hạ tầng vận hành (nếu chọn mô hình SaaS)

109/109 test pass: telemetry multi-tenant, license, usage metering, và **cơ chế beta-trial mới** (xem mục 4).

---

## 4. Mới: Beta trial gate (server-validated)

Bổ sung hôm nay, phục vụ đúng gói beta gửi kèm báo cáo này — license 7 ngày, tối đa 10 lần gọi thực/ngày (UTC), enforce từ phía server (không phải giới hạn client có thể chỉnh sửa). Đã test:

- 14 unit test (`beta.test.ts`) + 5 integration test qua HTTP thật (`beta-routes.test.ts`) — bao gồm test đua 20 request đồng thời trên hạn mức 5/ngày, xác nhận đúng 5 request pass, không có race condition.
- Test tay end-to-end trên cả 3 CLI thật (`brake`/`redteam`/`thrift`): 3 lần đầu pass, lần 4 bị chặn đúng lúc với message rõ ràng; lệnh `status` không tính vào hạn mức.
- Gói **BYOC** (Bring-Your-Own-Cloud) đi kèm: license server tự host, zero dependency ngoài Node.js builtin, dữ liệu dùng thử không rời khỏi hạ tầng của bên vận hành server.

---

## 5. Nguồn dẫn — đối chiếu độc lập

- **Test suite:** chạy `npm test --workspace brake --workspace redteam --workspace thrift --workspace @lyceum/server` từ gốc repo.
- **Benchmark cloud:** GitHub Actions run công khai (nếu có quyền truy cập repo) — workflow `throughput-benchmarks`, job `benchmark (ubuntu-latest)` và `benchmark (ubuntu-24.04-arm)`. Artifact `benchmark-results.json` được đính kèm mỗi lần chạy.
- **Không có claim nào trong báo cáo này dựa trên lệnh gọi LLM API bên ngoài** (OpenRouter hay tương đương) — `brake`/`redteam` không cần và không gọi bất kỳ API LLM nào để hoạt động, đúng với kiến trúc "zero network call trên hot path" của toàn bộ sản phẩm.

---

## 6. Gói Beta Test gửi kèm

Hai gói:

1. **CLI package** — bản build/dist đã đóng gói của `thrift`, `brake`, `redteam` (không kèm mã nguồn TypeScript gốc) + `beta-activate.mjs`. Chi tiết cài đặt và lệnh test mẫu trong `QUICKSTART-beta-test.md`.
2. **BYOC beta server** — license server tự host cho đợt beta, đi kèm README riêng.

Sau khi khách xác nhận hài lòng với bản beta, quy trình chuyển giao source code đầy đủ (TypeScript, test suite, tài liệu kiến trúc) được xử lý riêng theo hợp đồng.
