const express = require('express');
const router = express.Router();
const RfidAccess = require('../models/rfidAccess');
const statusManager = require('../websocket/statusManager');

// Camera viewer page
router.get('/', (req, res) => {
    console.log('📹 Camera route accessed');
    res.render('camera', { 
        user: req.session.user,
        ws_host: req.hostname,
        ws_port: process.env.PORT || 4000
    });
});

// Get recent captured images
router.get('/recent-images', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        
        const recentAccess = await RfidAccess.find({
            $or: [
                { entryImageUrl: { $exists: true, $ne: null } },
                { exitImageUrl: { $exists: true, $ne: null } }
            ]
        })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
        
        const images = [];
        recentAccess.forEach(access => {
            if (access.entryImageUrl) {
                images.push({
                    url: access.entryImageUrl,
                    rfidCode: access.rfidCode,
                    licensePlate: access.licensePlateEntry,
                    action: 'ENTRY',
                    timestamp: access.entryTime,
                    status: access.status
                });
            }
            if (access.exitImageUrl) {
                images.push({
                    url: access.exitImageUrl,
                    rfidCode: access.rfidCode,
                    licensePlate: access.licensePlateExit,
                    action: 'EXIT',
                    timestamp: access.exitTime,
                    status: access.status,
                    plateMatch: access.plateMatch
                });
            }
        });
        
        images.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json(images.slice(0, limit));
    } catch (error) {
        console.error('Error fetching recent images:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get camera status
router.get('/status', (req, res) => {
    const cameraConn = statusManager.getCameraConnection();
    const streamClients = statusManager.getStreamClients();
    
    res.json({
        connected: cameraConn !== null && cameraConn.readyState === 1,
        streaming: streamClients.size > 0,
        viewers: streamClients.size,
        timestamp: new Date().toISOString()
    });
});

// Get security alerts
router.get('/security-alerts', async (req, res) => {
    try {
        const alerts = await RfidAccess.find({ 
            status: 'MISMATCH' 
        })
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();
        
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get RFID access with images
router.get('/rfid-access/:rfidCode', async (req, res) => {
    try {
        const access = await RfidAccess.findOne({ 
            rfidCode: req.params.rfidCode 
        })
        .sort({ createdAt: -1 })
        .lean();
        
        if (!access) {
            return res.status(404).json({ error: 'Access record not found' });
        }
        
        res.json(access);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

