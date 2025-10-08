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

// Tạo HTTP server và WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json()); // parse application/json
app.use(express.urlencoded({ extended: true })); 


// Kết nối MongoDB (database tên "reli_park")
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

app.use(bodyParser.urlencoded({ extended: true }));

const hbs = create({
  helpers: {
    statusIsActive: function(status) {
      return status === "ACTIVE";
    },
        eq: function(a, b) {
            return a === b;
        },
        foo() { return 'FOO!'; },
        bar() { return 'BAR!'; }
  }
});
app.engine('hbs', hbs.engine);
app.use(express.static(path.join(__dirname, "public")));
app.use(morgan('combined'))

app.use(session({
  secret: process.env.SESSION_SECRET || 'relipark-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // nếu dùng HTTPS thì để true
    maxAge: 24 * 60 * 60 * 1000 // 24 giờ (đơn vị ms), bạn có thể tăng/giảm tùy ý
  }
}));;

app.engine('hbs', engine({
  extname: '.hbs',
}));
app.set('view engine', 'hbs')
app.set('views', path.join(__dirname, 'views'))

console.log("PATH: ", path.join(__dirname, 'views'))

// ============ WEBSOCKET & ESP32 MANAGEMENT ============
// Biến lưu trữ kết nối
let esp32Connection = null;
let webClients = new Set(); // Lưu trữ tất cả web client connections

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

