# ParkingFinal

Hệ thống quản lý bãi đỗ xe thông minh sử dụng Node.js, Express, MongoDB, WebSocket và Handlebars.

## Tính năng chính

- Đặt chỗ, tra cứu và quản lý trạng thái booking (pending, confirmed, cancelled)
- Quản lý trạng thái các slot đỗ xe (trống, đã đỗ, đã đặt trước)
- Giao diện người dùng (user) và quản lý (manager) riêng biệt
- Cập nhật trạng thái booking và slot theo thời gian thực qua WebSocket
- Tích hợp RFID cho kiểm soát vào/ra
- Lưu lịch sử truy cập và booking vào MongoDB
- Responsive UI, thông báo trạng thái, xác thực người dùng

## Cấu trúc thư mục

```
├── src/
│   ├── index.js           # Backend chính (Express, WebSocket)
│   ├── booking.js         # Model booking
│   ├── user.js            # Model user
│   ├── rfidAccess.js      # Model RFID
│   ├── public/
│   │   ├── js/            # Frontend JS (manager.js, parking.js, ...)
│   │   ├── css/           # CSS cho từng giao diện
│   │   └── img/           # Hình ảnh giao diện
│   └── views/
│       ├── *.hbs          # Handlebars templates
│       ├── layouts/       # Layouts chung
│       └── partials/      # Header, footer
├── package.json
├── nodemon.json
└── README.md
```

## Cài đặt & chạy thử

1. Clone repo về máy
2. Cài đặt các package:
   ```bash
   npm install
   ```
3. Tạo file `.env` với các biến:
   ```env
   MONGO_URI=mongodb://localhost:27017/reli_park
   SESSION_SECRET=your_secret
   JWT_SECRET=your_jwt_secret
   ```
4. Khởi động server:
   ```bash
   npm start
   ```
5. Truy cập giao diện tại `http://localhost:4000`

## Công nghệ sử dụng

- Node.js, Express
- MongoDB, Mongoose
- WebSocket
- Handlebars
- HTML, CSS, JavaScript

## Tác giả

- NhanTr

## License

MIT
