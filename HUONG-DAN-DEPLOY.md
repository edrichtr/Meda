# HƯỚNG DẪN TRIỂN KHAI - MÊ ĐÁ (Zalo 24/7 + Security Rules)

Sau khi triển khai xong, hệ thống sẽ:
- **Gửi Zalo 24/7** kể cả khi bạn đóng máy (chạy trên Cloud Functions).
- **Tự báo đơn mới** ngay khi khách bấm thanh toán.
- **Tự gửi báo cáo cuối ngày** (mặc định 21:00) + tự gửi bù nếu bị bỏ sót.
- **Tự cảnh báo hết nguyên liệu / hết món** (mỗi 30 phút, không spam).
- **Chặn** khách đọc Token Zalo, sửa giá, tạo đơn giả, xem doanh thu.

> ⚠️ **Đọc kỹ mục [0] trước.** Trong lúc chưa triển khai Rules, mọi thứ vẫn chạy như cũ.

---

## [0] Tóm tắt các thay đổi

| Việc | Trước | Sau |
|---|---|---|
| Token Zalo | Nằm trong mã nguồn HTML **và** đọc được từ trang thanh toán của khách | Nằm trên máy chủ, trình duyệt **không** đọc được |
| Mật khẩu admin | Trong `localStorage`, mở DevTools là thấy | Kiểm tra ở Cloud Function, lưu dạng hash (scrypt) |
| Giá đơn hàng | Khách sửa `localStorage` là đặt được giá rẻ | Server **luôn tính lại** từ database |
| Số thứ tự | Đếm ở trình duyệt, dễ trùng | Transaction trên server, không trùng |
| Báo cáo 21:00 | Chỉ chạy khi bạn mở trang | Lịch server 15 phút/lần, tự gửi bù |
| Đơn hàng | Khách đóng tab là mất thông báo | Firestore trigger, chắc chắn gửi |

---

## [1] Yêu cầu trước khi bắt đầu

