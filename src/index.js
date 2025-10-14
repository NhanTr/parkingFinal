const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const app = express()
const path = require('path');
const port = process.env.PORT || 4000;
const { create, engine } = require('express-handlebars');
const session = require('express-session');
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const RfidAccess = require('./rfidAccess');
var morgan = require('morgan')
require('dotenv').config();
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const User = require('./user');
const Booking = require('./booking');
const cameraService = require('./cameraService');

// Tạo HTTP server và WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

app.use(express.json()); // parse application/json
app.use(express.urlencoded({ extended: true })); 

// Kết nối MongoDB (database tên "reli_park")
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

app.use(bodyParser.urlencoded({ extended: true }));

// Tạo Handlebars instance với helpers
const hbs = create({
  extname: '.hbs',
  helpers: {
    statusIsActive: function(status) {
      return status === "ACTIVE";
    },
    eq: function(a, b, options) {
      // Phiên bản block helper - hỗ trợ {{#eq}}...{{else}}...{{/eq}}
      if (arguments.length === 3) {
        // Được gọi như block helper
        if (a === b) {
          return options.fn(this);
        } else {
          return options.inverse(this);
        }
      }
      // Dự phòng cho cách dùng inline
      return a === b;
    },
    foo() { return 'FOO!'; },
    bar() { return 'BAR!'; }
  }
});

// Thiết lập Handlebars engine
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(morgan('combined'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'nhantr1412',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.engine('hbs', hbs.engine);
app.use(morgan('combined'))

app.use(session({
  secret: process.env.SESSION_SECRET || 'nhantr1412',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // nếu dùng HTTPS thì để true
    maxAge: 24 * 60 * 60 * 1000 // 24 giờ (đơn vị ms), bạn có thể tăng/giảm tùy ý
  }
}));;

console.log("PATH: ", path.join(__dirname, 'views'))

// ============ WEBSOCKET & ESP32 MANAGEMENT ============
// Biến lưu trữ kết nối
let esp32Connection = null;
let webClients = new Set(); // Lưu trữ tất cả web client connections
let streamClients = new Set();

let cameraConnection = null;
let imageChunks = {};

// Thư mục lưu ảnh
const fs = require('fs');
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads', 'license_plates');
app.use('/uploads/license_plates', express.static(path.join(__dirname, '..', 'public', 'uploads', 'license_plates')));

// Lưu trữ trạng thái hiện tại để gửi cho client mới kết nối
let currentStatus = {
    availableSlots: 4,
    totalSlots: 4,
    activeVehicles: 0,
    entryGateOpen: false,
    exitGateOpen: false,
    lastUpdate: new Date().toLocaleTimeString('vi-VN'),
    isAdminMode: false,
    slots: [0, 0, 0, 0]  // 0: available, 1: occupied, 2: reserved
};

// Hàm helper để broadcast tin nhắn tới tất cả web clients
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
                webClients.delete(client); // Remove dead client
            }
        } else {
            failCount++;
            webClients.delete(client); // Remove dead client
        }
    });
    
    console.log(`📡 Broadcast result: ${successCount} success, ${failCount} failed`);
}

// Hàm tính availableSlots từ RFID + Customer Bookings
async function updateAvailableSlotsFromRFID() {
    try {
        console.log('=== UPDATE AVAILABLE SLOTS START ===');
        
        // 1. Đếm RFID active
        const activeRFIDs = await RfidAccess.countDocuments({ status: 'ACTIVE' });
        console.log('1. Active RFIDs:', activeRFIDs);
   
        // 2. CHỈ đếm bookings pending (đang chờ xác nhận)
        const pendingBookings = await Booking.countDocuments({
            status: 'pending'
        });
        console.log('2. Pending Bookings:', pendingBookings);
        
        // Tính available = total - rfid - pending bookings
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
        console.error('❌ Error:', error);
        return null;
    }
}


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
        console.log(`📱 Status update sent to ESP32: ${currentStatus.availableSlots} available slots`);
        return true;
    }
    return false;
}

// Hàm map slotId sang index (A1 -> 0, A2 -> 1, ...)
function getSlotIndex(slotId) {
    const map = { 'A1': 0, 'A2': 1, 'A3': 2, 'A4': 3 };
    return map[slotId] !== undefined ? map[slotId] : -1;
}

wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log('Received from client:', data);

            // Nếu là ESP32 kết nối
            if (data.type === 'esp32_connect') {
                esp32Connection = ws;
                console.log('ESP32 connected successfully');

                await updateAvailableSlotsFromRFID();

                ws.send(JSON.stringify({
                    type: 'connection_confirmed',
                    message: 'ESP32 connected to server',
                    timestamp: new Date().toISOString()
                }));

                broadcastToWebClients({
                    type: 'esp32_connected',
                    message: 'ESP32 is now online',
                    timestamp: new Date().toISOString()
                });
            }

            // Nếu là web client kết nối
            if (data.type === 'web_client_connect') {
                webClients.add(ws);
                console.log('Web client connected. Total web clients:', webClients.size);

                ws.send(JSON.stringify({
                    type: 'status',
                    data: currentStatus,
                    timestamp: new Date().toISOString()
                }));

                if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                    esp32Connection.send(JSON.stringify({
                        type: 'status_request',
                        timestamp: new Date().toISOString()
                    }));
                }
            }

             // ============ CAMERA CONNECTION ============
            if (data.type === 'camera_connect') {
                cameraConnection = ws;
                console.log('📷 ESP32-CAM connected');
                
                ws.send(JSON.stringify({
                    type: 'connection_confirmed',
                    message: 'Camera connected successfully',
                    timestamp: new Date().toISOString()
                }));
                
                broadcastToWebClients({
                    type: 'camera_connected',
                    message: 'Camera is online',
                    timestamp: new Date().toISOString()
                });
                
                return;
            }

                if (data.type === 'stream_frame') {
                // Broadcast frame to all stream viewers
                const frameData = {
                    type: 'stream_frame',
                    data: data.data,
                    timestamp: data.timestamp || new Date().toISOString()
                };
                
                const frameStr = JSON.stringify(frameData);
                streamClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        try {
                            client.send(frameStr);
                        } catch (error) {
                            console.error('Error sending frame:', error);
                            streamClients.delete(client);
                        }
                    } else {
                        streamClients.delete(client);
                    }
                });
            }

            // Web client requests to start streaming
            if (data.type === 'start_stream') {
                streamClients.add(ws);
                console.log('Client joined stream. Total viewers:', streamClients.size);
                
                // Forward to camera
                if (cameraConnection && cameraConnection.readyState === WebSocket.OPEN) {
                    cameraConnection.send(JSON.stringify({
                        type: 'start_stream',
                        timestamp: new Date().toISOString()
                    }));
                }
                
                ws.send(JSON.stringify({
                    type: 'stream_started',
                    message: 'Streaming started',
                    timestamp: new Date().toISOString()
                }));
            }

            // Web client requests to stop streaming
            if (data.type === 'stop_stream') {
                streamClients.delete(ws);
                console.log('Client left stream. Total viewers:', streamClients.size);
                
                // If no more viewers, tell camera to stop
                if (streamClients.size === 0 && cameraConnection && cameraConnection.readyState === WebSocket.OPEN) {
                    cameraConnection.send(JSON.stringify({
                        type: 'stop_stream',
                        timestamp: new Date().toISOString()
                    }));
                }
                
                ws.send(JSON.stringify({
                    type: 'stream_stopped',
                    message: 'Streaming stopped',
                    timestamp: new Date().toISOString()
                }));
            }
            
            // ============ IMAGE CHUNKS ============
            if (data.type === 'camera_image') {
                const { rfidCode, action, gateType, chunk, totalChunks, imageData } = data.data;
                
                if (!imageChunks[rfidCode]) {
                    imageChunks[rfidCode] = {
                        chunks: [],
                        totalChunks: totalChunks,
                        action: action,
                        gateType: gateType
                    };
                }
                
                imageChunks[rfidCode].chunks[chunk] = imageData;
                
                console.log(`📦 Received chunk ${chunk + 1}/${totalChunks} for ${rfidCode}`);
                
                // Check if all chunks received
                if (imageChunks[rfidCode].chunks.filter(c => c).length === totalChunks) {
                    const fullImage = imageChunks[rfidCode].chunks.join('');
                    const action = imageChunks[rfidCode].action;
                    const gateType = imageChunks[rfidCode].gateType;
                    
                    delete imageChunks[rfidCode];
                    
                    // Process complete image
                    processLicensePlateImage(rfidCode, action, gateType, fullImage);
                }
                
                return;
            }
            
            // ============ CAMERA ERROR ============
            if (data.type === 'camera_error') {
                console.error('📷 Camera error:', data.data);
                
                if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                    esp32Connection.send(JSON.stringify({
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

                // Xử lý dữ liệu RFID access từ ESP32
                if (data.type === 'rfid_access') {
                    console.log('\n=== RFID ACCESS RECEIVED ===');
                    console.log('Raw data:', JSON.stringify(data, null, 2));
                    
                    const { rfidCode, action, timestamp, slotUsed, servoType } = data.data || data;
                    
                    console.log('Parsed:');
                    console.log('  RFID Code:', rfidCode);
                    console.log('  Action:', action);
                    console.log('  Servo Type:', servoType);
                    
                    // ✅ CHECK CAMERA STATUS
                    const cameraOnline = cameraConnection && cameraConnection.readyState === WebSocket.OPEN;
                    console.log('Camera status:', cameraOnline ? 'ONLINE ✅' : 'OFFLINE ❌');
                    
                    if (cameraOnline) {
                        console.log('📷 Requesting camera to capture image...');
                        
                        // GỬI REQUEST ĐẾN CAMERA
                        cameraConnection.send(JSON.stringify({
                            type: 'capture_request',
                            data: {
                                rfidCode: rfidCode,
                                action: action,
                                gateType: servoType || (action === 'ENTER' ? 'ENTRY_GATE' : 'EXIT_GATE')
                            },
                            timestamp: new Date().toISOString()
                        }));
                        
                        console.log('✅ Capture request sent to camera');
                        console.log('⏳ Waiting for camera to process...');
                        
                        // ✅ THÊM TIMEOUT FALLBACK (10 giây)
                        setTimeout(() => {
                            console.log('⏱️ Camera timeout, processing without image...');
                            processRfidWithoutCamera(rfidCode, action, timestamp, slotUsed);
                        }, 10000);
                        
                    } else {
                        console.log('⚠️ Camera offline, processing without image immediately');
                        processRfidWithoutCamera(rfidCode, action, timestamp, slotUsed);
                    }
                    
                    console.log('=== END RFID ACCESS ===\n');
                    return;
                }

            // Xử lý dữ liệu status từ ESP32
            if (data.type === 'status') {
                console.log('📊 Received status data from ESP32:', JSON.stringify(data, null, 2));
                
                const statusData = data.data || data;

                // Map slots boolean thành number (false -> 0, true -> 1), giữ reserved nếu không occupied
                if (statusData.slots !== undefined && Array.isArray(statusData.slots)) {
                    currentStatus.slots = statusData.slots.map((isOccupied, index) => {
                        if (isOccupied) return 1;  // occupied override everything
                        return currentStatus.slots[index] === 2 ? 2 : 0;  // keep reserved if not occupied
                    });
                }


                // Cập nhật các trường khác
                if (statusData.totalSlots !== undefined) currentStatus.totalSlots = statusData.totalSlots;
                if (statusData.entryGateOpen !== undefined) currentStatus.entryGateOpen = statusData.entryGateOpen;
                if (statusData.exitGateOpen !== undefined) currentStatus.exitGateOpen = statusData.exitGateOpen;
                if (statusData.lastUpdate !== undefined) currentStatus.lastUpdate = statusData.lastUpdate;
                if (statusData.isAdminMode !== undefined) currentStatus.isAdminMode = statusData.isAdminMode;
                
                // Tính availableSlots từ RFID + Reserved
                await updateAvailableSlotsFromRFID();

                console.log('🔍 Updated current status:', {
                    availableSlots: currentStatus.availableSlots,
                    totalSlots: currentStatus.totalSlots,
                    slots: currentStatus.slots,
                    gates: {
                        entry: currentStatus.entryGateOpen,
                        exit: currentStatus.exitGateOpen
                    },
                    adminMode: currentStatus.isAdminMode
                });

                // Broadcast trạng thái mới
                broadcastToWebClients({
                    type: 'status',
                    data: currentStatus,
                    timestamp: new Date().toISOString()
                });
                console.log('✅ Status data broadcasted to', webClients.size, 'web clients');
            }

            // Xử lý dữ liệu sensor_data từ ESP32 (alias cho status)
            if (data.type === 'sensor_data') {
                console.log('📡 Received sensor data from ESP32:', data);
                
                const sensorData = data.data || data;

                // Map slots tương tự
                if (sensorData.slots !== undefined && Array.isArray(sensorData.slots)) {
                    currentStatus.slots = sensorData.slots.map((isOccupied, index) => {
                        if (isOccupied) return 1;
                        return currentStatus.slots[index] === 2 ? 2 : 0;
                    });
                }

                // Cập nhật availableSlots dựa trên slots
            if (statusData.availableSlots !== undefined) currentStatus.availableSlots = statusData.availableSlots;
            if (statusData.activeVehicles !== undefined) currentStatus.activeVehicles = statusData.activeVehicles;

                Object.assign(currentStatus, sensorData);

                broadcastToWebClients({
                    type: 'status',
                    data: currentStatus,
                    timestamp: new Date().toISOString()
                });
                console.log('✅ Sensor data processed and broadcasted');
            }

            // Xử lý dữ liệu lịch sử từ ESP32
            if (data.type === 'history') {
                console.log('📚 Received history from ESP32:', JSON.stringify(data, null, 2));
                
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

                console.log(`📋 Processed history array with ${historyArray.length} items:`, historyArray);

                broadcastToWebClients({
                    type: 'history',
                    data: historyArray,
                    timestamp: new Date().toISOString()
                });
                console.log('✅ History data broadcasted to', webClients.size, 'web clients');
            }

            // Xử lý yêu cầu điều khiển gate
            if (data.type === 'gate_control') {
                console.log('🚪 Gate control request:', data);
                
                if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                    let actualGateId = data.gateId;
                    if (data.gateId === 'gate1') {
                        actualGateId = 'entry_gate';
                    } else if (data.gateId === 'gate2') {
                        actualGateId = 'exit_gate';
                    }

                    esp32Connection.send(JSON.stringify({
                        type: 'control',
                        data: {
                            action: 'toggle_gate',
                            gateId: actualGateId
                        },
                        timestamp: new Date().toISOString()
                    }));

                    console.log(`✅ Gate control command sent to ESP32: ${actualGateId}`);
                    
                    ws.send(JSON.stringify({
                        type: 'gate_control_response',
                        success: true,
                        message: `Gate ${data.gateId} command sent`,
                        gateId: data.gateId,
                        timestamp: new Date().toISOString()
                    }));
                    
                    if (actualGateId === 'entry_gate') {
                        currentStatus.entryGateOpen = !currentStatus.entryGateOpen;
                    } else if (actualGateId === 'exit_gate') {
                        currentStatus.exitGateOpen = !currentStatus.exitGateOpen;
                    }
                    
                    // Broadcast bất đồng bộ
                    setImmediate(async () => {
                        await broadcastToWebClients({
                            type: 'status',
                            data: currentStatus,
                            timestamp: new Date().toISOString()
                        });
                    });

                } else {
                    console.log('⚠️ ESP32 not connected, cannot send gate command');
                    ws.send(JSON.stringify({
                        type: 'gate_control_response',
                        success: false,
                        message: 'ESP32 not connected',
                        gateId: data.gateId,
                        timestamp: new Date().toISOString()
                    }));
                }
            }

            // Xử lý yêu cầu thay đổi mode
            if (data.type === 'mode_change') {
                console.log('🔄 Mode change request:', data);
                
                if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                    esp32Connection.send(JSON.stringify({
                        type: 'control',
                        data: {
                            action: 'change_mode',
                            mode: data.mode
                        },
                        timestamp: new Date().toISOString()
                    }));

                    console.log(`✅ Mode change command sent to ESP32: ${data.mode}`);
                    
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
            }

            // Xử lý yêu cầu trạng thái từ web client
            if (data.type === 'status_request') {
                console.log('📊 Status request from web client');
                
                if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                    esp32Connection.send(JSON.stringify({
                        type: 'status_request',
                        timestamp: new Date().toISOString()
                    }));
                    console.log('✅ Status request forwarded to ESP32');
                } else {
                    ws.send(JSON.stringify({
                        type: 'status',
                        data: currentStatus,
                        timestamp: new Date().toISOString(),
                        note: 'ESP32 offline - showing cached data'
                    }));
                }
            }

            // Xử lý yêu cầu lịch sử từ web client
            if (data.type === 'history_request') {
                console.log('📚 History request from web client');
                
                if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                    esp32Connection.send(JSON.stringify({
                        type: 'history_request',
                        timestamp: new Date().toISOString()
                    }));
                    console.log('✅ History request forwarded to ESP32');
                }
            }

        } catch (error) {
            console.error('⚠️ Error parsing WebSocket message:', error);
            console.error('Raw message:', message.toString());
        }
    });

    // Xử lý khi connection đóng
    ws.on('close', () => {
        console.log('WebSocket connection closed');
        webClients.delete(ws);
        if (ws === esp32Connection) {
            esp32Connection = null;
            console.log('ESP32 disconnected');
            broadcastToWebClients({
                type: 'esp32_disconnected',
                message: 'ESP32 is offline',
                timestamp: new Date().toISOString()
            });
        }

        // Thêm xử lý cho camera
    if (ws === cameraConnection) {
        cameraConnection = null;
        console.log('Camera disconnected');
        broadcastToWebClients({
            type: 'camera_disconnected',
            message: 'Camera is offline',
            timestamp: new Date().toISOString()
        });
    }
    });

    // Xử lý lỗi WebSocket
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        webClients.delete(ws);
        if (ws === esp32Connection) {
            esp32Connection = null;
        }
    });
});

