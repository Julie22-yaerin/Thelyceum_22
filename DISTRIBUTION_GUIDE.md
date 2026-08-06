# Quản Lý & Đóng Gói Sản Phẩm (Lyceum Package Structure & Distribution Guide)

Tài liệu hướng dẫn phân loại và đóng gói sản phẩm cho bản **Dùng Thử (Beta Trial)** và **Bán Thương Mại (Commercial Release)**.

---

## 1. Phân Loại Gói Sản Phẩm Ở Local

| Phân loại | Gói sản phẩm bao gồm | Hình thức đóng gói | Mục đích sử dụng |
|---|---|---|---|
| **Bản Dùng Thử (Beta Trial)** | `@lyceum/brake`<br>`@lyceum/redteam`<br>`@lyceum/thrift` (Savier) | Chỉ chứa **mã biên dịch (`dist/`)**, `package.json`, `skills/`. **KHÔNG kèm bất kỳ mã nguồn `.ts` hay test cases nào**. | Gửi khách hàng/doanh nghiệp thử nghiệm (Replit, Enterprise clients). Tự động nén thành file zip `lyceum-beta-trial-v1.0.0.zip`. |
| **Bản Thương Mại (Commercial Release)** | Đầy đủ monorepo (`brake`, `redteam`, `thrift`, `session-guard`, `server`, `lyceum-core`) | Mã nguồn hoàn chỉnh + Enterprise Licensing Server + Master Key Authentication | Bán thương mại chính thức, tích hợp với hệ thống server cấp phép (`@lyceum/server`). |

---

## 2. Lệnh Tự Động Đóng Gói Trên Local

Chúng ta sử dụng công cụ tự động hóa [`scripts/package-distribution.mjs`](file:///Users/mac/Desktop/the-lyceum/scripts/package-distribution.mjs):

```bash
# 1. Đóng gói Bản Dùng Thử (Beta Trial) - Tạo folder dist/ duy nhất & nén file zip
npm run package:beta

# Output tạo ra:
#   dist-releases/beta-trial/
#   dist-releases/lyceum-beta-trial-v1.0.0.zip

# 2. Đóng gói Bản Bán Thương Mại (Commercial Enterprise)
npm run package:commercial

# 3. Đóng gói cả 2 bản cùng lúc
npm run package:all
```

---

## 3. Quy Trình Gửi Bản Beta Cho Khách Hàng (Ví dụ: Replit)

1. Chạy lệnh:
   ```bash
   npm run package:beta
   ```
2. Gửi duy nhất file zip **`dist-releases/lyceum-beta-trial-v1.0.0.zip`** cho khách hàng.
3. Khách hàng giải nén và sử dụng trực tiếp thông qua MCP hoặc CLI mà **hoàn toàn không tiếp cận được mã nguồn TypeScript gốc**.
