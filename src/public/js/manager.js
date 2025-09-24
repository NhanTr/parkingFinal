let ws;
let tempReservations = {}; // {slotId: {timer: timeoutId, endTime: timestamp}}

function initWebSocket(){
  ws = new WebSocket("ws://localhost:4000");

  ws.onopen = () => {
    console.log("✅ WebSocket connected (Manager)");
    // gửi tín hiệu báo đây là web client
    ws.send(JSON.stringify({ type: "web_client_connect" }));
  };
  
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    // Cập nhật trạng thái chỗ đỗ
    if (msg.type === "status" && msg.data) {
      const status = msg.data;
      console.log("📊 Cập nhật trạng thái:", status);

      // Cập nhật số chỗ khả dụng
      document.querySelector(".available-count").textContent =
        `Chỗ khả dụng: ${status.availableSlots}/${status.totalSlots}`;

      // Cập nhật trạng thái các nút A1..A4
      const slotBtns = document.querySelectorAll(".slot-btn");
      status.slots.forEach((s, i) => {
        const btn = slotBtns[i];
        if (!btn) return;

        // Remove all status classes first
        btn.classList.remove('available', 'occupied', 'reserved');
        
        if (s === 0) {
          btn.style.backgroundColor = "green";   // còn trống
          btn.classList.add('available');
          btn.disabled = false; // cho phép click
        } else if (s === 1) {
          btn.style.backgroundColor = "red";     // có xe
          btn.classList.add('occupied');
          btn.disabled = true; // không cho phép click
        } else if (s === 2) {
          btn.style.backgroundColor = "orange";  // đã giữ chỗ
          btn.classList.add('reserved');
          btn.disabled = true; // không cho phép click khi đã reserved
        }
      });

      // cập nhật trạng thái gate
      setGateStatus("gate1", status.entryGateOpen);
      setGateStatus("gate2", status.exitGateOpen);
    }

    // ====== Phản hồi đặt chỗ ======
    if (msg.type === "reserve_slot_response") {
      if (msg.success) {
        console.log("✅ Reserve slot success:", msg.message);
        showNotification(`Đã đặt chỗ ${msg.slotId} thành công! (30 giây)`, 'success');
      } else {
        console.warn("⚠️ Reserve slot failed:", msg.message);
        showNotification(`Không thể đặt chỗ ${msg.slotId}: ${msg.message}`, 'error');
      }
    }

    // ====== Phản hồi hủy đặt chỗ ======
    if (msg.type === "cancel_reservation_response") {
      if (msg.success) {
        console.log("✅ Cancel reservation success:", msg.message);
        showNotification(`Đã hủy đặt chỗ ${msg.slotId}`, 'success');
      } else {
        console.warn("⚠️ Cancel reservation failed:", msg.message);
        showNotification(`Không thể hủy đặt chỗ ${msg.slotId}: ${msg.message}`, 'error');
      }
    }

    // ====== Phản hồi điều khiển cổng ======
    if (msg.type === "gate_control_response") {
      if (msg.success) {
        console.log("✅ Gate response:", msg.message);
      } else {
        console.warn("⚠️ Gate error:", msg.message);
      }
    }

    // ====== ESP32 connect/disconnect ======
    if (msg.type === "esp32_connected") {
      console.log("🔌 ESP32 online");
      showNotification("ESP32 đã kết nối", 'success');
    }
    if (msg.type === "esp32_disconnected") {
      console.log("❌ ESP32 offline");
      showNotification("ESP32 mất kết nối", 'warning');
    }
  };

  ws.onclose = () => {
    console.warn("⚠️ WebSocket closed, reconnecting...");
    setTimeout(initWebSocket, 2000);
  };

  ws.onerror = (err) => {
    console.error("❌ WebSocket error:", err);
  };
}

initWebSocket();

// ======================= Chức năng đặt chỗ =======================
function reserveSlot(slotId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showNotification("⚠️ Mất kết nối WebSocket!", 'error');
    return;
  }

  // Kiểm tra trạng thái slot trước khi đặt
  const slotIndex = getSlotIndex(slotId);
  const slotBtn = document.querySelectorAll(".slot-btn")[slotIndex];
  
  if (!slotBtn || slotBtn.classList.contains('occupied') || slotBtn.classList.contains('reserved')) {
    showNotification(`Chỗ ${slotId} không khả dụng để đặt`, 'warning');
    return;
  }

  ws.send(JSON.stringify({
    type: "reserve_slot",
    slotId: slotId
  }));

  console.log("🎯 Sent reserve slot request:", slotId);
  showNotification(`Đang đặt chỗ ${slotId}...`, 'info');
}