// ============ PROCESS LICENSE PLATE IMAGE ============
async function processLicensePlateImage(rfidCode, action, gateType, imageBase64) {
    try {
        console.log(`\n=== PROCESSING LICENSE PLATE: ${rfidCode} ===`);
        console.log(`Action: ${action}`);
        
        // Save image
        const imageUrl = cameraService.saveImage(imageBase64, rfidCode, action);
        console.log(`💾 Image saved: ${imageUrl}`);
        
        // Recognize license plate
        const ocrResult = await cameraService.recognizeLicensePlate(imageBase64);
        
        if (!ocrResult.success) {
            console.log('⚠️ OCR failed, allowing entry without plate recognition');
            
            if (action === 'ENTER' || action === 'Entry') {
                await handleEntryWithoutPlate(rfidCode, imageUrl);
            } else {
                await handleExitWithoutPlate(rfidCode, imageUrl);
            }
            
            return;
        }
        
        const licensePlate = ocrResult.plate;
        console.log(`🚗 License Plate: ${licensePlate}`);
        
        if (action === 'ENTER' || action === 'Entry') {
            await handleEntryWithPlate(rfidCode, licensePlate, imageUrl);
        } else if (action === 'EXIT' || action === 'Exit') {
            await handleExitWithPlate(rfidCode, licensePlate, imageUrl);
        }
        
    } catch (error) {
        console.error('❌ Error processing image:', error);
        
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ENTRY_ALLOWED',
                    message: 'Entry allowed (processing error)',
                    allowEntry: true
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}

// ============ HANDLE ENTRY WITH PLATE ============
async function handleEntryWithPlate(rfidCode, licensePlate, imageUrl) {
    try {
        console.log('\n=== HANDLING ENTRY WITH PLATE ===');
        console.log('RFID:', rfidCode);
        console.log('License Plate:', licensePlate);
        
        // Check existing session
        const existingAccess = await RfidAccess.findOne({
            rfidCode: rfidCode,
            status: 'ACTIVE'
        });
        
        if (existingAccess) {
            console.log('⚠️ RFID already has active session');
            
            // GỬI ERROR RESPONSE
            if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                esp32Connection.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'ERROR',
                        message: 'Already has active session'
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            
            return;
        }
        
        // Create new access record
        const newAccess = new RfidAccess({
            rfidCode: rfidCode,
            entryTime: new Date(),
            licensePlateEntry: licensePlate,
            entryImageUrl: imageUrl,
            status: 'ACTIVE'
        });
        
        await newAccess.save();
        console.log(`✅ Entry recorded: ${rfidCode} - ${licensePlate}`);
        
        // Update available slots
        await updateAvailableSlotsFromRFID();
        await sendStatusUpdateToESP32();
        
        // GỬI SUCCESS RESPONSE VỀ ESP32
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    licensePlate: licensePlate,
                    status: 'ENTRY_RECORDED',
                    message: 'Entry recorded - Gate opening',
                    allowEntry: true,
                    entryTime: newAccess.entryTime,
                    accessId: newAccess._id
                },
                timestamp: new Date().toISOString()
            }));
            
            console.log('📤 SUCCESS response sent to ESP32');
        }
        
        // Broadcast to web clients
        await broadcastToWebClients({
            type: 'status',
            data: currentStatus,
            timestamp: new Date().toISOString()
        });
        
        broadcastToWebClients({
            type: 'rfid_entry',
            data: {
                rfidCode: rfidCode,
                licensePlate: licensePlate,
                entryTime: newAccess.entryTime,
                imageUrl: imageUrl
            },
            timestamp: new Date().toISOString()
        });
        
        console.log('=== ENTRY HANDLING COMPLETE ===\n');
        
    } catch (error) {
        console.error('Error in handleEntryWithPlate:', error);
        
        // GỬI ERROR RESPONSE
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ERROR',
                    message: 'Database error: ' + error.message
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}

