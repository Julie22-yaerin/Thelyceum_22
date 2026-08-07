#!/usr/bin/env bash
# Đóng gói bản beta test cho khách hàng — chỉ chứa dist/build, không kèm source.
# Chạy từ thư mục gốc repo: bash client-deliverables/build-beta-package.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/client-deliverables/beta-package"
PACKAGES=(thrift brake redteam)

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

for pkg in "${PACKAGES[@]}"; do
  echo "== Building $pkg =="
  (cd "$ROOT_DIR/packages/$pkg" && npm run build)

  echo "== Packing $pkg (chỉ theo whitelist trong package.json: dist, skills, README, LICENSE) =="
  (cd "$ROOT_DIR/packages/$pkg" && npm pack --pack-destination "$OUT_DIR")
done

cp "$ROOT_DIR/client-deliverables/Lyceum-Benchmark-Report.md" "$OUT_DIR/"
cp "$ROOT_DIR/client-deliverables/QUICKSTART-beta-test.md" "$OUT_DIR/"
cp "$ROOT_DIR/scripts/beta-activate.mjs" "$OUT_DIR/"

# Đổi tên .tgz cho gọn (npm pack đặt tên kiểu thrift-1.0.0.tgz sẵn rồi, giữ nguyên)
cd "$ROOT_DIR/client-deliverables"
zip -r "Lyceum-Beta-Test-Package.zip" "beta-package" -x "*.DS_Store"

# BYOC beta license server — separate zip, separate audience (whoever runs
# the customer's infra, not necessarily the evaluating engineer). Zero
# dependencies, so this is just the two files, no build step.
zip -r "Lyceum-BYOC-Beta-Server.zip" "byoc-beta-server" -x "*.DS_Store" -x "*beta-server.db*"

echo ""
echo "Xong. Hai gói nằm ở:"
echo "  client-deliverables/Lyceum-Beta-Test-Package.zip   (thrift/brake/redteam CLIs + beta-activate.mjs)"
echo "  client-deliverables/Lyceum-BYOC-Beta-Server.zip    (self-hosted license server, for their infra team)"
echo "Kiểm tra nhanh trước khi gửi khách:"
echo "  unzip -l client-deliverables/Lyceum-Beta-Test-Package.zip   # không được thấy file .ts nào"
