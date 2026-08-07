# Quản Lý & Đóng Gói Sản Phẩm (Lyceum Package Structure & Distribution Guide)

Tài liệu hướng dẫn phân loại và đóng gói sản phẩm theo mô hình **B2B Enterprise** (Bàn giao Zip Bundle) và **B2C Developer Tier** (Cài đặt nhanh qua Terminal/Web Portal).

---

## 1. Phân Loại Tiers Sản Phẩm

| Phân Loại Tier | Gói Sản Phẩm & Nội Dung | Hình Thức Đóng Gói | Mục Đích & Phương Thức Triển Khai |
|---|---|---|---|
| **B2B Tier (Kinh Doanh Doanh Nghiệp)** | Đầy đủ 3 công cụ (`brake`, `redteam`, `thrift`) + Licensing Server + Master Key Guard | **File ZIP Nén Nguyên Vẹn** (`lyceum-b2b-enterprise.zip` / `lyceum-beta-trial-v1.0.0.zip`) | **Giữ nguyên file ZIP** để bàn giao trực tiếp cho doanh nghiệp/đối tác B2B triển khai On-Premise, bảo mật mã nguồn tuyệt đối (chỉ chứa `dist/` compiled binaries). |
| **B2C Tier (Lập Trình Viên Cá Nhân)** | Bộ 3 CLI Tool Client (`brake`, `redteam`, `thrift`) | **Cài đặt nhanh từ Terminal Trống** (`npm install -g` / CLI launcher) | Lập trình viên cá nhân đăng ký nhận License Key trên Web Portal (`/web/redeem`), kích hoạt trực tiếp từ terminal mà không cần tải file zip. |

---

## 2. Lệnh Tự Động Đóng Gói B2B Zip & B2C Tarball

Chúng ta sử dụng công cụ tự động hóa [`scripts/package-distribution.mjs`](file:///Users/mac/Desktop/the-lyceum/scripts/package-distribution.mjs):

```bash
# 1. Đóng gói B2B Zip Package (Giữ nguyên file ZIP cho doanh nghiệp B2B)
npm run package:beta

# Output tạo ra:
#   dist-releases/beta-trial/
#   dist-releases/lyceum-beta-trial-v1.0.0.zip  <-- GIỮ NGUYÊN FILE ZIP CHO B2B

# 2. Đóng gói Bản Bán Thương Mại B2B On-Premise
npm run package:commercial

# 3. Đóng gói toàn bộ các Tiers
npm run package:all
```

---

## 3. Quy Trình Phân Phối Theo Tier

1. **Đối với Khách Hàng B2B (Doanh nghiệp, Replit, Enterprise Partners):**
   * Giữ nguyên quy trình bàn giao **File ZIP** (`dist-releases/lyceum-beta-trial-v1.0.0.zip` hoặc `lyceum-b2b-enterprise.zip`).
   * Khách hàng giải nén và tích hợp vào hạ tầng On-Premise / Private MCP Hosts mà **không xem được mã nguồn `.ts` gốc**.

2. **Đối với Khách Hàng B2C (Lập trình viên cá nhân):**
   * Đăng ký mã thử nghiệm trên Web Portal (`/web/redeem`).
   * Chạy lệnh cài đặt 1 dòng trực tiếp từ Terminal trống và nhập License Key (`brake login --key <KEY>`).