// ============ HANDLE EXIT WITH PLATE ============
async function handleExitWithPlate(rfidCode, licensePlate, imageUrl) {
    try {
        console.log('\n=== HANDLING EXIT WITH PLATE ===');
        console.log('RFID:', rfidCode);
        console.log('License Plate:', licensePlate);
        
        const activeAccess = await RfidAccess.findOne({
            rfidCode: rfidCode,
            status: 'ACTIVE'
        });
        
        if (!activeAccess) {
            console.log('No active session found');
            
            // GỬI ERROR RESPONSE
            if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                esp32Connection.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'ERROR',
                        message: 'No active session found',
                        allowExit: false 
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            
            return;
        }
        
        // Update exit info
        activeAccess.exitTime = new Date();
        activeAccess.licensePlateExit = licensePlate;
        activeAccess.exitImageUrl = imageUrl;
        
        // Check plate match
        const plateMatch = activeAccess.checkPlateMatch();
        activeAccess.plateMatch = plateMatch;
        
        if (!plateMatch) {
            console.log(`🚨 PLATE MISMATCH: Entry=${activeAccess.licensePlateEntry}, Exit=${licensePlate}`);
            activeAccess.status = 'MISMATCH';
            activeAccess.mismatchReason = `Entry plate: ${activeAccess.licensePlateEntry}, Exit plate: ${licensePlate}`;
            
            await activeAccess.save();
            
            // GỬI MISMATCH RESPONSE
            if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                esp32Connection.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'PLATE_MISMATCH',
                        message: 'License plate mismatch - Security alert',
                        allowExit: false,
                        entryPlate: activeAccess.licensePlateEntry,
                        exitPlate: licensePlate
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            
            // Broadcast security alert
            broadcastToWebClients({
                type: 'security_alert',
                data: {
                    alertType: 'PLATE_MISMATCH',
                    rfidCode: rfidCode,
                    entryPlate: activeAccess.licensePlateEntry,
                    exitPlate: licensePlate,
                    entryTime: activeAccess.entryTime,
                    exitTime: activeAccess.exitTime,
                    action: 'EXIT_DENIED'
                },
                timestamp: new Date().toISOString()
            });
            
            return; // Dừng xử lý tiếp
        }
        
        // Calculate fee
        activeAccess.status = 'COMPLETED';
        activeAccess.parkingFee = activeAccess.calculateParkingFee();
        
        await activeAccess.save();
        console.log(`✅ Exit recorded: ${rfidCode} - Fee: ${activeAccess.parkingFee}`);
        
        // Update available slots
        await updateAvailableSlotsFromRFID();
        await sendStatusUpdateToESP32();
        
        // ✅ GỬI SUCCESS RESPONSE VỀ ESP32
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    licensePlate: licensePlate,
                    status: 'EXIT_RECORDED',
                    message: 'Exit recorded - Gate opening',
                    allowExit: true,    //Cho ra
                    entryTime: activeAccess.entryTime,
                    exitTime: activeAccess.exitTime,
                    duration: activeAccess.duration,
                    fee: activeAccess.parkingFee,
                    plateMatch: true
                },
                timestamp: new Date().toISOString()
            }));
            
            console.log('📤 SUCCESS response sent to ESP32');
        }
        
        // Broadcast to web clients
        await broadcastToWebClients({
            type: 'status',
            data: currentStatus,
            timestamp: new Date().toISOString()
        });
        
        broadcastToWebClients({
            type: 'rfid_exit',
            data: {
                rfidCode: rfidCode,
                licensePlate: licensePlate,
                entryTime: activeAccess.entryTime,
                exitTime: activeAccess.exitTime,
                duration: activeAccess.duration,
                fee: activeAccess.parkingFee,
                plateMatch: true,
                imageUrl: imageUrl
            },
            timestamp: new Date().toISOString()
        });
        
        console.log('=== EXIT HANDLING COMPLETE ===\n');
        
    } catch (error) {
        console.error('❌ Error in handleExitWithPlate:', error);
        
        // ✅ GỬI ERROR RESPONSE
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ERROR',
                    message: 'Database error: ' + error.message
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}

