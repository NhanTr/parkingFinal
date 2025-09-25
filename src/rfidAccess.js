const mongoose = require('mongoose');

const rfidAccessSchema = new mongoose.Schema({
  rfidCode: {
    type: String,
    required: true,
    trim: true
  },
  entryTime: {
    type: Date,
    required: true,
    default: Date.now
  },
  exitTime: {
    type: Date,
    default: null
  },
  duration: {
    type: Number, // Thời gian đỗ xe tính bằng phút
    default: null
  },
  parkingFee: {
    type: Number, // Phí đỗ xe tính bằng VND
    default: null
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'COMPLETED'],
    default: 'ACTIVE'
  },
  slotUsed: {
    type: String,
    default: null
  }
}, {
  timestamps: true // Tự động thêm createdAt và updatedAt
});

// Index để tìm kiếm nhanh theo mã RFID và trạng thái
rfidAccessSchema.index({ rfidCode: 1, status: 1 });
rfidAccessSchema.index({ entryTime: -1 });

// Method để tính phí đỗ xe
rfidAccessSchema.methods.calculateParkingFee = function() {
  if (!this.exitTime) return 0;
  
  const durationMs = this.exitTime - this.entryTime;
  const minutes = Math.ceil(durationMs / (1000 * 60));
  const hours = Math.ceil(minutes / 60);
  
  // Logic tính phí giống như trong ESP32
  const entryHour = this.entryTime.getHours();
  const exitHour = this.exitTime.getHours();
  
  // Miễn phí từ 23h - 5h
  if ((entryHour >= 23 || entryHour <= 5) && (exitHour >= 23 || exitHour <= 5)) {
    return 0;
  }
  
  let hourlyRate = 0;
  if (entryHour >= 6 && entryHour <= 17) {
    hourlyRate = 10000; // 10,000 VND/giờ ban ngày
  } else if (entryHour >= 18 && entryHour <= 22) {
    hourlyRate = 15000; // 15,000 VND/giờ ban tối
  } else {
    return 10.000; 
  }
  
  return hours * hourlyRate;
};

module.exports = mongoose.model('RfidAccess', rfidAccessSchema);