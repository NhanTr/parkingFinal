const WebSocket = require('ws');
const statusManager = require('../statusManager');
const { handleRfidAccess } = require('./rfidHandler');

async function handleESP32Message(ws, data) {
    // ESP32 kết nối
    if (data.type === 'esp32_connect') {
        statusManager.setESP32Connection(ws);
        console.log('✅ ESP32 connected');

        await statusManager.updateAvailableSlotsFromRFID();

        ws.send(JSON.stringify({
            type: 'connection_confirmed',
            message: 'ESP32 connected to server',
            timestamp: new Date().toISOString()
        }));

        statusManager.broadcastToWebClients({
            type: 'esp32_connected',
            message: 'ESP32 is now online',
            timestamp: new Date().toISOString()
        });
        return;
    }

    // RFID Access
    if (data.type === 'rfid_access') {
        await handleRfidAccess(data);
        return;
    }

    // Status từ ESP32
    if (data.type === 'status') {
        console.log('📊 Received status from ESP32');

        const statusData = data.data || data;
        const currentStatus = statusManager.getCurrentStatus();

        // Map slots
        if (statusData.slots !== undefined && Array.isArray(statusData.slots)) {
            const newSlots = statusData.slots.map((isOccupied, index) => {
                if (isOccupied) return 1;
                return currentStatus.slots[index] === 2 ? 2 : 0;
            });
            statusManager.updateCurrentStatus({ slots: newSlots });
        }

        // Update other fields
        const updates = {};
        if (statusData.totalSlots !== undefined) updates.totalSlots = statusData.totalSlots;
        if (statusData.entryGateOpen !== undefined) updates.entryGateOpen = statusData.entryGateOpen;
        if (statusData.exitGateOpen !== undefined) updates.exitGateOpen = statusData.exitGateOpen;
        if (statusData.lastUpdate !== undefined) updates.lastUpdate = statusData.lastUpdate;
        if (statusData.isAdminMode !== undefined) updates.isAdminMode = statusData.isAdminMode;
        
        statusManager.updateCurrentStatus(updates);

        await statusManager.updateAvailableSlotsFromRFID();

        console.log('✅ Status updated:', statusManager.getCurrentStatus());

        statusManager.broadcastToWebClients({
            type: 'status',
            data: statusManager.getCurrentStatus(),
            timestamp: new Date().toISOString()
        });
        return;
    }

    // Sensor data từ ESP32
    if (data.type === 'sensor_data') {
        console.log('📊 Received sensor data from ESP32');

        const sensorData = data.data || data;
        const currentStatus = statusManager.getCurrentStatus();

        if (sensorData.slots !== undefined && Array.isArray(sensorData.slots)) {
            const newSlots = sensorData.slots.map((isOccupied, index) => {
                if (isOccupied) return 1;
                return currentStatus.slots[index] === 2 ? 2 : 0;
            });
            statusManager.updateCurrentStatus({ slots: newSlots });
        }

        const updates = {};
        if (sensorData.availableSlots !== undefined) updates.availableSlots = sensorData.availableSlots;
        if (sensorData.activeVehicles !== undefined) updates.activeVehicles = sensorData.activeVehicles;
        
        statusManager.updateCurrentStatus(updates);

        statusManager.broadcastToWebClients({
            type: 'status',
            data: statusManager.getCurrentStatus(),
            timestamp: new Date().toISOString()
        });
        return;
    }

    // History từ ESP32
    if (data.type === 'history') {
        console.log('📜 Received history from ESP32');

        let historyArray = [];
        if (data.data && data.data.history && Array.isArray(data.data.history)) {
            historyArray = data.data.history;
        } else if (data.history && Array.isArray(data.history)) {
            historyArray = data.history;
        } else if (data.data && Array.isArray(data.data)) {
            historyArray = data.data;
        } else if (Array.isArray(data)) {
            historyArray = data;
        }

        console.log(`📋 History array: ${historyArray.length} items`);

        statusManager.broadcastToWebClients({
            type: 'history',
            data: historyArray,
            timestamp: new Date().toISOString()
        });
        return;
    }
}

module.exports = { handleESP32Message };

