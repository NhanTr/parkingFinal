const WebSocket = require('ws');
const { handleESP32Message } = require('./handlers/esp32Handler');
const { handleCameraMessage } = require('./handlers/cameraHandler');
const { handleWebClientMessage } = require('./handlers/webClientHandler');
const statusManager = require('./statusManager');

let wss;

function setupWebSocket(server) {
    wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws) => {
        console.log('🔌 New WebSocket connection established');

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());
                console.log('📨 Received:', data.type);

                // Route message theo type
                if (data.type === 'esp32_connect' || 
                    data.type === 'rfid_access' || 
                    data.type === 'status' || 
                    data.type === 'sensor_data' ||
                    data.type === 'history') {
                    await handleESP32Message(ws, data);
                }
                else if (data.type === 'camera_connect' || 
                         data.type === 'stream_frame' ||
                         data.type === 'camera_image' ||
                         data.type === 'camera_error') {
                    await handleCameraMessage(ws, data);
                }
                else if (data.type === 'web_client_connect' ||
                         data.type === 'start_stream' ||
                         data.type === 'stop_stream' ||
                         data.type === 'gate_control' ||
                         data.type === 'mode_change' ||
                         data.type === 'status_request' ||
                         data.type === 'history_request') {
                    await handleWebClientMessage(ws, data);
                }

            } catch (error) {
                console.error('⚠️ Error parsing WebSocket message:', error);
                console.error('Raw message:', message.toString());
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
}

function getWebSocketServer() {
    return wss;
}

module.exports = { setupWebSocket, getWebSocketServer };

