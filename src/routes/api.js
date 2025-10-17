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

