// export_rfid_data.js
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const RfidAccess = require('./rfidAccess'); // Model bạn đã có

// Hàm chuyển null thành chuỗi rỗng
function safe(value) {
  return value === null || value === undefined ? '' : value;
}

async function exportData() {
  try {
    console.log('Đang kết nối MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Đang truy xuất dữ liệu...');
    const records = await RfidAccess.find().lean();

    if (!records.length) {
      console.log('Không có dữ liệu để xuất !!!');
      return;
    }

    console.log(`Lấy được ${records.length} bản ghi.`);

    // Tạo header CSV
    const header = [
      'rfidCode',
      'entryTime',
      'exitTime',
      'duration',
      'parkingFee',
      'plateMatch',
      'status'
    ];

    const csvRows = [header.join(',')];

    // Tạo dòng dữ liệu
    for (const record of records) {
      const row = [
        safe(record.rfidCode),
        safe(record.entryTime ? new Date(record.entryTime).toISOString() : ''),
        safe(record.exitTime ? new Date(record.exitTime).toISOString() : ''),
        safe(record.duration),
        safe(record.parkingFee),
        safe(record.plateMatch),
        safe(record.status)
      ];
      csvRows.push(row.join(','));
    }

    // Lưu file CSV
    const filePath = './rfid_history.csv';
    fs.writeFileSync(filePath, csvRows.join('\n'), 'utf8');

    console.log(`Đã xuất dữ liệu ra file: ${filePath}`);
    mongoose.disconnect();
  } catch (err) {
    console.error('Lỗi xuất dữ liệu:', err);
  }
}

exportData();