- Tài khoản Firebase: project **`meda-e0955`**
- **Node.js 20** trên máy ([nodejs.org](https://nodejs.org))
- **Bật gói Blaze** (bắt buộc cho Cloud Functions có lịch):
  Firebase Console → ⚙️ Billing → **Upgrade**. Mức sử dụng này nằm trong
  hạn mức miễn phí, thực tế không tốn tiền.

---

## [2] Cài Firebase CLI (chỉ làm 1 lần)

```bash
npm install -g firebase-tools
firebase login
```

---

## [3] Bật đăng nhập ẩn danh

Firebase Console → **Authentication** → **Sign-in method** → bật **Anonymous**.

Không bật thì trang menu và trang thanh toán sẽ không đọc được dữ liệu.

---

## [4] Đặt mật khẩu quản trị (mật mã, KHÔNG lưu trong mã nguồn)

```bash
firebase functions:secrets:set ADMIN_PASSWORD
```

Nhập mật khẩu bạn muốn dùng (tối thiểu 6 ký tự).

**Mật khẩu quản trị hiện tại của bạn: `meda2026`** (đây là mã khóa phần cấu
hình Zalo trong trang quản trị — xem mục [8]).

> Lần đăng nhập quản trị đầu tiên, hệ thống sẽ tự chuyển mật khẩu này thành
> hash lưu trên Firestore. Từ đó đổi mật khẩu ngay trong trang quản trị.

---

## [5] Cài thư viện cho Functions

```bash
cd functions
npm install
cd ..
```

---

## [6] TRIỂN KHAI (quan trọng - đúng thứ tự)

```bash
# 1) Deploy Cloud Functions (chứa Token Zalo, đặt hàng, lịch báo cáo)
firebase deploy --only functions

# 2) Deploy Security Rules (chặn truy cập trái phép)
firebase deploy --only firestore:rules
```

> 💡 Lần đầu phải `firebase use --add` để chọn project `meda-e0955`.

### Thứ tự này rất quan trọng
Deploy Functions **trước**, Rules **sau**. Nếu deploy Rules trước, các trang
cũ đang chạy sẽ bị chặn ngay và không đăng nhập được.

---

## [7] Đăng nhập lần đầu & đổi mật khẩu

1. Mở `admin.html` → nhập tên `admin` + mật khẩu bạn đặt ở bước 4.
2. Bấm **Đổi Mật Khẩu** ở góc trên → đổi sang mật khẩu riêng của bạn.
3. Bấm **💾 Lưu Cấu Hình Zalo** trong khu vực đã mở khoá.

Token Zalo cũ của bạn **đã được tự động chuyển** sang khoá `config/zaloToken`
ngay lần chạy đầu tiên — không cần nhập lại.

---

## [8] Mã bảo mật Zalo (khoá phần cấu hình)

Đây là mã **thứ hai**, tách khỏi mật khẩu quản trị, dùng để mở khu vực
"🔒 Kết Nối Zalo" trong trang quản trị:

```
meda2026
```

Đổi mã này ngay: mở khu vực kết nối Zalo → bấm **🗝️ Đổi Mã Bảo Mật**.

> Mã này chỉ chặn việc *xem/sửa cấu hình trên màn hình*. Nó **không** bảo vệ
> Token nữa (Token đã nằm trên máy chủ). Nhưng vẫn nên đổi để tránh ai đó
> tò mò chỉnh sửa cấu hình của bạn.

---

## [9] Kiểm tra hệ thống đã chạy 24/7 chưa

### Trong trang quản trị
Mở khu vực Zalo → bấm **⚡ Chạy Ngay Các Tác Vụ Tự Động**.

Nếu báo `✅ Thành công` thì mọi thứ đang chạy.

### Kiểm tra từ xa
Mở trình duyệt ẩn danh (không đăng nhập) vào URL:

```
https://asia-southeast1-<project-id>.cloudfunctions.net/health
```

Phải trả về `{"ok":true,...}`. URL đầy đủ lấy ở
Firebase Console → Functions.

### Theo dõi lịch tự động
Firebase Console → **Functions** → `dailyReportScheduler` → **Logs**.
Sẽ thấy lần chạy mỗi 15 phút.

---

## [10] Vài lưu ý vận hành

### Báo cáo 21:00 không gửi được?
Kiểm tra trang quản trị → khung `⚠️` màu đỏ sẽ hiện lỗi cụ thể
(sai Token, sai Chat ID, Zalo từ chối...). Hệ thống **tự thử lại**
mỗi 15 phút, tối đa 3 ngày bù.

### Token Zalo hết hạn
Vào khu vực cấu hình Zalo → dán Token mới → **💾 Lưu Cấu Hình Zalo**.

### Đổi Chat ID nhận tin
Trong khu vực cấu hình, dán Chat ID mới rồi lưu.

### Muốn tắt hẳn Zalo
Bỏ chọn "Bật tự động đẩy thông báo" → lưu.

---

## [11] Tùy chọn: ẩn luôn số lượng tồn kho

Mặc định Rules cho phép tài khoản ẩn danh đọc `inventory` để trang menu tính
"số ly còn pha được". Nghĩa là khách có thể xem số lượng tồn kho.

Muốn giấu kín, mở `firestore.rules`, sửa:

```
match /inventory/{ingId} {
  allow read: if isAdmin();
  allow write: if isAdmin();
  allow list: if isAdmin();
}
```

Sau đó deploy lại rules. **Lưu ý:** trang menu sẽ không còn hiện số ly còn
pha được, và cần sửa thêm `index.html` để không báo lỗi.

---

## [12] Khắc phục sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Trang menu trống, báo lỗi | Chưa bật đăng nhập ẩn danh | Bật Anonymous provider (bước 3) |
| "Vui lòng đăng nhập quản trị" | Chưa đăng nhập hoặc session hết hạn | Đăng nhập lại |
| `Missing or insufficient permissions` | Đã deploy Rules nhưng Functions chưa deploy | Deploy lại Functions (bước 6) |
| Đặt hàng lỗi | Chưa deploy `placeOrder` | `firebase deploy --only functions` |
| Zalo không nhận tin | Sai Token/Chat ID | Xem log `onOrderCreated`, sửa cấu hình |
| Deploy lỗi "Blaze" | Chưa bật gói trả phí | Bật Blaze ở bước 1 |

---

## [13] Những gì hệ thống KHÔNG còn làm

- ❌ Không cần giữ tab admin mở 24/7 nữa.
- ❌ Quên mật khẩu không tự khôi phục được (đây là điểm tốt về bảo mật).
- ❌ Token Zalo không còn xuất hiện trong mã nguồn trang web.