// ============ HANDLE WITHOUT PLATE (FALLBACK) ============
async function handleEntryWithoutPlate(rfidCode, imageUrl) {
    try {
        console.log('\n=== HANDLING ENTRY WITHOUT PLATE ===');
        console.log('RFID:', rfidCode);
        
        const newAccess = new RfidAccess({
            rfidCode: rfidCode,
            entryTime: new Date(),
            entryImageUrl: imageUrl,
            status: 'ACTIVE'
        });
        
        await newAccess.save();
        await updateAvailableSlotsFromRFID();
        await sendStatusUpdateToESP32();
        
        // ✅ GỬI SUCCESS RESPONSE (dù không có plate)
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ENTRY_RECORDED',
                    message: 'Entry recorded (no plate detected)',
                    allowEntry: true
                },
                timestamp: new Date().toISOString()
            }));
            
            console.log('📤 SUCCESS response sent (no plate)');
        }
        
        await broadcastToWebClients({
            type: 'status',
            data: currentStatus,
            timestamp: new Date().toISOString()
        });
        
        console.log('=== ENTRY WITHOUT PLATE COMPLETE ===\n');
        
    } catch (error) {
        console.error('❌ Error in handleEntryWithoutPlate:', error);
        
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ERROR',
                    message: 'Database error'
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}

async function handleExitWithoutPlate(rfidCode, imageUrl) {
    try {
        console.log('\n=== HANDLING EXIT WITHOUT PLATE ===');
        console.log('RFID:', rfidCode);
        
        const activeAccess = await RfidAccess.findOne({
            rfidCode: rfidCode,
            status: 'ACTIVE'
        });
        
        if (!activeAccess) {
            if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                esp32Connection.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'ERROR',
                        message: 'No active session'
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            return;
        }
        
        activeAccess.exitTime = new Date();
        activeAccess.exitImageUrl = imageUrl;
        activeAccess.status = 'COMPLETED';
        activeAccess.parkingFee = activeAccess.calculateParkingFee();
        
        await activeAccess.save();
        await updateAvailableSlotsFromRFID();
        await sendStatusUpdateToESP32();
        
        // ✅ GỬI SUCCESS RESPONSE
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'EXIT_RECORDED',
                    message: 'Exit recorded (no plate detected)',
                    allowExit: true,
                    duration: activeAccess.duration,
                    fee: activeAccess.parkingFee
                },
                timestamp: new Date().toISOString()
            }));
            
            console.log('📤 SUCCESS response sent (no plate)');
        }
        
        await broadcastToWebClients({
            type: 'status',
            data: currentStatus,
            timestamp: new Date().toISOString()
        });
        
        console.log('=== EXIT WITHOUT PLATE COMPLETE ===\n');
        
    } catch (error) {
        console.error('❌ Error in handleExitWithoutPlate:', error);
        
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ERROR',
                    message: 'Database error'
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}