function cancelReservation(slotId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showNotification("⚠️ Mất kết nối WebSocket!", 'error');
    return;
  }

  ws.send(JSON.stringify({
    type: "cancel_reservation",
    slotId: slotId
  }));

  console.log("❌ Sent cancel reservation request:", slotId);
}

// Helper function để lấy slot index
function getSlotIndex(slotId) {
  const map = { 'A1': 0, 'A2': 1, 'A3': 2, 'A4': 3 };
  return map[slotId] || 0;
}

// ======================= Hiển thị thông báo =======================
function showNotification(message, type = 'info') {
  // Tạo element notification nếu chưa có
  let notification = document.getElementById('notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 8px;
      color: white;
      font-weight: bold;
      z-index: 1000;
      max-width: 300px;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s ease;
    `;
    document.body.appendChild(notification);
  }

  // Set màu theo loại thông báo
  const colors = {
    success: '#4CAF50',
    error: '#F44336', 
    warning: '#FF9800',
    info: '#2196F3'
  };

  notification.style.backgroundColor = colors[type] || colors.info;
  notification.textContent = message;
  
  // Show animation
  setTimeout(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateX(0)';
  }, 100);

  // Hide animation
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
  }, 3000);
}

// ======================= Cập nhật giao diện =======================
function setGateStatus(gateId, isOpen) {
  const gateEl = document.getElementById(
    gateId === "gate1" ? "gateSwitch1" : "gateSwitch2"
  );
  if (!gateEl) return;

  if (isOpen) gateEl.classList.add("active");
  else gateEl.classList.remove("active");
}

// ======================= Điều khiển gate =======================
function toggleGate(gateId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showNotification("⚠️ Mất kết nối WebSocket!", 'error');
    return;
  }

  ws.send(JSON.stringify({
    type: "gate_control",
    gateId: gateId
  }));

  console.log("🚪 Sent gate control:", gateId);
}

// Gắn sự kiện click cho gateSwitch và slot buttons
document.addEventListener("DOMContentLoaded", () => {
  const gate1 = document.getElementById("gateSwitch1");
  const gate2 = document.getElementById("gateSwitch2");

  if (gate1) gate1.addEventListener("click", () => toggleGate("gate1"));
  if (gate2) gate2.addEventListener("click", () => toggleGate("gate2"));

  // Gắn sự kiện click cho các slot buttons
  const slotBtns = document.querySelectorAll(".slot-btn");
  slotBtns.forEach((btn, index) => {
    const slotId = ['A1', 'A2', 'A3', 'A4'][index];
    
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      
      if (btn.classList.contains('available')) {
        // Slot trống - đặt chỗ
        reserveSlot(slotId);
      } else if (btn.classList.contains('reserved')) {
        // Slot đã đặt - hỏi có muốn hủy không
        if (confirm(`Bạn có muốn hủy đặt chỗ ${slotId}?`)) {
          cancelReservation(slotId);
        }
      } else if (btn.classList.contains('occupied')) {
        // Slot đã có xe - không làm gì
        showNotification(`Chỗ ${slotId} đã có xe, không thể thao tác`, 'warning');
      }
    });

    // Thêm cursor pointer cho available slots
    btn.style.cursor = 'pointer';
  });
});

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

// Tìm kiếm mã vé
async function searchBooking() {
  const code = document.getElementById("searchCode").value.trim();
  if (!code) return alert("Nhập mã vé trước");

  try {
    const res = await fetch(`/api/manager/${code}`);
    if (!res.ok) throw new Error("Không tìm thấy mã này");
    const booking = await res.json();

    document.getElementById("searchResult").innerHTML = `
      <p><strong>Mã vé:</strong> ${booking.bookingCode}</p>
      <p><strong>Khách hàng:</strong> ${booking.userId.fullname}</p>
      <p><strong>Biển số:</strong> ${booking.license_plate}</p>
      <p><strong>Ngày đặt:</strong> ${booking.createdAt}</p>
    `;
  } catch (err) {
    document.getElementById("searchResult").innerHTML = `<p style="color:red">${err.message}</p>`;
  }
}

async function deleteBooking() {
  const code = document.getElementById("searchCode").value.trim();
  if (!code) return alert("Nhập mã vé trước");

  if (!confirm(`Bạn có chắc muốn xóa mã vé ${code}?`)) return;

  try {
    const res = await fetch(`/api/manager/${code}`, { method: "DELETE" });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message);

    alert("✅ " + data.message);
    location.reload(); // tải lại trang để cập nhật danh sách
  } catch (err) {
    alert("❌ " + err.message);
  }
}