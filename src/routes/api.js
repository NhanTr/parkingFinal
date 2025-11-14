const express = require('express');
const router = express.Router();
const statusManager = require('../websocket/statusManager');

// Get parking status
router.get('/parking-status', (req, res) => {
    const esp32Conn = statusManager.getESP32Connection();
    const webClients = statusManager.getWebClients();
    const currentStatus = statusManager.getCurrentStatus();
    
    res.json({
        ...currentStatus,
        esp32Connected: esp32Conn !== null && esp32Conn.readyState === 1,
        webClients: webClients.size,
        timestamp: new Date().toISOString()
    });
});

// Toggle gate
router.post('/toggle-gate', (req, res) => {
    const { gateId } = req.body;
    console.log(`HTTP Gate control: ${gateId}`);
    
    const esp32Conn = statusManager.getESP32Connection();
    
    if (esp32Conn && esp32Conn.readyState === 1) {
        let actualGateId = gateId;
        if (gateId === 'gate1') {
            actualGateId = 'entry_gate';
        } else if (gateId === 'gate2') {
            actualGateId = 'exit_gate';
        }

        esp32Conn.send(JSON.stringify({
            type: 'control',
            data: {
                action: 'toggle_gate',
                gateId: actualGateId
            },
            timestamp: new Date().toISOString()
        }));
        
        const currentStatus = statusManager.getCurrentStatus();
        if (actualGateId === 'entry_gate') {
            statusManager.updateCurrentStatus({ 
                entryGateOpen: !currentStatus.entryGateOpen 
            });
        } else if (actualGateId === 'exit_gate') {
            statusManager.updateCurrentStatus({ 
                exitGateOpen: !currentStatus.exitGateOpen 
            });
        }
        
        res.json({ 
            success: true, 
            message: `Gate ${gateId} command sent`,
            gateId: gateId,
            timestamp: new Date().toISOString()
        });
        
        setImmediate(async () => {
            await statusManager.broadcastToWebClients({
                type: 'status',
                data: statusManager.getCurrentStatus(),
                timestamp: new Date().toISOString()
            });
        });
        
    } else {
        res.json({ 
            success: false, 
            message: 'ESP32 not connected',
            timestamp: new Date().toISOString()
        });
    }
});

router.get('/manager/:code', async (req, res) => {
    try {
        const code = req.params.code.trim();
        
        console.log(`🔍 Tra cứu mã: ${code}`);
        
        // ✅ TÌM TRONG BOOKING TRƯỚC
        let booking = await Booking.findOne({ bookingCode: code })
            .populate('userId')
            .lean();
        
        if (booking) {
            console.log(`✅ Tìm thấy Booking: ${booking.bookingCode}`);
            
            // ✅ KIỂM TRA CÓ RFID ACCESS KHÔNG
            const rfidAccess = await RfidAccess.findOne({ 
                bookingCode: code 
            }).lean();
            
            // Merge data nếu có
            if (rfidAccess) {
                booking.entryTime = rfidAccess.entryTime;
                booking.exitTime = rfidAccess.exitTime;
                booking.parkingFee = rfidAccess.parkingFee;
                booking.parkingDuration = rfidAccess.parkingDuration;
                booking.entryImageUrl = rfidAccess.entryImageUrl;
                booking.exitImageUrl = rfidAccess.exitImageUrl;
            }
            
            return res.json(booking);
        }
        
        // ✅ NẾU KHÔNG TÌM THẤY TRONG BOOKING, TÌM TRONG RFID ACCESS
        const rfidAccess = await RfidAccess.findOne({ 
            rfidCode: code 
        }).lean();
        
        if (rfidAccess) {
            console.log(`✅ Tìm thấy RFID Access: ${rfidAccess.rfidCode}`);
            
            // Chuyển đổi format để frontend hiểu
            return res.json({
                bookingCode: rfidAccess.rfidCode,
                license_plate: rfidAccess.licensePlateEntry,
                status: rfidAccess.status,
                createdAt: rfidAccess.entryTime,
                entryTime: rfidAccess.entryTime,
                exitTime: rfidAccess.exitTime,
                parkingFee: rfidAccess.parkingFee,
                parkingDuration: rfidAccess.parkingDuration,
                entryImageUrl: rfidAccess.entryImageUrl,
                exitImageUrl: rfidAccess.exitImageUrl,
                userId: { fullname: 'N/A' }
            });
        }
        
        console.log(`❌ Không tìm thấy: ${code}`);
        return res.status(404).json({ 
            message: 'Không tìm thấy mã này' 
        });
        
    } catch (error) {
        console.error('❌ Error in lookup:', error);
        res.status(500).json({ 
            message: 'Lỗi server: ' + error.message 
        });
    }
});

// Change mode
router.post('/change-mode', (req, res) => {
    const { mode } = req.body;
    console.log(`HTTP Mode change: ${mode}`);
    
    const esp32Conn = statusManager.getESP32Connection();
    
    if (esp32Conn && esp32Conn.readyState === 1) {
        esp32Conn.send(JSON.stringify({
            type: 'control',
            data: {
                action: 'change_mode',
                mode: mode
            },
            timestamp: new Date().toISOString()
        }));
        
        res.json({ 
            success: true, 
            message: `Mode changed to ${mode}`,
            mode: mode,
            timestamp: new Date().toISOString()
        });
    } else {
        res.json({ 
            success: false, 
            message: 'ESP32 not connected',
            timestamp: new Date().toISOString()
        });
    }
});

// ESP32 status
router.get('/esp32-status', (req, res) => {
    const esp32Conn = statusManager.getESP32Connection();
    const webClients = statusManager.getWebClients();
    
    res.json({
        connected: esp32Conn !== null && esp32Conn.readyState === 1,
        webClients: webClients.size,
        currentStatus: statusManager.getCurrentStatus(),
        timestamp: new Date().toISOString()
    });
});

module.exports = router;

