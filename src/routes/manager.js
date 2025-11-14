const express = require('express');
const router = express.Router();
const Booking = require('../models/booking');
const RfidAccess = require('../models/rfidAccess');

router.get('/', async (req, res) => {
    try {
        // ✅ LẤY CẢ BOOKING VÀ RFID ACCESS
        const bookings = await Booking.find()
            .populate('userId')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        
        const rfidAccesses = await RfidAccess.find()
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        
        // ✅ MERGE DỮ LIỆU: Booking self check-in + RFID access
        const allAccessRecords = [];
        
        // 1. Thêm tất cả RFID access records
        rfidAccesses.forEach(access => {
            allAccessRecords.push({
                _id: access._id,
                type: 'RFID',
                rfidCode: access.rfidCode,
                bookingCode: access.bookingCode || null,
                licensePlateEntry: access.licensePlateEntry,
                licensePlateExit: access.licensePlateExit,
                entryImageUrl: access.entryImageUrl,
                exitImageUrl: access.exitImageUrl,
                entryTime: access.entryTime,
                exitTime: access.exitTime,
                parkingFee: access.parkingFee,
                parkingDuration: access.parkingDuration,
                status: access.status,
                plateMatch: access.plateMatch,
                createdAt: access.createdAt,
                updatedAt: access.updatedAt
            });
        });
        
        // 2. Thêm Self check-in bookings (chỉ những cái đã check-in)
        bookings.forEach(booking => {
            if (booking.selfCheckInRequested) {
                // Tìm xem đã có RFID access record chưa
                const existingRecord = rfidAccesses.find(
                    r => r.bookingCode === booking.bookingCode
                );
                
                if (!existingRecord) {
                    // Chưa có trong RfidAccess → Tạo record ảo để hiển thị
                    allAccessRecords.push({
                        _id: booking._id,
                        type: 'SELF',
                        rfidCode: null,
                        bookingCode: booking.bookingCode,
                        licensePlateEntry: booking.selfCheckInPlate || booking.license_plate,
                        licensePlateExit: booking.selfCheckOutPlate,
                        entryImageUrl: booking.selfCheckInImageUrl,
                        exitImageUrl: booking.selfCheckOutImageUrl,
                        entryTime: booking.selfCheckInTime,
                        exitTime: booking.selfCheckOutTime,
                        parkingFee: booking.parkingFee,
                        parkingDuration: booking.parkingDuration,
                        status: booking.status === 'checked_in' ? 'ACTIVE' : 
                               booking.status === 'completed' ? 'COMPLETED' : 'PENDING',
                        plateMatch: booking.selfCheckInMatch,
                        createdAt: booking.createdAt,
                        updatedAt: booking.updatedAt
                    });
                }
            }
        });
        
        // ✅ SẮP XẾP THEO THỜI GIAN MỚI NHẤT
        allAccessRecords.sort((a, b) => {
            const timeA = a.updatedAt || a.createdAt || 0;
            const timeB = b.updatedAt || b.createdAt || 0;
            return new Date(timeB) - new Date(timeA);
        });
        
        console.log(`📊 Manager Dashboard:`);
        console.log(`   Bookings: ${bookings.length}`);
        console.log(`   RFID Access: ${rfidAccesses.length}`);
        console.log(`   Total Records: ${allAccessRecords.length}`);
        
        res.render('manager', {
            user: req.session.user,
            bookings: bookings,
            rfidaccesses: allAccessRecords // ✅ GỬI MERGED DATA
        });
        
    } catch (error) {
        console.error('❌ Error loading manager dashboard:', error);
        res.status(500).send('Server error');
    }
});

module.exports = router;