// ============ ORIGINAL ROUTES ============
app.get('/', (req, res) => {
  res.render('home');
})
app.get('/register', (req, res) => {
  res.render('register');
})
app.get('/parking', (req, res) => {
  res.render('parking', { user: req.session.user });
})
app.get('/booking', authMiddleware, (req, res) => {
  res.render('booking');
})
app.get('/confirm', (req, res) => {
  res.render('confirm', { user: req.session.user, bookingCode: req.session.bookingCode })
})

// API đăng ký
app.post('/register', async (req, res) => {
  try {
    const { fullname, email, phone, password, plate } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ fullname, email, phone, password: hashedPassword, plate })
    await newUser.save();
    
    res.status(201).json({ message: 'Đăng ký thành công' })
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: 'Lỗi khi đăng ký', error: error.message })
  }
});

// API đăng nhập
app.post('/', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Thiếu email hoặc mật khẩu' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Sai email hoặc mật khẩu' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Sai email hoặc mật khẩu' });

    // Nếu dùng JWT:
    const token = jwt.sign(
      { id: user._id, fullname: user.fullname, email: user.email, plate: user.plate },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Hoặc nếu dùng session:
    req.session.user = { id: user._id, fullname: user.fullname, email: user.email, plate: user.plate };
    return res.json({ message: 'Đăng nhập thành công' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});

async function syncSlotsWithDatabase() {
    try {
        await updateAvailableSlotsFromRFID();
        console.log('✅ Synced:', {
            availableSlots: currentStatus.availableSlots
        });
    } catch (error) {
        console.error('❌ Sync error:', error);
    }
}

// Hàm sinh mã 6 số duy nhất
async function generateUniqueCode() {
  let code;
  let exists = true;
  while (exists) {
    code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 số
    exists = await Booking.findOne({ bookingCode: code }); // kiểm tra trùng
  }
  return code;
}

app.post("/parking", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ message: "Chưa đăng nhập" })
    }

    const { license_plate } = req.body;
    if (!license_plate) return res.status(400).json({ message: "Thiếu biển số xe" })

    const bookingCode = await generateUniqueCode();

        const newBooking = new Booking({
            userId: req.session.user.id,
            license_plate,
            bookingCode
        });

        console.log("About to save booking:", newBooking);

        await newBooking.save();
        console.log("✅ Booking saved to DB:", newBooking._id);

        await updateAvailableSlotsFromRFID();
        await sendStatusUpdateToESP32();
        console.log(`📊 Updated availableSlots: ${currentStatus.availableSlots}`);


        await  broadcastToWebClients({
        type: 'status',
        data: currentStatus,
        timestamp: new Date().toISOString()
        });

        // Tự động hủy nếu vẫn pending sau 30 giây
        setTimeout(async () => {
            const booking = await Booking.findOne({ bookingCode });
            if (booking && booking.status === "pending") {
                booking.status = "cancelled";
                await booking.save();
                // Broadcast cho client biết trạng thái đã đổi
                await updateAvailableSlotsFromRFID();
                await sendStatusUpdateToESP32();
                
                await broadcastToWebClients({
                    type: 'status',
                    data: currentStatus,
                    timestamp: new Date().toISOString()
                });
                console.log(`Booking ${bookingCode} tự động chuyển sang cancelled sau 30s.`);
            }
            updateAvailableSlotsFromRFID();
        }, 30000);
        
        // Lưu vào session để dùng ở trang sau
        req.session.bookingCode = bookingCode;

        res.json({
            message: "Đặt chỗ thành công",
            bookingCode,
            license_plate,
            user: req.session.user.fullname
        });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ message: "Lỗi server", error: err.message });
  }
});

// Middleware xác thực JWT
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Chưa đăng nhập" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token không hợp lệ" });
    req.user = user; // gắn thông tin user từ token vào req
    next();
  });
}

app.get("/manager", async (req, res) => {
  try {
    // lấy tất cả booking, populate fullname từ User
    const bookings = await Booking.find()
      .populate("userId", "fullname")
      .sort({ createdAt: -1 }) // mới nhất trước
      .lean();
    bookings.forEach(b => {
      b.createdAt = new Date(b.createdAt).toLocaleString("vi-VN");
    });

    // Lấy lịch sử RFID, sort theo updatedAt mới nhất trước
    const rfidaccesses = await RfidAccess.find()
      .sort({ updatedAt: -1 })
      .lean();

    // Định dạng thời gian cho bảng RFID
    rfidaccesses.forEach(r => {
      r.entryTime = r.entryTime ? new Date(r.entryTime).toISOString() : "";
      r.exitTime = r.exitTime ? new Date(r.exitTime).toISOString() : "";
      r.createdAt = r.createdAt ? new Date(r.createdAt).toLocaleString("vi-VN") : "";
      r.updatedAt = r.updatedAt ? new Date(r.updatedAt).toLocaleString("vi-VN") : "";   


                if (r.entryImageUrl && !r.entryImageUrl.startsWith('http')) {
                // Nếu URL không có /uploads/, thêm vào
                if (!r.entryImageUrl.startsWith('/uploads/')) {
                r.entryImageUrl = `/uploads/license_plates/${r.entryImageUrl}`;
                }
                // Nếu đã có /uploads/ rồi thì giữ nguyên
            }
            
            if (r.exitImageUrl && !r.exitImageUrl.startsWith('http')) {
                if (!r.exitImageUrl.startsWith('/uploads/')) {
                r.exitImageUrl = `/uploads/license_plates/${r.exitImageUrl}`;
                }
            }
        });

    res.render("manager", { bookings, rfidaccesses});
  } catch (err) {
    console.error("❌ Lỗi lấy booking:", err);
    res.status(500).send("Lỗi server khi lấy booking");
  }
});

