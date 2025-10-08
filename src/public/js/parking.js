// Hiện frame
function showFrame(id) {
  document.querySelectorAll('.screen').forEach(f => f.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Cập nhật ngày giờ
function updateTime() {
  const now = new Date();
  const dateString = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeString = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('currentDate').textContent = dateString;
  document.getElementById('currentTime').textContent = timeString;
}

setInterval(updateTime, 1000);
updateTime();

document.addEventListener("DOMContentLoaded", () => {
  const bookBtn = document.getElementById("bookBtn");

  bookBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const plate = document.getElementById("license_plate").value.trim();
    if (!plate) {
      alert("Vui lòng nhập biển số xe!");
      return;
    }

    try {
      const res = await fetch("/parking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_plate: plate })
      });

      const data = await res.json();
      if (res.ok) {
        alert(`Đặt chỗ thành công!\nMã đặt chỗ: ${data.bookingCode}`);
        // có thể redirect sang trang xác nhận
        window.location.href = "/confirm";
      } else {
        alert("Lỗi: " + data.message);
      }
    } catch (err) {
      console.error(err);
      alert("Không thể kết nối server!");
    }
  });
});

// ================== WebSocket cập nhật trạng thái chỗ đỗ ==================
const ws = new WebSocket("ws://localhost:4000"); // ⚠️ khi deploy nhớ đổi sang domain thật