// WebSocket Server - RFID Only Implementation
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

            //============ RFID ACCESS=============//
            // Xử lý dữ liệu RFID access từ ESP32
            if (data.type === 'rfid_access') {
                console.log('🏷️ Received RFID access data from ESP32:', data);
                
                try {
                    const { rfidCode, action, timestamp, slotUsed } = data.data || data;
                    
                    if (action === 'ENTER' || action === 'Entry') {
                        // Kiểm tra xem thẻ này có đang trong session active không
                        const existingAccess = await RfidAccess.findOne({
                            rfidCode: rfidCode,
                            status: 'ACTIVE'
                        });

                        if (existingAccess) {
                            console.log(`⚠️ RFID ${rfidCode} already has active session`);
                            // Gửi cảnh báo về ESP32
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

                        // Tạo record mới cho lượt vào
                        const newAccess = new RfidAccess({
                            rfidCode: rfidCode,
                            entryTime: timestamp ? new Date(timestamp) : new Date(),
                            slotUsed: slotUsed && slotUsed !== 'Unknown' ? slotUsed : null,
                            status: 'ACTIVE'
                        });

                        await newAccess.save();
                        console.log(`✅ RFID entry recorded: ${rfidCode} at ${newAccess.entryTime}`);
                        
                        // Cập nhật lại availableSlots
                        await updateAvailableSlotsFromRFID();
                        await sendStatusUpdateToESP32();

                        await broadcastToWebClients({  
                            type: 'status',  
                            data: currentStatus,
                            timestamp: new Date().toISOString()
                        });

                        // Gửi xác nhận về ESP32
                        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                            esp32Connection.send(JSON.stringify({
                                type: 'rfid_response',
                                data: {
                                    rfidCode: rfidCode,
                                    status: 'ENTRY_RECORDED',
                                    message: 'Entry recorded successfully',
                                    entryTime: newAccess.entryTime,
                                    accessId: newAccess._id
                                },
                                timestamp: new Date().toISOString()
                            }));
                        }

                        // Broadcast thông tin entry tới web clients
                        broadcastToWebClients({
                            type: 'rfid_entry',
                            data: {
                                rfidCode: rfidCode,
                                entryTime: newAccess.entryTime,
                                slotUsed: slotUsed
                            },
                            timestamp: new Date().toISOString()
                        });

                    } else if (action === 'EXIT' || action === 'Exit') {
                        // Tìm session active của thẻ này
                        const activeAccess = await RfidAccess.findOne({
                            rfidCode: rfidCode,
                            status: 'ACTIVE'
                        });

                        if (!activeAccess) {
                            console.log(`⚠️ No active session found for RFID ${rfidCode}`);
                            return;
                        }

                        // Cập nhật thời gian ra và tính phí
                        activeAccess.exitTime = timestamp ? new Date(timestamp) : new Date();
                        activeAccess.status = 'COMPLETED';
                        
                        // Tính thời gian đỗ xe (phút)
                        const durationMs = activeAccess.exitTime - activeAccess.entryTime;
                        activeAccess.duration = Math.ceil(durationMs / (1000 * 60));
                        
                        // Tính phí đỗ xe
                        activeAccess.parkingFee = activeAccess.calculateParkingFee();

                        await activeAccess.save();
                        console.log(`✅ RFID exit recorded: ${rfidCode}, Duration: ${activeAccess.duration}min, Fee: ${activeAccess.parkingFee}VND`);

                        await updateAvailableSlotsFromRFID();
                        await sendStatusUpdateToESP32();

                        await broadcastToWebClients({  
                            type: 'status',   
                            data: currentStatus,
                            timestamp: new Date().toISOString()
                        });

                        // Gửi thông tin phí về ESP32
                        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                            esp32Connection.send(JSON.stringify({
                                type: 'rfid_response',
                                data: {
                                    rfidCode: rfidCode,
                                    status: 'EXIT_RECORDED',
                                    message: 'Exit recorded successfully',
                                    entryTime: activeAccess.entryTime,
                                    exitTime: activeAccess.exitTime,
                                    duration: activeAccess.duration,
                                    fee: activeAccess.parkingFee,
                                    accessId: activeAccess._id,
                                    availableSlots: currentStatus.availableSlots
                                },
                                timestamp: new Date().toISOString()
                            }));
                        }

                        // Broadcast thông tin exit tới web clients
                        broadcastToWebClients({
                            type: 'rfid_exit',
                            data: {
                                rfidCode: rfidCode,
                                entryTime: activeAccess.entryTime,
                                exitTime: activeAccess.exitTime,
                                duration: activeAccess.duration,
                                fee: activeAccess.parkingFee,
                                slotUsed: activeAccess.slotUsed
                            },
                            timestamp: new Date().toISOString()
                        });
                    }

                } catch (error) {
                    console.error('❌ Error processing RFID access:', error);
                    
                    // Gửi lỗi về ESP32
                    if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                        esp32Connection.send(JSON.stringify({
                            type: 'rfid_response',
                            data: {
                                rfidCode: data.data?.rfidCode || 'Unknown',
                                status: 'ERROR',
                                message: 'Database error: ' + error.message
                            },
                            timestamp: new Date().toISOString()
                        }));
                    }
                }
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

                // Cập nhật availableSlots
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
            //=====================================//

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
      r.entryTime = r.entryTime ? new Date(r.entryTime).toLocaleString("vi-VN") : "";
      r.exitTime = r.exitTime ? new Date(r.exitTime).toLocaleString("vi-VN") : "";
      r.createdAt = r.createdAt ? new Date(r.createdAt).toLocaleString("vi-VN") : "";
      r.updatedAt = r.updatedAt ? new Date(r.updatedAt).toLocaleString("vi-VN") : "";
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
        console.error("❌ Lỗi:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});

// API endpoints cho parking status
app.get('/api/parking-status', (req, res) => {
    res.json({
        ...currentStatus,
        availableSlots: currentStatus.availableSlots,  // ← THÊM COMMENT
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

// API endpoint cho việc điều khiển gate (HTTP fallback)
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
        
        // 🔥 Cập nhật local status
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

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Page not found',
        timestamp: new Date().toISOString()
    });
});

// Khởi động server với WebSocket support
server.listen(port, async () => {
    console.log(`🚀 RELIPARK Enhanced Server is running!`);
    console.log(`🌐 HTTP URL: http://localhost:${port}`);
    console.log(`🔌 WebSocket: ws://localhost:${port}`);
    
    // Đồng bộ với database
    await syncSlotsWithDatabase();
    
    // Cập nhật thời gian
    setInterval(() => {
        currentStatus.lastUpdate = new Date().toLocaleTimeString('vi-VN');
    }, 1000);
    
    console.log('✅ All systems initialized successfully!');
});