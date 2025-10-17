const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const Booking = require('../models/booking');
const statusManager = require('../websocket/statusManager');

// Render pages
router.get('/parking', (req, res) => {
    res.render('parking', { user: req.session.user });
});

router.get('/booking', authMiddleware, (req, res) => {
    res.render('booking');
});

router.get('/confirm', (req, res) => {
    res.render('confirm', { 
        user: req.session.user, 
        bookingCode: req.session.bookingCode 
    });
});

// Hàm sinh mã 6 số duy nhất
async function generateUniqueCode() {
    let code;
    let exists = true;
    while (exists) {
        code = Math.floor(100000 + Math.random() * 900000).toString();
        exists = await Booking.findOne({ bookingCode: code });
    }
    return code;
}

// API tạo booking
router.post("/parking", async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ message: "Chưa đăng nhập" });
        }

        const { license_plate } = req.body;
        if (!license_plate) {
            return res.status(400).json({ message: "Thiếu biển số xe" });
        }

        const bookingCode = await generateUniqueCode();
        const newBooking = new Booking({
            userId: req.session.user.id,
            license_plate,
            bookingCode
        });

        await newBooking.save();
        console.log("✅ Booking saved:", newBooking._id);

        // Update available slots
        await statusManager.updateAvailableSlotsFromRFID();
        await statusManager.sendStatusUpdateToESP32();
        
        await statusManager.broadcastToWebClients({
            type: 'status',
            data: statusManager.getCurrentStatus(),
            timestamp: new Date().toISOString()
        });

        // Auto-cancel sau 30 giây
        setTimeout(async () => {
            const booking = await Booking.findOne({ bookingCode });
            if (booking && booking.status === "pending") {
                booking.status = "cancelled";
                await booking.save();
                
                await statusManager.updateAvailableSlotsFromRFID();
                await statusManager.sendStatusUpdateToESP32();
                await statusManager.broadcastToWebClients({
                    type: 'status',
                    data: statusManager.getCurrentStatus(),
                    timestamp: new Date().toISOString()
                });
                
                console.log(`Booking ${bookingCode} auto-cancelled`);
            }
        }, 30000);

        req.session.bookingCode = bookingCode;

        res.json({
            message: "Đặt chỗ thành công",
            bookingCode,
            license_plate,
            user: req.session.user.fullname
        });
    } catch (err) {
        console.error("Booking error:", err);
        res.status(500).json({ message: "Lỗi server", error: err.message });
    }
});

module.exports = router;