ws.onopen = () => {
  console.log("✅ WebSocket connected");
  ws.send(JSON.stringify({ type: "web_client_connect" }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "status") {
    const status = msg.data;
    console.log("📡 Status update:", status);

    // Cập nhật text tổng số slot
    const availableText = document.getElementById("availableText");
    if (availableText) {
      availableText.innerText =
        `Chỗ khả dụng ${status.availableSlots}/${status.totalSlots}`;
    }

    // Map id slot -> index
    const slotMap = { A1: 0, A2: 1, A3: 2, A4: 3 };

    Object.keys(slotMap).forEach(slotId => {
      const idx = slotMap[slotId];
      const el = document.getElementById(`slot-${slotId}`);

      if (!el) return;

      // Remove previous classes
      el.classList.remove('available', 'occupied', 'reserved');

      if (status.slots[idx] === 0) {
        el.classList.add('available');
        el.style.backgroundColor = '#4CAF50'; // Xanh lá - trống
        el.style.color = 'white';
        el.disabled = false;
        el.style.cursor = 'pointer';
      } else if (status.slots[idx] === 1) {
        el.classList.add('occupied');
        el.style.backgroundColor = '#f44336'; // Đỏ - có xe
        el.style.color = 'white';
        el.disabled = true;
        el.style.cursor = 'not-allowed';
      } else if (status.slots[idx] === 2) {
        el.classList.add('reserved');
        el.style.backgroundColor = '#ff9800'; // Cam - đã đặt
        el.style.color = 'white';
        el.disabled = true;
        el.style.cursor = 'not-allowed';
      }
    });
  }

  // Xử lý thông báo ESP32 connect/disconnect
  if (msg.type === "esp32_connected") {
    console.log("ESP32 đã kết nối");
    showConnectionStatus(true);
  }
  
  if (msg.type === "esp32_disconnected") {
    console.log("ESP32 mất kết nối");
    showConnectionStatus(false);
  }
};

ws.onclose = () => {
  console.warn("WebSocket bị đóng");
  showConnectionStatus(false);
  
  // Thử kết nối lại sau 5 giây
  setTimeout(() => {
    location.reload();
  }, 5000);
};

ws.onerror = (err) => {
  console.error("WebSocket lỗi:", err);
  showConnectionStatus(false);
};

// Hiển thị trạng thái kết nối
function showConnectionStatus(connected) {
  let statusEl = document.getElementById('connectionStatus');
  
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'connectionStatus';
    statusEl.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: bold;
      z-index: 1000;
      transition: all 0.3s ease;
    `;
    document.body.appendChild(statusEl);
  }

  if (connected) {
    statusEl.textContent = '🟢 Đã kết nối';
    statusEl.style.backgroundColor = '#4CAF50';
    statusEl.style.color = 'white';
  } else {
    statusEl.textContent = '🔴 Mất kết nối';
    statusEl.style.backgroundColor = '#f44336';
    statusEl.style.color = 'white';
  }
}

// ================== Khởi tạo giao diện slot ==================
document.addEventListener("DOMContentLoaded", () => {
  // Khởi tạo màu sắc mặc định cho các slot
  const slotIds = ['A1', 'A2', 'A3', 'A4'];
  
  slotIds.forEach(slotId => {
    const slotElement = document.getElementById(`slot-${slotId}`);
    if (slotElement) {
      // Thiết lập style mặc định
      slotElement.style.backgroundColor = '#4CAF50'; // Xanh - mặc định là trống
      slotElement.style.color = 'white';
      slotElement.style.border = 'none';
      slotElement.style.padding = '10px';
      slotElement.style.margin = '5px';
      slotElement.style.borderRadius = '5px';
      slotElement.style.cursor = 'pointer';
      slotElement.style.transition = 'all 0.3s ease';
      slotElement.style.fontWeight = 'bold';
      
      // Thêm class mặc định
      slotElement.classList.add('available');
      
      // Event listener cho hover effect
      slotElement.addEventListener('mouseenter', () => {
        if (!slotElement.disabled && slotElement.classList.contains('available')) {
          slotElement.style.backgroundColor = '#45a049';
        }
      });
      
      slotElement.addEventListener('mouseleave', () => {
        if (slotElement.classList.contains('available')) {
          slotElement.style.backgroundColor = '#4CAF50';
        } else if (slotElement.classList.contains('occupied')) {
          slotElement.style.backgroundColor = '#f44336';
        } else if (slotElement.classList.contains('reserved')) {
          slotElement.style.backgroundColor = '#ff9800';
        }
      });
      
      // Event listener cho click (chỉ cho user thông thường - không đặt chỗ)
      slotElement.addEventListener('click', () => {
        if (slotElement.classList.contains('available')) {
          showSlotInfo(slotId, 'Chỗ này đang trống');
        } else if (slotElement.classList.contains('occupied')) {
          showSlotInfo(slotId, 'Chỗ này đã có xe');
        } else if (slotElement.classList.contains('reserved')) {
          showSlotInfo(slotId, 'Chỗ này đã được đặt trước');
        }
      });
    }
  });
});

// Hiển thị thông tin slot
function showSlotInfo(slotId, message) {
  // Tạo hoặc cập nhật thông báo
  let infoDiv = document.getElementById('slotInfo');
  
  if (!infoDiv) {
    infoDiv = document.createElement('div');
    infoDiv.id = 'slotInfo';
    infoDiv.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(infoDiv);
  }

  infoDiv.textContent = `${slotId}: ${message}`;
  infoDiv.style.opacity = '1';

  // Tự động ẩn sau 2 giây
  setTimeout(() => {
    infoDiv.style.opacity = '0';
  }, 2000);
}

// ================== Xử lý responsive ==================
// Ngăn double tap zoom trên mobile
document.addEventListener('touchend', function (e) {
  const now = (new Date()).getTime();
  if (now - lastTouchEnd <= 300) {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, false);

let lastTouchEnd = 0;

// Log để debug
console.log("📱 Parking.js đã được tải - User interface ready");

function parseVNDateTime(str) {
  // str: "20:00:55 25/9/2025"
  if (!str) return null;
  const [time, date] = str.split(' ');
  if (!time || !date) return null;
  const [hour, minute, second] = time.split(':').map(Number);
  const [day, month, year] = date.split('/').map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

document.addEventListener('DOMContentLoaded', function() {
  const lookupBtn = document.getElementById('lookupBtn');
  const lookupCode = document.getElementById('lookupCode');
  const lookupResult = document.getElementById('lookupResult');

  lookupBtn.addEventListener('click', async function() {
    const code = lookupCode.value.trim();
    if (!code) {
      lookupResult.innerHTML = '<span style="color:red">Vui lòng nhập mã vé!</span>';
      return;
    }
    lookupResult.innerHTML = 'Đang tra cứu...';
    try {
      const res = await fetch(`/api/manager/${code}`);
      if (!res.ok) throw new Error('Không tìm thấy mã vé');
      const data = await res.json();
      let fee = 0;
      if (data.createdAt) {
        // Tính số phút
        const start = parseVNDateTime(data.createdAt) ;
        const end = new Date(); 
        const minutes = Math.ceil((end - start) / (1000 * 60));
        const hours = Math.ceil(minutes / 60);
        // Tính phí
        fee = hours * 1000; // 1k/giờ
      }
      lookupResult.innerHTML = `
        <div>
          <strong>Thời gian đặt:</strong> ${data.createdAt || '-'}<br>
          <strong>Phí tạm tính:</strong> <span style="color:#e53935;font-weight:bold">${fee.toLocaleString()} VNĐ</span><br>
          <strong>Note:</strong> ${data.note || '-'}<br>
          <label for="lookupStatus">Trạng thái:</label>
          <select id="lookupStatus">
            <option value="pending" ${data.status === 'pending' ? 'selected' : ''}>pending</option>
            <option value="confirmed" ${data.status === 'confirmed' ? 'selected' : ''}>confirmed</option>
            <option value="cancelled" ${data.status === 'cancelled' ? 'selected' : ''}>cancelled</option>
          </select>
          <button id="updateLookupStatusBtn">Cập nhật</button>
        </div>
      `;
      // Gắn sự kiện cập nhật trạng thái ngay sau khi render
      const updateBtn = document.getElementById('updateLookupStatusBtn');
      if (updateBtn) {
        updateBtn.onclick = async function() {
          const newStatus = document.getElementById('lookupStatus').value;
          try {
            const res = await fetch(`/api/manager/${code}/status`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: newStatus })
            });
            const result = await res.json();
            if (res.ok) {
              alert("Cập nhật trạng thái thành công!");
              lookupBtn.click(); // reload lại thông tin
            } else {
              alert(result.message || "Lỗi cập nhật trạng thái");
            }
          } catch (err) {
            alert("Lỗi kết nối server");
          }
        }
      }
    } catch (err) {
      lookupResult.innerHTML = '<span style="color:red">Không tìm thấy mã vé hoặc lỗi server!</span>';
    }
  });
      setTimeout(() => {
        const updateBtn = document.getElementById('updateLookupStatusBtn');
        if (updateBtn) {
          console.log('Found update button');
          updateBtn.onclick = async function() {
            const newStatus = document.getElementById('lookupStatus').value;
            try {
              const res = await fetch(`/api/manager/${code}/status`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus })
              });
              const result = await res.json();
              if (res.ok) {
                alert("Cập nhật trạng thái thành công!");
                lookupBtn.click(); // reload lại thông tin
              } else {
                alert(result.message || "Lỗi cập nhật trạng thái");
              }
            } catch (err) {
              alert("Lỗi kết nối server");
            }
          }
        }
      }, 100);

});



