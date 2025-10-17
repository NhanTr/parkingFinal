const WebSocket = require('ws');
const statusManager = require('../statusManager');
const { processLicensePlateImage } = require('./rfidHandler');

async function handleCameraMessage(ws, data) {
    // Camera kết nối
    if (data.type === 'camera_connect') {
        statusManager.setCameraConnection(ws);
        console.log('📷 ESP32-CAM connected');

        ws.send(JSON.stringify({
            type: 'connection_confirmed',
            message: 'Camera connected successfully',
            timestamp: new Date().toISOString()
        }));

        statusManager.broadcastToWebClients({
            type: 'camera_connected',
            message: 'Camera is online',
            timestamp: new Date().toISOString()
        });
        return;
    }

    // Stream frame
    if (data.type === 'stream_frame') {
        const frameData = {
            type: 'stream_frame',
            data: data.data,
            timestamp: data.timestamp || new Date().toISOString()
        };

        const frameStr = JSON.stringify(frameData);
        const streamClients = statusManager.getStreamClients();
        
        streamClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(frameStr);
                } catch (error) {
                    console.error('Error sending frame:', error);
                    statusManager.removeStreamClient(client);
                }
            } else {
                statusManager.removeStreamClient(client);
            }
        });
        return;
    }

    // Camera image (chunks)
    if (data.type === 'camera_image') {
        const { rfidCode, action, gateType, chunk, totalChunks, imageData } = data.data;
        const imageChunks = statusManager.getImageChunks();

        if (!imageChunks[rfidCode]) {
            imageChunks[rfidCode] = {
                chunks: [],
                totalChunks: totalChunks,
                action: action,
                gateType: gateType
            };
        }

        imageChunks[rfidCode].chunks[chunk] = imageData;
        console.log(`Received chunk ${chunk + 1}/${totalChunks} for ${rfidCode}`);

        // Kiểm tra đã nhận đủ chunks chưa
        if (imageChunks[rfidCode].chunks.filter(c => c).length === totalChunks) {
            const fullImage = imageChunks[rfidCode].chunks.join('');
            const action = imageChunks[rfidCode].action;
            const gateType = imageChunks[rfidCode].gateType;

            delete imageChunks[rfidCode]; // Xóa bộ nhớ

            processLicensePlateImage(rfidCode, action, gateType, fullImage);
        }
        return;
    }

    // Camera error
    if (data.type === 'camera_error') {
        console.error('📷 Camera error:', data.data);

        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === WebSocket.OPEN) {
            esp32Conn.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: data.data.rfidCode,
                    status: 'CAMERA_ERROR',
                    message: 'Camera error - entry allowed',
                    allowEntry: true
                },
                timestamp: new Date().toISOString()
            }));
        }
        return;
    }
}

module.exports = { handleCameraMessage };
