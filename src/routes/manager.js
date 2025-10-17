const express = require('express');
const router = express.Router();
const Booking = require('../models/booking');
const RfidAccess = require('../models/rfidAccess');
const statusManager = require('../websocket/statusManager');

// Manager dashboard - Hiển thị tất cả bookings và RFID access
router.get("/", async (req, res) => {
    try {
        // Lấy tất cả booking
        const bookings = await Booking.find()
            .populate("userId", "fullname")
            .sort({ createdAt: -1 })
            .lean();
        
        // Format thời gian
        bookings.forEach(b => {
            b.createdAt = new Date(b.createdAt).toLocaleString("vi-VN");
        });

        // Lấy lịch sử RFID
        const rfidaccesses = await RfidAccess.find()
            .sort({ updatedAt: -1 })
            .lean();

        // Format thời gian và URLs cho RFID
        rfidaccesses.forEach(r => {
            r.entryTime = r.entryTime ? new Date(r.entryTime).toISOString() : "";
            r.exitTime = r.exitTime ? new Date(r.exitTime).toISOString() : "";
            r.createdAt = r.createdAt ? new Date(r.createdAt).toLocaleString("vi-VN") : "";
            r.updatedAt = r.updatedAt ? new Date(r.updatedAt).toLocaleString("vi-VN") : "";

            // Fix image URLs
            if (r.entryImageUrl && !r.entryImageUrl.startsWith('http')) {
                if (!r.entryImageUrl.startsWith('/uploads/')) {
                    r.entryImageUrl = `/uploads/license_plates/${r.entryImageUrl}`;
                }
            }
            if (r.exitImageUrl && !r.exitImageUrl.startsWith('http')) {
                if (!r.exitImageUrl.startsWith('/uploads/')) {
                    r.exitImageUrl = `/uploads/license_plates/${r.exitImageUrl}`;
                }
            }
        });

        res.render("manager", { bookings, rfidaccesses });
    } catch (err) {
        console.error("❌ Lỗi lấy booking:", err);
        res.status(500).send("Lỗi server");
    }
});

// Tìm booking theo code
router.get("/:code", async (req, res) => {
    try {
        const booking = await Booking.findOne({ bookingCode: req.params.code })
            .populate("userId", "fullname")
            .lean();

        if (!booking) {
            return res.status(404).json({ message: "Không tìm thấy mã này" });
        }

        booking.createdAt = new Date(booking.createdAt).toLocaleString("vi-VN");
        res.json(booking);
    } catch (err) {
        console.error("❌ Lỗi tìm booking:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});

// Xóa booking theo code
router.delete("/:code", async (req, res) => {
    try {
        const result = await Booking.findOneAndDelete({ bookingCode: req.params.code });
        
        if (!result) {
            return res.status(404).json({ message: "Không tìm thấy mã này để xóa" });
        }

        // Cập nhật available slots
        await statusManager.updateAvailableSlotsFromRFID();
        await statusManager.sendStatusUpdateToESP32();

        // Broadcast to web clients
        await statusManager.broadcastToWebClients({
            type: 'status',
            data: statusManager.getCurrentStatus(),
            timestamp: new Date().toISOString()
        });

        res.json({ 
            message: "Xóa thành công", 
            deleted: result,
            availableSlots: statusManager.getCurrentStatus().availableSlots
        });
    } catch (err) {
        console.error("❌ Lỗi xóa booking:", err);
        res.status(500).json({ message: "Lỗi server khi xóa booking" });
    }
});

// Cập nhật trạng thái booking
router.put("/:code/status", async (req, res) => {
    try {
        const { status } = req.body;
        
        if (!["pending", "confirmed", "cancelled"].includes(status)) {
            return res.status(400).json({ message: "Trạng thái không hợp lệ" });
        }
        
        let update = { status };
        if (status === "confirmed") {
            update.createdAt = new Date();
        }
        
        const booking = await Booking.findOneAndUpdate(
            { bookingCode: req.params.code },
            update,
            { new: true }
        );
        
        if (!booking) {
            return res.status(404).json({ message: "Không tìm thấy booking" });
        }
        
        // Cập nhật available slots
        await statusManager.updateAvailableSlotsFromRFID();
        console.log(`✅ Updated availableSlots: ${statusManager.getCurrentStatus().availableSlots}`);
        
        await statusManager.sendStatusUpdateToESP32();
        
        // Broadcast to web clients
        await statusManager.broadcastToWebClients({
            type: 'status',
            data: statusManager.getCurrentStatus(),
            timestamp: new Date().toISOString()
        });
        
        res.json({ 
            message: "Cập nhật thành công", 
            booking,
            availableSlots: statusManager.getCurrentStatus().availableSlots
        });
    } catch (err) {
        console.error("❌ Lỗi cập nhật status:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});

// Thêm note cho booking
router.post('/note', async (req, res) => {
    const { bookingCode, note } = req.body;
    
    if (!bookingCode || !note) {
        return res.status(400).json({ message: 'Thiếu thông tin' });
    }
    
    try {
        console.log(`Updating note for booking ${bookingCode}: ${note}`);
        
        const booking = await Booking.findOneAndUpdate(
            { bookingCode },
            { note },
            { new: true }
        );
        
        if (!booking) {
            return res.status(404).json({ message: 'Không tìm thấy mã vé' });
        }
        
        res.json({ success: true, booking });
    } catch (err) {
        console.error("❌ Lỗi update note:", err);
        res.status(500).json({ message: 'Lỗi server' });
    }
});

module.exports = router;


