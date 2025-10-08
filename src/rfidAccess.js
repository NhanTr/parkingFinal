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

// Phương thức tính phí đỗ xe
rfidAccessSchema.methods.calculateParkingFee = function() {
  if (!this.exitTime || !this.entryTime) {
    this.parkingFee = 0;
    return 0;
  }

  const entry = new Date(this.entryTime);
  const exit = new Date(this.exitTime);
  
  const peakRatePerMin = 15000 / 60;    // 250đ/phút
  const normalRatePerMin = 10000 / 60;  // 167đ/phút
  const peakStart = 18; // 18:00
  const peakEnd = 22;   // 22:00

  let totalMinutes = Math.ceil((exit - entry) / (1000 * 60));
  this.duration = totalMinutes;

  // Nếu thời gian ngắn (< 4 tiếng), tính trực tiếp
  if (totalMinutes <= 4 * 60) {
    return this.calculateShortDuration(entry, exit, peakStart, peakEnd, peakRatePerMin, normalRatePerMin);
  }

  // Tính số ngày và phút còn lại
  const days = Math.floor(totalMinutes / (24 * 60));
  const remainingMinutes = totalMinutes % (24 * 60);

  // Phí cố định mỗi ngày (4h cao điểm + 20h bình thường)
  const dailyFee = (4 * 60 * peakRatePerMin) + (20 * 60 * normalRatePerMin);
  
  let totalFee = days * dailyFee;

  // Tính phí cho phần còn lại
  if (remainingMinutes > 0) {
    const remainingEntry = new Date(entry);
    remainingEntry.setDate(remainingEntry.getDate() + days);
    const remainingExit = new Date(remainingEntry.getTime() + remainingMinutes * 60000);
    
    totalFee += this.calculateShortDuration(remainingEntry, remainingExit, peakStart, peakEnd, peakRatePerMin, normalRatePerMin);
  }

  this.parkingFee = Math.ceil(totalFee);
  return this.parkingFee;
};

module.exports = mongoose.model('RfidAccess', rfidAccessSchema);