// Tìm booking theo mã code
app.get("/api/manager/:code", async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingCode: req.params.code })
      .populate("userId", "fullname")
      .lean();

    if (!booking) return res.status(404).json({ message: "Không tìm thấy mã này" });

    booking.createdAt = new Date(booking.createdAt).toLocaleString("vi-VN");
    res.json(booking);
  } catch (err) {
    console.error("❌ Lỗi tìm booking:", err);
    res.status(500).json({ message: "Lỗi server" });
  }
});


// Xóa booking theo mã code
app.delete("/api/manager/:code", async (req, res) => {
  try {
    const result = await Booking.findOneAndDelete({ bookingCode: req.params.code });
    if (!result) return res.status(404).json({ message: "Không tìm thấy mã này để xóa" });

    
    sendStatusUpdateToESP32();

    // Broadcast
    broadcastToWebClients({
        type: 'status',
        data: currentStatus,
        timestamp: new Date().toISOString()
    });

    res.json({ 
        message: "Xóa thành công", 
        deleted: result,
        availableSlots: currentStatus.availableSlots
    });
  } catch (err) {
    console.error("❌ Lỗi xóa booking:", err);
    res.status(500).json({ message: "Lỗi server khi xóa booking" });
  }
});

// Cập nhật trạng thái booking
app.put("/api/manager/:code/status", async (req, res) => {
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
        
        if (!booking) return res.status(404).json({ message: "Không tìm thấy booking" });
        
        // Cập nhật availableSlots
        await updateAvailableSlotsFromRFID();
        console.log(`📊 Updated availableSlots: ${currentStatus.availableSlots}`);
        
        sendStatusUpdateToESP32();
        
        // Broadcast
        broadcastToWebClients({
            type: 'status',
            data: currentStatus,
            timestamp: new Date().toISOString()
        });
        
        res.json({ 
            message: "Cập nhật thành công", 
            booking,
            availableSlots: currentStatus.availableSlots
        });
    } catch (err) {
        console.error("Lỗi:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});

app.get('/api/parking-status', (req, res) => {
    res.json({
        ...currentStatus,
        availableSlots: currentStatus.availableSlots,
        activeVehicles: currentStatus.activeVehicles,
        esp32Connected: esp32Connection !== null && esp32Connection.readyState === WebSocket.OPEN,
        webClients: webClients.size,
        timestamp: new Date().toISOString()
    });
});

// Thêm vào routes của bạn
app.post('/api/bookings/note', async (req, res) => {
  const { bookingCode, note } = req.body;
  if (!bookingCode || !note) return res.status(400).json({ message: 'Thiếu thông tin' });
  try {
    console.log(`Updating note for booking ${bookingCode}: ${note}`);
    const booking = await Booking.findOneAndUpdate(
      { bookingCode },
      { note },
      { new: true }
    );
    if (!booking) return res.status(404).json({ message: 'Không tìm thấy mã vé' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// API endpoint cho việc điều khiển gate 
app.post('/api/toggle-gate', (req, res) => {
    const { gateId } = req.body;
    console.log(`🚪 HTTP Gate control request: ${gateId}`);
    
    if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
        let actualGateId = gateId;
        if (gateId === 'gate1') {
            actualGateId = 'entry_gate';
        } else if (gateId === 'gate2') {
            actualGateId = 'exit_gate';
        }

        // GỬI LỆNH NGAY
        esp32Connection.send(JSON.stringify({
            type: 'control',
            data: {
                action: 'toggle_gate',
                gateId: actualGateId
            },
            timestamp: new Date().toISOString()
        }));
        
        // Cập nhật local status
        if (actualGateId === 'entry_gate') {
            currentStatus.entryGateOpen = !currentStatus.entryGateOpen;
        } else if (actualGateId === 'exit_gate') {
            currentStatus.exitGateOpen = !currentStatus.exitGateOpen;
        }
        
        // TRẢ VỀ NGAY
        res.json({ 
            success: true, 
            message: `Gate ${gateId} command sent to ESP32`,
            gateId: gateId,
            timestamp: new Date().toISOString()
        });
        
        // Broadcast bất đồng bộ
        setImmediate(async () => {
            await broadcastToWebClients({
                type: 'status',
                data: currentStatus,
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

// API endpoint cho việc thay đổi mode
app.post('/api/change-mode', (req, res) => {
    const { mode } = req.body;
    console.log(`🔄 HTTP Mode change request: ${mode}`);
    
    if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
        esp32Connection.send(JSON.stringify({
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

// API endpoint kiểm tra trạng thái ESP32
app.get('/api/esp32-status', (req, res) => {
    res.json({
        connected: esp32Connection !== null && esp32Connection.readyState === WebSocket.OPEN,
        webClients: webClients.size,
        currentStatus: currentStatus,
        timestamp: new Date().toISOString()
    });
});


// Error handling middleware
app.use((err, req, res, next) => {
    console.error('⚠️ Server error:', err.stack);
    res.status(500).json({
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

// ============ CAMERA ROUTES ============

// Camera viewer page
app.get('/camera', (req, res) => {
    console.log('📹 Camera route hit!');
    console.log('Session user:', req.session.user);
    console.log('Hostname:', req.hostname);
    console.log('Port:', port);
    console.log('Views directory:', path.join(__dirname, 'views'));
    
    // Kiểm tra file có tồn tại không
    const fs = require('fs');
    const cameraPath = path.join(__dirname, 'views', 'camera.hbs');
    console.log('Camera.hbs exists:', fs.existsSync(cameraPath));
    console.log('Camera.hbs path:', cameraPath);
    
    res.render('camera', { 
        user: req.session.user,
        ws_host: req.hostname,
        ws_port: port
    });
});

// Get recent captured images
app.get('/api/camera/recent-images', async (req, res) => {
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
        
        // Sort by timestamp
        images.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        res.json(images.slice(0, limit));
    } catch (error) {
        console.error('Error fetching recent images:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get camera status
app.get('/api/camera/status', (req, res) => {
    res.json({
        connected: cameraConnection !== null && cameraConnection.readyState === WebSocket.OPEN,
        streaming: streamClients.size > 0,
        viewers: streamClients.size,
        timestamp: new Date().toISOString()
    });
});

// Get security alerts
app.get('/api/security-alerts', async (req, res) => {
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

async function processRfidWithoutCamera(rfidCode, action, timestamp, slotUsed) {
    try {
        console.log(`\n=== PROCESSING RFID WITHOUT CAMERA ===`);
        console.log(`RFID: ${rfidCode}, Action: ${action}`);
        
        if (action === 'ENTER' || action === 'Entry') {
            // ENTRY WITHOUT CAMERA
            const existingAccess = await RfidAccess.findOne({
                rfidCode: rfidCode,
                status: 'ACTIVE'
            });

            if (existingAccess) {
                console.log('⚠️ RFID already has active session');
                
                // ✅ GỬI ERROR
                if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                    esp32Connection.send(JSON.stringify({
                        type: 'rfid_response',
                        data: {
                            rfidCode: rfidCode,
                            status: 'ERROR',
                            message: 'Already has active session'
                        },
                        timestamp: new Date().toISOString()
                    }));
                }
                return;
            }

            const newAccess = new RfidAccess({
                rfidCode: rfidCode,
                entryTime: timestamp ? new Date(timestamp) : new Date(),
                slotUsed: slotUsed && slotUsed !== 'Unknown' ? slotUsed : null,
                status: 'ACTIVE'
            });

            await newAccess.save();
            console.log(`✅ Entry recorded (no camera): ${rfidCode}`);
            
            await updateAvailableSlotsFromRFID();
            await sendStatusUpdateToESP32();

            // ✅ GỬI SUCCESS
            if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                esp32Connection.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'ENTRY_RECORDED',
                        message: 'Entry recorded (no camera)',
                        allowEntry: true,
                        entryTime: newAccess.entryTime,
                        accessId: newAccess._id
                    },
                    timestamp: new Date().toISOString()
                }));
                
                console.log('📤 SUCCESS response sent (no camera)');
            }

            await broadcastToWebClients({
                type: 'status',
                data: currentStatus,
                timestamp: new Date().toISOString()
            });

        } else if (action === 'EXIT' || action === 'Exit') {
            // EXIT WITHOUT CAMERA
            const activeAccess = await RfidAccess.findOne({
                rfidCode: rfidCode,
                status: 'ACTIVE'
            });

            if (!activeAccess) {
                console.log('⚠️ No active session found');
                
                // ✅ GỬI ERROR
                if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                    esp32Connection.send(JSON.stringify({
                        type: 'rfid_response',
                        data: {
                            rfidCode: rfidCode,
                            status: 'ERROR',
                            message: 'No active session found'
                        },
                        timestamp: new Date().toISOString()
                    }));
                }
                return;
            }

            activeAccess.exitTime = timestamp ? new Date(timestamp) : new Date();
            activeAccess.status = 'COMPLETED';
            
            const durationMs = activeAccess.exitTime - activeAccess.entryTime;
            activeAccess.duration = Math.ceil(durationMs / (1000 * 60));
            activeAccess.parkingFee = activeAccess.calculateParkingFee();

            await activeAccess.save();
            console.log(`✅ Exit recorded (no camera): ${rfidCode}, Fee: ${activeAccess.parkingFee}`);
            
            await updateAvailableSlotsFromRFID();
            await sendStatusUpdateToESP32();

            // ✅ GỬI SUCCESS
            if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                esp32Connection.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'EXIT_RECORDED',
                        message: 'Exit recorded (no camera)',
                        allowExit: true,
                        entryTime: activeAccess.entryTime,
                        exitTime: activeAccess.exitTime,
                        duration: activeAccess.duration,
                        fee: activeAccess.parkingFee
                    },
                    timestamp: new Date().toISOString()
                }));
                
                console.log('📤 SUCCESS response sent (no camera)');
            }

            await broadcastToWebClients({
                type: 'status',
                data: currentStatus,
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('=== RFID WITHOUT CAMERA COMPLETE ===\n');

    } catch (error) {
        console.error('❌ Error processing RFID without camera:', error);
        
        // ✅ GỬI ERROR
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ERROR',
                    message: 'Database error: ' + error.message
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}


// Get RFID access with images
app.get('/api/rfid-access/:rfidCode', async (req, res) => {
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

// Cleanup old images (run daily)
const cron = require('node-cron');
cron.schedule('0 0 * * *', () => {
    const deleted = cameraService.deleteOldImages(90);
    console.log(`🗑️ Daily cleanup: ${deleted} old images deleted`);
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Page not found',
        timestamp: new Date().toISOString()
    });
});

// Khởi động server với WebSocket support
server.listen(port, async () => {
    console.log(`🌐 HTTP URL: http://localhost:${port}`);
    
    // Đồng bộ với database
    await syncSlotsWithDatabase();
    
    // Cập nhật thời gian
    setInterval(() => {
        currentStatus.lastUpdate = new Date().toLocaleTimeString('vi-VN');
    }, 1000);
    
    console.log('✅ All systems initialized successfully!');
});