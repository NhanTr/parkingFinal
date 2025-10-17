const WebSocket = require('ws');
const RfidAccess = require('../models/rfidAccess');
const Booking = require('../models/booking');

// Connections
let esp32Connection = null;
let cameraConnection = null;
let webClients = new Set();
let streamClients = new Set();
let imageChunks = {};

// Current status
let currentStatus = {
    availableSlots: 4,
    totalSlots: 4,
    activeVehicles: 0,
    entryGateOpen: false,
    exitGateOpen: false,
    lastUpdate: new Date().toLocaleTimeString('vi-VN'),
    isAdminMode: false,
    slots: [0, 0, 0, 0]
};

// ========== GETTERS/SETTERS ==========
function getESP32Connection() {
    return esp32Connection;
}

function setESP32Connection(ws) {
    esp32Connection = ws;
}

function getCameraConnection() {
    return cameraConnection;
}

function setCameraConnection(ws) {
    cameraConnection = ws;
}

function getWebClients() {
    return webClients;
}

function addWebClient(ws) {
    webClients.add(ws);
}

function removeWebClient(ws) {
    webClients.delete(ws);
}

function getStreamClients() {
    return streamClients;
}

function addStreamClient(ws) {
    streamClients.add(ws);
}

function removeStreamClient(ws) {
    streamClients.delete(ws);
}

function getImageChunks() {
    return imageChunks;
}

function getCurrentStatus() {
    return currentStatus;
}

function updateCurrentStatus(updates) {
    Object.assign(currentStatus, updates);
}

// ========== BROADCAST ==========
async function broadcastToWebClients(message) {
    if (message.type === 'status') {
        await updateAvailableSlotsFromRFID();
        message.data = currentStatus;
        message.timestamp = new Date().toISOString();
    }

    const messageStr = JSON.stringify(message);
    let successCount = 0;
    let failCount = 0;

    webClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(messageStr);
                successCount++;
            } catch (error) {
                console.error('Error sending to client:', error);
                failCount++;
                webClients.delete(client);
            }
        } else {
            failCount++;
            webClients.delete(client);
        }
    });

    console.log(`📡 Broadcast: ${successCount} success, ${failCount} failed`);
}

// ========== AVAILABLE SLOTS ==========
async function updateAvailableSlotsFromRFID() {
    try {
        console.log('=== UPDATE AVAILABLE SLOTS START ===');
        
        const activeRFIDs = await RfidAccess.countDocuments({ status: 'ACTIVE' });
        console.log('1. Active RFIDs:', activeRFIDs);

        const pendingBookings = await Booking.countDocuments({ status: 'pending' });
        console.log('2. Pending Bookings:', pendingBookings);

        currentStatus.availableSlots = currentStatus.totalSlots - activeRFIDs - pendingBookings;

        console.log('3. Result:', {
            totalSlots: currentStatus.totalSlots,
            activeRFIDs: activeRFIDs,
            pendingBookings: pendingBookings,
            availableSlots: currentStatus.availableSlots
        });
        console.log('=== UPDATE AVAILABLE SLOTS END ===');

        return currentStatus.availableSlots;
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}

// ========== SEND TO ESP32 ==========
async function sendStatusUpdateToESP32() {
    await updateAvailableSlotsFromRFID();
    
    if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
        const statusUpdate = {
            type: 'status_update',
            data: {
                availableSlots: currentStatus.availableSlots,
                totalSlots: currentStatus.totalSlots,
                slots: currentStatus.slots,
                activeVehicles: currentStatus.activeVehicles,
                entryGateOpen: currentStatus.entryGateOpen,
                exitGateOpen: currentStatus.exitGateOpen,
                isAdminMode: currentStatus.isAdminMode,
                lastUpdate: new Date().toLocaleTimeString('vi-VN')
            },
            timestamp: new Date().toISOString()
        };

        esp32Connection.send(JSON.stringify(statusUpdate));
        console.log(`✅ Status sent to ESP32: ${currentStatus.availableSlots} slots`);
        return true;
    }
    return false;
}

// ========== DISCONNECTION HANDLER ==========
function handleDisconnection(ws) {
    webClients.delete(ws);
    streamClients.delete(ws);
    
    if (ws === esp32Connection) {
        esp32Connection = null;
        console.log('❌ ESP32 disconnected');
        broadcastToWebClients({
            type: 'esp32_disconnected',
            message: 'ESP32 is offline',
            timestamp: new Date().toISOString()
        });
    }

    if (ws === cameraConnection) {
        cameraConnection = null;
        console.log('❌ Camera disconnected');
        broadcastToWebClients({
            type: 'camera_disconnected',
            message: 'Camera is offline',
            timestamp: new Date().toISOString()
        });
    }
}

// ========== STATUS UPDATE INTERVAL ==========
function startStatusUpdateInterval() {
    setInterval(() => {
        currentStatus.lastUpdate = new Date().toLocaleTimeString('vi-VN');
    }, 1000);
}

// ========== HELPER ==========
function getSlotIndex(slotId) {
    const map = { 'A1': 0, 'A2': 1, 'A3': 2, 'A4': 3 };
    return map[slotId] !== undefined ? map[slotId] : -1;
}

module.exports = {
    // Getters/Setters
    getESP32Connection,
    setESP32Connection,
    getCameraConnection,
    setCameraConnection,
    getWebClients,
    addWebClient,
    removeWebClient,
    getStreamClients,
    addStreamClient,
    removeStreamClient,
    getImageChunks,
    getCurrentStatus,
    updateCurrentStatus,
    
    // Functions
    broadcastToWebClients,
    updateAvailableSlotsFromRFID,
    sendStatusUpdateToESP32,
    handleDisconnection,
    startStatusUpdateInterval,
    getSlotIndex
};

