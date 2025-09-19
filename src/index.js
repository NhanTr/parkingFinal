const express = require('express')
const app = express()
const path = require('path');
const port = 3000
const { create, engine } = require('express-handlebars');
const session = require('express-session');
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
var morgan = require('morgan')
require('dotenv').config();


const Booking = require("./booking");
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const User = require('./user');
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
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

console.log("PATH: ", path.join(__dirname, 'views'))


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
  res.render('confirm', { user: req.session.user, bookingCode: req.session.bookingCode });
})
// API đăng ký
app.post('/register', async (req, res) => {
  try {
    const { fullname, email, phone, password, plate } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ fullname, email, phone, password: hashedPassword, plate });
    await newUser.save();
    
    res.status(201).json({ message: 'Đăng ký thành công' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: 'Lỗi khi đăng ký', error: error.message });
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
      return res.status(401).json({ message: "Chưa đăng nhập" });
    }

    const { license_plate } = req.body;
    if (!license_plate) return res.status(400).json({ message: "Thiếu biển số xe" });

    const bookingCode = await generateUniqueCode();

    const newBooking = new Booking({
      userId: req.session.user.id,
      license_plate,
      bookingCode
    });

    await newBooking.save();


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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
