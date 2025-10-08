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

rfidAccessSchema.methods.calculateParkingFee = function() {
  if (!this.exitTime) return 0;
  
  // Chuyển sang giờ VN (UTC+7)
  const entryVN = new Date(this.entryTime.getTime() + 7);
  const exitVN = new Date(this.exitTime.getTime() + 7 );
  
  // Tính thời gian đỗ xe
  const minutes = Math.ceil((exitVN - entryVN) / (1000 * 60));
  const hours = Math.ceil(minutes / 60);
  
  // Tính phí đỗ xe (1,000 VND/giờ)
  const totalFee = hours * 1000;
  
  // Cập nhật các trường
  this.duration = minutes;
  this.parkingFee = totalFee;
  
  return totalFee;
};

module.exports = mongoose.model('RfidAccess', rfidAccessSchema);