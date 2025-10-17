const WebSocket = require('ws');
const statusManager = require('../statusManager');

async function handleWebClientMessage(ws, data) {
    // Web client kết nối
    if (data.type === 'web_client_connect') {
        statusManager.addWebClient(ws);
        console.log('🌐 Web client connected. Total:', statusManager.getWebClients().size);

        ws.send(JSON.stringify({
            type: 'status',
            data: statusManager.getCurrentStatus(),
            timestamp: new Date().toISOString()
        }));

        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === WebSocket.OPEN) {
            esp32Conn.send(JSON.stringify({
                type: 'status_request',
                timestamp: new Date().toISOString()
            }));
        }
        return;
    }

    // Bắt đầu streaming
    if (data.type === 'start_stream') {
        statusManager.addStreamClient(ws);
        console.log('▶️ Client joined stream. Total viewers:', statusManager.getStreamClients().size);

        const cameraConn = statusManager.getCameraConnection();
        if (cameraConn && cameraConn.readyState === WebSocket.OPEN) {
            cameraConn.send(JSON.stringify({
                type: 'start_stream',
                timestamp: new Date().toISOString()
            }));
        }

        ws.send(JSON.stringify({
            type: 'stream_started',
            message: 'Streaming started',
            timestamp: new Date().toISOString()
        }));
        return;
    }

    // Ngừng stream
    if (data.type === 'stop_stream') {
        statusManager.removeStreamClient(ws);
        console.log('⏸️ Client left stream. Total viewers:', statusManager.getStreamClients().size);

        // Không ai xem, ngừng stream
        const streamClients = statusManager.getStreamClients();
        const cameraConn = statusManager.getCameraConnection();
        
        if (streamClients.size === 0 && cameraConn && cameraConn.readyState === WebSocket.OPEN) {
            cameraConn.send(JSON.stringify({
                type: 'stop_stream',
                timestamp: new Date().toISOString()
            }));
        }

        ws.send(JSON.stringify({
            type: 'stream_stopped',
            message: 'Streaming stopped',
            timestamp: new Date().toISOString()
        }));
        return;
    }

    // Điều khiển gate
    if (data.type === 'gate_control') {
        console.log('🚪 Gate control request:', data.gateId);

        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === WebSocket.OPEN) {
            let actualGateId = data.gateId;
            if (data.gateId === 'gate1') {
                actualGateId = 'entry_gate';
            } else if (data.gateId === 'gate2') {
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

            console.log(`✅ Gate command sent: ${actualGateId}`);

            ws.send(JSON.stringify({
                type: 'gate_control_response',
                success: true,
                message: `Gate ${data.gateId} command sent`,
                gateId: data.gateId,
                timestamp: new Date().toISOString()
            }));

            // Update local status
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

            // Broadcast async
            setImmediate(async () => {
                await statusManager.broadcastToWebClients({
                    type: 'status',
                    data: statusManager.getCurrentStatus(),
                    timestamp: new Date().toISOString()
                });
            });

        } else {
            console.log('❌ ESP32 not connected');
            ws.send(JSON.stringify({
                type: 'gate_control_response',
                success: false,
                message: 'ESP32 not connected',
                gateId: data.gateId,
                timestamp: new Date().toISOString()
            }));
        }
        return;
    }

    // Thay đổi mode
    if (data.type === 'mode_change') {
        console.log('🔄 Mode change request:', data.mode);

        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === WebSocket.OPEN) {
            esp32Conn.send(JSON.stringify({
                type: 'control',
                data: {
                    action: 'change_mode',
                    mode: data.mode
                },
                timestamp: new Date().toISOString()
            }));

            console.log(`✅ Mode change sent: ${data.mode}`);

            ws.send(JSON.stringify({
                type: 'mode_change_response',
                success: true,
                message: `Mode changed to ${data.mode}`,
                mode: data.mode,
                timestamp: new Date().toISOString()
            }));
        } else {
            ws.send(JSON.stringify({
                type: 'mode_change_response',
                success: false,
                message: 'ESP32 not connected',
                timestamp: new Date().toISOString()
            }));
        }
        return;
    }

    // Yêu cầu trạng thái
    if (data.type === 'status_request') {
        console.log('📊 Status request from web client');

        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === WebSocket.OPEN) {
            esp32Conn.send(JSON.stringify({
                type: 'status_request',
                timestamp: new Date().toISOString()
            }));
            console.log('✅ Status request forwarded to ESP32');
        } else {
            ws.send(JSON.stringify({
                type: 'status',
                data: statusManager.getCurrentStatus(),
                timestamp: new Date().toISOString(),
                note: 'ESP32 offline - showing cached data'
            }));
        }
        return;
    }

    // Yêu cầu lịch sử
    if (data.type === 'history_request') {
        console.log('📜 History request from web client');

        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === WebSocket.OPEN) {
            esp32Conn.send(JSON.stringify({
                type: 'history_request',
                timestamp: new Date().toISOString()
            }));
            console.log('✅ History request forwarded to ESP32');
        }
        return;
    }
}

module.exports = { handleWebClientMessage };
