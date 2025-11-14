const WebSocket = require('ws');
const { handleESP32Message } = require('./handlers/esp32Handler');
const { handleCameraMessage } = require('./handlers/cameraHandler');
const { handleWebClientMessage } = require('./handlers/webClientHandler');
const statusManager = require('./statusManager');

// ✅ IMPORT BOOKING CAMERA HANDLERS
const { 
  handleBookingCaptureRequest, 
  processBookingLicensePlate,
  handleBookingCameraLookup
} = require('./handlers/bookingCameraHandler');

let wss;

function setupWebSocket(server) {
    wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws) => {
        console.log('🔌 New WebSocket connection established');

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());
                console.log('📨 Received:', data.type);

                // ============================================
                // ESP32 MESSAGES
                // ============================================
                if (data.type === 'esp32_connect' || 
                    data.type === 'rfid_access' || 
                    data.type === 'status' || 
                    data.type === 'sensor_data' ||
                    data.type === 'history') {
                    await handleESP32Message(ws, data);
                }
                
                // ============================================
                // CAMERA MESSAGES
                // ============================================
                else if (data.type === 'camera_connect' || 
                         data.type === 'stream_frame' ||
                         data.type === 'camera_error') {
                    await handleCameraMessage(ws, data);
                }
                
                // ============================================
                // ✅ CAMERA IMAGE - PHÂN BIỆT RFID VS BOOKING
                // ============================================
                else if (data.type === 'camera_image') {
                    // Xử lý camera message trước
                    await handleCameraMessage(ws, data);
                    
                    // Sau đó check xem có phải booking mode không
                    const { rfidCode, action, chunk, totalChunks, captureMode } = data.data;
                    
                    // Chỉ xử lý khi nhận đủ chunks (chunk cuối cùng)
                    if (chunk === totalChunks - 1) {
                        const imageChunks = statusManager.getImageChunks();
                        
                        if (imageChunks[rfidCode]) {
                            const fullImage = imageChunks[rfidCode].chunks.join('');
                            const mode = imageChunks[rfidCode].captureMode || captureMode;
                            const gateType = imageChunks[rfidCode].gateType;
                            
                            console.log(`🔍 Processing captured image for ${rfidCode}`);
                            console.log(`   Mode: ${mode || 'rfid'}`);
                            console.log(`   Action: ${action}`);
                            
                            // ✅ PHÂN BIỆT MODE
                            if (mode === 'booking') {
                                console.log('🎫 Processing as BOOKING capture');
                                await processBookingLicensePlate(rfidCode, action, gateType, fullImage);
                            } else {
                                console.log('💳 Processing as RFID capture');
                                // Import rfidHandler dynamically to avoid circular dependency
                                const { processRFIDLicensePlate } = require('./handlers/rfidHandler');
                                await processRFIDLicensePlate(rfidCode, action, gateType, fullImage);
                            }
                            
                            // Xóa chunks đã xử lý
                            delete imageChunks[rfidCode];
                        }
                    }
                }
                
                // ============================================
                // ✅ BOOKING CAMERA REQUESTS
                // ============================================
                else if (data.type === 'booking_capture_request') {
                    console.log('📸 Booking capture request received');
                    await handleBookingCaptureRequest(ws, data);
                }
                
                else if (data.type === 'booking_camera_lookup') {
                    console.log('🔍 Booking camera lookup request');
                    await handleBookingCameraLookup(ws, data);
                }
                
                // ============================================
                // WEB CLIENT MESSAGES
                // ============================================
                else if (data.type === 'web_client_connect' ||
                         data.type === 'start_stream' ||
                         data.type === 'stop_stream' ||
                         data.type === 'gate_control' ||
                         data.type === 'mode_change' ||
                         data.type === 'status_request' ||
                         data.type === 'history_request') {
                    await handleWebClientMessage(ws, data);
                }
                
                // ============================================
                // UNKNOWN MESSAGE TYPE
                // ============================================
                else {
                    console.warn(`⚠️ Unknown message type: ${data.type}`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: `Unknown message type: ${data.type}`,
                        timestamp: new Date().toISOString()
                    }));
                }

            } catch (error) {
                console.error('⚠️ Error parsing WebSocket message:', error);
                console.error('Raw message:', message.toString());
                
                // Send error back to client
                try {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid message format',
                        error: error.message,
                        timestamp: new Date().toISOString()
                    }));
                } catch (sendError) {
                    console.error('Failed to send error message:', sendError);
                }
            }
        });

        ws.on('close', () => {
            console.log('🔌 WebSocket connection closed');
            statusManager.handleDisconnection(ws);
        });

        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
            statusManager.handleDisconnection(ws);
        });
    });

    // Khởi tạo status update interval
    statusManager.startStatusUpdateInterval();
    
    console.log('✅ WebSocket server initialized');
    console.log('📷 Booking Camera System: ENABLED');
}

function getWebSocketServer() {
    return wss;
}

module.exports = { setupWebSocket, getWebSocketServer };