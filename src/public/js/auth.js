let currentRole = "user";

document.addEventListener("DOMContentLoaded", () => {
  setupPasswordToggle();
  setupRoleSwitch();
});

// Ẩn/hiện mật khẩu
function setupPasswordToggle() {
  const eyeIcons = document.querySelectorAll(
    '.form-group img[src*="eye.png"], .form-group img[src*="hidden.png"]'
  );

  eyeIcons.forEach(icon => {
    if (!icon.hasAttribute("data-toggle-bound")) {
      icon.setAttribute("data-toggle-bound", "true");
      icon.addEventListener("click", function () {
        const input = this.closest(".form-group").querySelector("input");
        input.type = input.type === "password" ? "text" : "password";
        this.src = input.type === "password"
          ? "img/hidden.png"
          : "img/eye.png";
      });
    }
  });
}

// Chuyển giữa user/admin
function setupRoleSwitch() {
  const userBtn = document.getElementById("userBtn");
  const adminBtn = document.getElementById("adminBtn");
  if (!userBtn || !adminBtn) return; // trên trang register thì không có

  userBtn.addEventListener("click", () => {
    userBtn.classList.add("active");
    adminBtn.classList.remove("active");
    currentRole = "user";
  });

  adminBtn.addEventListener("click", () => {
    adminBtn.classList.add("active");
    userBtn.classList.remove("active");
    currentRole = "admin";
  });
}



// Xử lý register
async function handleRegister(event) {
  event.preventDefault(); // ngăn reload trang

  // Lấy dữ liệu từ form
  const fullname = document.querySelector('[name="fullname"]').value.trim();
  const email = document.querySelector('[name="email"]').value.trim();
  const phone = document.querySelector('[name="phone"]').value.trim();
  const password = document.querySelector('[name="password"]').value.trim();
  const plate = document.querySelector('[name="plate"]').value.trim();

  try {
    const res = await fetch('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fullname, email, phone, password, plate })
    });

    const data = await res.json();

    if (res.ok) {
      alert("✅ Đăng ký thành công!");
      window.location.href = "/"; // sau khi đăng ký thì về trang home/login
    } else {
      console.error("❌ Lỗi khi đăng ký:", data);
      alert("❌ Lỗi khi đăng ký: " + (data.error || data.message));
    }
  } catch (err) {
    console.error("❌ Lỗi kết nối server:", err);
    alert("❌ Không thể kết nối server!");
  }
}
document.querySelector("form").addEventListener("submit", async function(e) {
  e.preventDefault();

  const data = {
    fullname: document.querySelector("#fullname").value,
    email: document.querySelector("#email").value,
    phone: document.querySelector("#phone").value,
    password: document.querySelector("#password").value,
    plate: document.querySelector("#plate").value
  };

  const res = await fetch("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  const result = await res.json();
  alert(result.message);
});

async function handleLogin(event) {
  event.preventDefault(); // ngăn reload trang

  // Lấy dữ liệu từ form
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  // login manager
  if (currentRole === "admin") {
    if (email === "admin" && password === "admin") {
      localStorage.setItem("token", "admin-token");
      alert("Đăng nhập quản lý thành công!");
      window.location.href = "/manager";
      return;
    } else {
      alert("Sai tài khoản hoặc mật khẩu quản lý!");
      return;
    }
  }
  
  // login user
  const res = await fetch("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();
  if (res.ok) {
    localStorage.setItem("token", data.token);
    alert("Đăng nhập thành công!");
    window.location.href = "/parking";
  } else {
    alert(data.message);
  }
}

async function loadUserInfo() {
    const token = localStorage.getItem("token");
    if (!token) {
      alert("Bạn chưa đăng nhập!");
      window.location.href = "/";
      return;
    }

    const res = await fetch("/parking", {
      headers: { Authorization: "Bearer " + token }
    });

    const data = await res.json();
    if (res.ok) {
      document.getElementById("welcomeName").textContent = data.fullname;
      document.getElementById("plateNumber").textContent = data.plate;
    } else {
      alert("Phiên đăng nhập hết hạn, hãy login lại");
      localStorage.removeItem("token");
      window.location.href = "/";
    }
}