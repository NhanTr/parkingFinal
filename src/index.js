const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const app = express()
const path = require('path');
const port = 4000
const { create, engine } = require('express-handlebars');
const session = require('express-session');
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
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
    // Specify helpers which are only registered on this instance.
    helpers: {
        foo() { return 'FOO!'; },
        bar() { return 'BAR!'; }
    }
});
app.use(express.static(path.join(__dirname, "public")));
app.use(morgan('combined'))

app.use(session({
  secret: process.env.SESSION_SECRET,   // nên để env
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }  // nếu HTTPS thì để true
}));

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
    entryGateOpen: false,
    exitGateOpen: false,
    lastUpdate: new Date().toLocaleTimeString('vi-VN'),
    isAdminMode: false,
    isKeypadMode: true,
    slots: [0, 0, 0, 0]  // 0: available, 1: occupied, 2: reserved
};

// Hàm helper để broadcast tin nhắn tới tất cả web clients
function broadcastToWebClients(message) {
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

function sendStatusUpdateToESP32() {
    if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
        const statusUpdate = {
            type: 'status_update',
            data: {
                availableSlots: currentStatus.availableSlots,
                totalSlots: currentStatus.totalSlots,
                slots: currentStatus.slots,
                entryGateOpen: currentStatus.entryGateOpen,
                exitGateOpen: currentStatus.exitGateOpen,
                isAdminMode: currentStatus.isAdminMode,
                isKeypadMode: currentStatus.isKeypadMode,
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

// WebSocket Server
wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log('Received from client:', data);

            // Nếu là ESP32 kết nối
            if (data.type === 'esp32_connect') {
                esp32Connection = ws;
                console.log('ESP32 connected successfully');

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

                // Cập nhật availableSlots dựa trên slots
                currentStatus.availableSlots = currentStatus.slots.filter(s => s === 0).length;

                // Cập nhật các trường khác
                if (statusData.totalSlots !== undefined) currentStatus.totalSlots = statusData.totalSlots;
                if (statusData.entryGateOpen !== undefined) currentStatus.entryGateOpen = statusData.entryGateOpen;
                if (statusData.exitGateOpen !== undefined) currentStatus.exitGateOpen = statusData.exitGateOpen;
                if (statusData.lastUpdate !== undefined) currentStatus.lastUpdate = statusData.lastUpdate;
                if (statusData.isAdminMode !== undefined) currentStatus.isAdminMode = statusData.isAdminMode;
                if (statusData.isKeypadMode !== undefined) currentStatus.isKeypadMode = statusData.isKeypadMode;

                console.log('📄 Updated current status:', {
                    availableSlots: currentStatus.availableSlots,
                    totalSlots: currentStatus.totalSlots,
                    slots: currentStatus.slots,
                    gates: {
                        entry: currentStatus.entryGateOpen,
                        exit: currentStatus.exitGateOpen
                    },
                    modes: {
                        admin: currentStatus.isAdminMode,
                        keypad: currentStatus.isKeypadMode
                    }
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
                currentStatus.availableSlots = currentStatus.slots.filter(s => s === 0).length;

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

            // Xử lý trạng thái keypad từ ESP32
            if (data.type === 'keypadStatus' || data.type === 'keypad_status') {
                console.log('⌨️ Received keypad status from ESP32:', data);
                
                const keypadData = data.data || data;
                if (keypadData.isKeypadMode !== undefined) {
                    currentStatus.isKeypadMode = keypadData.isKeypadMode;
                }
                if (keypadData.isAdminMode !== undefined) {
                    currentStatus.isAdminMode = keypadData.isAdminMode;
                }

                broadcastToWebClients({
                    type: 'keypadStatus',
                    data: keypadData,
                    timestamp: new Date().toISOString()
                });
                console.log('✅ Keypad status broadcasted');
            }

            // Xử lý yêu cầu đặt chỗ từ manager.js
            if (data.type === 'reserve_slot') {
                const slotId = data.slotId;  // e.g., 'A1'
                const index = getSlotIndex(slotId);
                if (index !== -1 && currentStatus.slots[index] === 0) {
                    currentStatus.slots[index] = 2;  // Set reserved
                    currentStatus.availableSlots = currentStatus.slots.filter(s => s === 0).length;

                    console.log(`✅ Reserved slot ${slotId} (index ${index})`);

                    // Send immediate status update to ESP32
                    const statusSent = sendStatusUpdateToESP32();

                    // Gửi thông báo reservation đến ESP32
                    if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                        esp32Connection.send(JSON.stringify({
                            type: 'slot_reservation',
                            data: {
                                slotId: slotId,
                                index: index,
                                action: 'reserve',
                                availableSlots: currentStatus.availableSlots,
                                totalSlots: currentStatus.totalSlots,
                                duration: 30 // thời gian hiển thị reservation (30 giây)
                            },
                            timestamp: new Date().toISOString()
                        }));
                        console.log(`📱 Sent reservation notification to ESP32: ${slotId}`);
                    }

                    // Broadcast trạng thái mới
                    broadcastToWebClients({
                        type: 'status',
                        data: currentStatus,
                        timestamp: new Date().toISOString()
                    });

                    // Response thành công về cho web client
                    ws.send(JSON.stringify({
                        type: 'reserve_slot_response',
                        success: true,
                        message: `Slot ${slotId} reserved successfully`,
                        slotId: slotId,
                        availableSlots: currentStatus.availableSlots,
                        timestamp: new Date().toISOString()
                    }));

                    // Timer hết hạn 30 giây
                    setTimeout(() => {
                        if (currentStatus.slots[index] === 2) {
                            currentStatus.slots[index] = 0;
                            currentStatus.availableSlots = currentStatus.slots.filter(s => s === 0).length;
                            console.log(`⏰ Reservation expired for slot ${slotId}`);
                            
                            // Send status update when reservation expires
                            sendStatusUpdateToESP32();
                            
                            // Thông báo hết hạn đến ESP32
                            if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                                esp32Connection.send(JSON.stringify({
                                    type: 'slot_reservation',
                                    data: {
                                        slotId: slotId,
                                        index: index,
                                        action: 'expire',
                                        availableSlots: currentStatus.availableSlots,
                                        totalSlots: currentStatus.totalSlots
                                    },
                                    timestamp: new Date().toISOString()
                                }));
                                console.log(`📱 Sent reservation expiry to ESP32: ${slotId}`);
                            }
                            
                            broadcastToWebClients({
                                type: 'status',
                                data: currentStatus,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }, 30000);
                } else {
                    console.log(`⚠️ Cannot reserve slot ${slotId}: not available`);
                    ws.send(JSON.stringify({
                        type: 'reserve_slot_response',
                        success: false,
                        message: `Slot ${slotId} not available`,
                        slotId: slotId,
                        timestamp: new Date().toISOString()
                    }));
                }
            }

            // Xử lý hủy reservation
            if (data.type === 'cancel_reservation') {
                const slotId = data.slotId;
                const index = getSlotIndex(slotId);
                if (index !== -1 && currentStatus.slots[index] === 2) {
                    currentStatus.slots[index] = 0;
                    currentStatus.availableSlots = currentStatus.slots.filter(s => s === 0).length;

                    console.log(`❌ Cancelled reservation for slot ${slotId}`);

                    // Send immediate status update to ESP32
                    sendStatusUpdateToESP32();

                    // Gửi thông báo hủy đến ESP32
                    if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                        esp32Connection.send(JSON.stringify({
                            type: 'slot_reservation',
                            data: {
                                slotId: slotId,
                                index: index,
                                action: 'cancel',
                                availableSlots: currentStatus.availableSlots,
                                totalSlots: currentStatus.totalSlots
                            },
                            timestamp: new Date().toISOString()
                        }));
                    }

                    broadcastToWebClients({
                        type: 'status',
                        data: currentStatus,
                        timestamp: new Date().toISOString()
                    });

                    ws.send(JSON.stringify({
                        type: 'cancel_reservation_response',
                        success: true,
                        message: `Slot ${slotId} reservation cancelled`,
                        slotId: slotId,
                        availableSlots: currentStatus.availableSlots,
                        timestamp: new Date().toISOString()
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'cancel_reservation_response',
                        success: false,
                        message: `No reservation found for slot ${slotId}`,
                        slotId: slotId,
                        timestamp: new Date().toISOString()
                    }));
                }
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
    console.log("Booking saved to DB!");

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
    res.render("manager", { bookings });
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

    res.json({ message: "Xóa thành công", deleted: result });
  } catch (err) {
    console.error("❌ Lỗi xóa booking:", err);
    res.status(500).json({ message: "Lỗi server" });
  }
});

// ============ NEW API ENDPOINTS FROM SERVER.JS ============

// API endpoints cho parking status
app.get('/api/parking-status', (req, res) => {
    res.json({
        ...currentStatus,
        esp32Connected: esp32Connection !== null && esp32Connection.readyState === WebSocket.OPEN,
        webClients: webClients.size,
        timestamp: new Date().toISOString()
    });
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

        esp32Connection.send(JSON.stringify({
            type: 'control',
            data: {
                action: 'toggle_gate',
                gateId: actualGateId
            },
            timestamp: new Date().toISOString()
        }));
        
        res.json({ 
            success: true, 
            message: `Gate ${gateId} command sent to ESP32`,
            gateId: gateId,
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

// API endpoint cho việc reserve slot (HTTP fallback)
app.post('/api/reserve-slot', (req, res) => {
    const { slotId } = req.body;
    console.log(`🎯 HTTP Reserve slot request: ${slotId}`);
    
    const index = getSlotIndex(slotId);
    if (index !== -1 && currentStatus.slots[index] === 0) {
        currentStatus.slots[index] = 2;  // Set reserved
        currentStatus.availableSlots = currentStatus.slots.filter(s => s === 0).length;

        console.log(`✅ Reserved slot ${slotId} (index ${index})`);

        // Send status update to ESP32
        sendStatusUpdateToESP32();

        // Gửi thông báo reservation đến ESP32
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'slot_reservation',
                data: {
                    slotId: slotId,
                    index: index,
                    action: 'reserve',
                    availableSlots: currentStatus.availableSlots,
                    totalSlots: currentStatus.totalSlots,
                    duration: 30
                },
                timestamp: new Date().toISOString()
            }));
            console.log(`📱 Sent reservation notification to ESP32: ${slotId}`);
        }

        // Broadcast trạng thái mới
        broadcastToWebClients({
            type: 'status',
            data: currentStatus,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `Slot ${slotId} reserved successfully`,
            slotId: slotId,
            availableSlots: currentStatus.availableSlots,
            timestamp: new Date().toISOString()
        });

        // Timer hết hạn 30 giây
        setTimeout(() => {
            if (currentStatus.slots[index] === 2) {
                currentStatus.slots[index] = 0;
                currentStatus.availableSlots = currentStatus.slots.filter(s => s === 0).length;
                console.log(`⏰ Reservation expired for slot ${slotId}`);
                
                sendStatusUpdateToESP32();
                
                if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
                    esp32Connection.send(JSON.stringify({
                        type: 'slot_reservation',
                        data: {
                            slotId: slotId,
                            index: index,
                            action: 'expire',
                            availableSlots: currentStatus.availableSlots,
                            totalSlots: currentStatus.totalSlots
                        },
                        timestamp: new Date().toISOString()
                    }));
                    console.log(`📱 Sent reservation expiry to ESP32: ${slotId}`);
                }
                
                broadcastToWebClients({
                    type: 'status',
                    data: currentStatus,
                    timestamp: new Date().toISOString()
                });
            }
        }, 30000);
    } else {
        console.log(`⚠️ Cannot reserve slot ${slotId}: not available`);
        res.json({
            success: false,
            message: `Slot ${slotId} not available`,
            slotId: slotId,
            timestamp: new Date().toISOString()
        });
    }
});

// API endpoint cho việc cancel reservation
app.post('/api/cancel-reservation', (req, res) => {
    const { slotId } = req.body;
    console.log(`❌ HTTP Cancel reservation request: ${slotId}`);
    
    const index = getSlotIndex(slotId);
    if (index !== -1 && currentStatus.slots[index] === 2) {
        currentStatus.slots[index] = 0;
        currentStatus.availableSlots = currentStatus.slots.filter(s => s === 0).length;

        console.log(`❌ Cancelled reservation for slot ${slotId}`);

        sendStatusUpdateToESP32();

        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
            esp32Connection.send(JSON.stringify({
                type: 'slot_reservation',
                data: {
                    slotId: slotId,
                    index: index,
                    action: 'cancel',
                    availableSlots: currentStatus.availableSlots,
                    totalSlots: currentStatus.totalSlots
                },
                timestamp: new Date().toISOString()
            }));
        }

        broadcastToWebClients({
            type: 'status',
            data: currentStatus,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: `Slot ${slotId} reservation cancelled`,
            slotId: slotId,
            availableSlots: currentStatus.availableSlots,
            timestamp: new Date().toISOString()
        });
    } else {
        res.json({
            success: false,
            message: `No reservation found for slot ${slotId}`,
            slotId: slotId,
            timestamp: new Date().toISOString()
        });
    }
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
server.listen(port, () => {
    console.log(`🚀 RELIPARK Enhanced Server is running!`);
    console.log(`🌐 HTTP URL: http://localhost:${port}`);
    console.log(`🔌 WebSocket: ws://localhost:${port}`);
    
    // Cập nhật thời gian mỗi giây
    setInterval(() => {
        currentStatus.lastUpdate = new Date().toLocaleTimeString('vi-VN');
    }, 1000);
    
    console.log('✅ All systems initialized successfully!');
})