async function updateBookingStatus(bookingCode, newStatus) {
  try {
    const response = await fetch(`/api/manager/${bookingCode}/status`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: newStatus })
    });
    const result = await response.json();
    if (response.ok) {
      alert("Cập nhật thành công!");
      location.reload();
    } else {
      alert(result.message || "Lỗi cập nhật trạng thái");
    }
  } catch (err) {
    alert("Lỗi kết nối server");
  }
}

let ws;
let tempReservations = {};
let cameraOnline = false;

// Format Vietnam time
function formatVietnamTime(dateString) {
  if (!dateString || dateString === '-') return '-';
  
  const date = new Date(dateString);
  
  if (isNaN(date.getTime())) return '-';
  
  const options = {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  
  const formatter = new Intl.DateTimeFormat('en-GB', options);
  const parts = formatter.formatToParts(date);
  
  const getValue = (type) => parts.find(p => p.type === type)?.value || '';
  
  return `${getValue('hour')}:${getValue('minute')}:${getValue('second')} ${getValue('day')}/${getValue('month')}/${getValue('year')}`;
}

function formatAllDates() {
  const bookingTable = document.querySelector('.parking-history table tbody');
  if (bookingTable) {
    const rows = bookingTable.querySelectorAll('tr');
    rows.forEach(row => {
      const dateCell = row.cells[3];
      if (dateCell) {
        const originalDate = dateCell.textContent.trim();
        dateCell.textContent = formatVietnamTime(originalDate);
      }
    });
  }
  
  const rfidTable = document.querySelector('.rfid-access-history table tbody');
  if (rfidTable) {
    const rows = rfidTable.querySelectorAll('tr');
    rows.forEach(row => {
      const entryCell = row.cells[7];
      if (entryCell) {
        const originalDate = entryCell.textContent.trim();
        entryCell.textContent = formatVietnamTime(originalDate);
      }
      
      const updateCell = row.cells[8];
      if (updateCell) {
        const originalDate = updateCell.textContent.trim();
        updateCell.textContent = formatVietnamTime(originalDate);
      }
    });
  }
}

function initWebSocket(){
  ws = new WebSocket("ws://localhost:4000");

  ws.onopen = () => {
    console.log("✅ WebSocket connected (Manager)");
    ws.send(JSON.stringify({ type: "web_client_connect" }));
  };
  
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    // Camera status
    if (msg.type === "camera_connected") {
      cameraOnline = true;
      console.log("📷 Camera online");
      showNotification("Camera hệ thống đã kết nối", 'success');
      updateCameraStatus(true);
    }

    // Status update
    if (msg.type === "status" && msg.data) {
      const status = msg.data;
      console.log("📊 Status update:", status);
      
      document.querySelector(".available-count").textContent =
        `Chỗ khả dụng: ${status.availableSlots}/${status.totalSlots}`;

      const slotBtns = document.querySelectorAll(".slot-btn");
      status.slots.forEach((s, i) => {
        const btn = slotBtns[i];
        if (!btn) return;

        btn.classList.remove('available', 'occupied', 'reserved');
        
        if (s === 0) {
          btn.style.backgroundColor = "green";
          btn.classList.add('available');
          btn.disabled = false;
        } else if (s === 1) {
          btn.style.backgroundColor = "red";
          btn.classList.add('occupied');
          btn.disabled = true;
        } else if (s === 2) {
          btn.style.backgroundColor = "orange";
          btn.classList.add('reserved');
          btn.disabled = true;
        }
      });

      setGateStatus("gate1", status.entryGateOpen);
      setGateStatus("gate2", status.exitGateOpen);
    }

    // RFID Entry with image
    if (msg.type === "rfid_entry") {
      const { rfidCode, licensePlate, imageUrl, entryTime } = msg.data;
      console.log("🚗 RFID Entry:", rfidCode, licensePlate);
        
        showNotification(
            `✅ Xe vào: ${licensePlate || rfidCode}\n${imageUrl ? '📸 Đã chụp ảnh' : '⚠️ Không có ảnh'}`, 
            'success'
        );
        // ✅ Auto refresh manager table sau 2 giây
        setTimeout(() => {
            location.reload();
        }, 2000);
    }

    // RFID Exit with image
    if (msg.type === "rfid_exit") {
        const { rfidCode, licensePlate, fee, duration, plateMatch, imageUrl } = msg.data;
        
        console.log("🚙 RFID Exit:", rfidCode, licensePlate, fee);
        
        if (plateMatch === false) {
            showNotification(
                `🚨 CẢNH BÁO: Biển số không khớp!\nRFID: ${rfidCode}`, 
                'error'
            );
            playAlertSound();
        } else {
            showNotification(
                `Xe ra: ${licensePlate || rfidCode}\nPhí: ${fee}đ (${duration}p)\n${imageUrl ? '📸 Đã chụp ảnh' : ''}`, 
                'success'
            );
        }
        
        // Auto refresh manager table sau 2 giây
        setTimeout(() => {
            location.reload();
        }, 2000);
    }

    if (msg.type === "parking_full") {
        showNotification('BÃI ĐẦY - Không thể vào thêm xe', 'warning');
        playAlertSound();
    }

    // Security Alert
    if (msg.type === "security_alert") {
      const { alertType, rfidCode, entryPlate, exitPlate } = msg.data;
      
      if (alertType === "PLATE_MISMATCH") {
        showNotification(
          `🚨 CẢNH BÁO: Biển số không khớp!\nVào: ${entryPlate}\nRa: ${exitPlate}`, 
          'error'
        );
        
        // Add to security alerts section
        addSecurityAlert({
          rfidCode,
          entryPlate,
          exitPlate,
          timestamp: new Date(),
          timestamp: new Date(),
          action: action || 'EXIT_DENIED'
        });
        
        // Play alert sound
        playAlertSound();
      }
    }

    // Gate control response
    if (msg.type === "gate_control_response") {
      if (msg.success) {
        console.log("✅ Gate response:", msg.message);
      } else {
        console.warn("⚠️ Gate error:", msg.message);
      }
    }

    // ESP32 connect/disconnect
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

function autoRefreshImages() {
    setInterval(() => {
        // Check if on manager page with RFID table
        const rfidTable = document.querySelector('.rfid-access-history');
        if (rfidTable) {
            console.log('🔄 Auto-refreshing RFID table...');
            
            // Soft reload: chỉ reload nếu có data mới
            fetch('/api/parking-status')
                .then(res => res.json())
                .then(data => {
                    // Kiểm tra có cập nhật mới không
                    const lastUpdate = localStorage.getItem('lastRfidUpdate');
                    const currentUpdate = data.timestamp;
                    
                    if (lastUpdate !== currentUpdate) {
                        console.log('📊 New data available, refreshing...');
                        localStorage.setItem('lastRfidUpdate', currentUpdate);
                        location.reload();
                    }
                })
                .catch(err => console.error('Auto-refresh error:', err));
        }
    }, 30000); // Mỗi 30 giây
}

// Camera status indicator
function updateCameraStatus(online) {
  let indicator = document.getElementById('cameraStatus');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'cameraStatus';
    indicator.style.cssText = `
      position: fixed;
      top: 70px;
      right: 20px;
      padding: 8px 15px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: bold;
      z-index: 999;
    `;
    document.body.appendChild(indicator);
  }
  
  if (online) {
    indicator.textContent = '📷 Camera Online';
    indicator.style.backgroundColor = '#4CAF50';
    indicator.style.color = 'white';
  } else {
    indicator.textContent = '📷 Camera Offline';
    indicator.style.backgroundColor = '#F44336';
    indicator.style.color = 'white';
  }
}

// Add security alert to UI
function addSecurityAlert(alert) {
  const alertsDiv = document.getElementById('securityAlerts');
  if (!alertsDiv) {
    const newDiv = document.createElement('div');
    newDiv.id = 'securityAlerts';
    newDiv.style.cssText = `
      position: fixed;
      top: 120px;
      right: 20px;
      max-width: 400px;
      z-index: 1000;
    `;
    document.body.appendChild(newDiv);
  }
  
  const alertElement = document.createElement('div');
  alertElement.className = 'security-alert';
  alertElement.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
      <span style="font-size: 30px;">🚨</span>
      <strong style="font-size: 18px;">CẢNH BÁO BẢO MẬT</strong>
    </div>
    <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 5px; margin-bottom: 10px;">
      <div><strong>RFID:</strong> ${alert.rfidCode}</div>
      <div><strong>Biển số vào:</strong> <span style="color: #90EE90">${alert.entryPlate}</span></div>
      <div><strong>Biển số ra:</strong> <span style="color: #FFB6C1">${alert.exitPlate}</span></div>
      <div><strong>Thời gian:</strong> ${alert.timestamp.toLocaleString('vi-VN')}</div>
      <div style="margin-top: 10px; padding: 8px; background: rgba(255,255,255,0.2); border-radius: 5px;">
        <strong>⛔ TRẠNG THÁI: ${alert.action || 'EXIT_DENIED'}</strong>
      </div>
    </div>
    <button onclick="resolveAlert(this)" style="
      width: 100%;
      padding: 10px;
      background: white;
      color: #cc0000;
      border: none;
      border-radius: 5px;
      font-weight: bold;
      cursor: pointer;
      font-size: 14px;
    ">Đã xử lý</button>
  `;
  
  const alertsContainer = document.getElementById('securityAlerts');
  alertsContainer.insertBefore(alertElement, alertsContainer.firstChild);
  
  if (!document.getElementById('alertAnimationStyle')) {
    const style = document.createElement('style');
    style.id = 'alertAnimationStyle';
    style.textContent = `
      @keyframes alertPulse {
        0%, 100% { box-shadow: 0 4px 20px rgba(255, 0, 0, 0.5); }
        50% { box-shadow: 0 4px 30px rgba(255, 0, 0, 0.9); }
      }
    `;
    document.head.appendChild(style);
  }
}

// Resolve security alert
function resolveAlert(button) {
  const alertElement = button.closest('.security-alert');
  alertElement.style.opacity = '0';
  setTimeout(() => alertElement.remove(), 300);
}

// Play alert sound
function playAlertSound() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.value = 800;
  oscillator.type = 'sine';
  gainNode.gain.value = 0.3;
  
  oscillator.start();
  setTimeout(() => oscillator.stop(), 200);
  setTimeout(() => {
    oscillator.start();
    setTimeout(() => oscillator.stop(), 200);
  }, 300);
}

// Show notification
function showNotification(message, type = 'info') {
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
      white-space: pre-line;
    `;
    document.body.appendChild(notification);
  }

  const colors = {
    success: '#4CAF50',
    error: '#F44336', 
    warning: '#FF9800',
    info: '#2196F3'
  };

  notification.style.backgroundColor = colors[type] || colors.info;
  notification.textContent = message;
  
  setTimeout(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateX(0)';
  }, 100);

  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
  }, 5000);
}

// Set gate status
function setGateStatus(gateId, isOpen) {
  const gateEl = document.getElementById(
    gateId === "gate1" ? "gateSwitch1" : "gateSwitch2"
  );
  if (!gateEl) return;

  if (isOpen) gateEl.classList.add("active");
  else gateEl.classList.remove("active");
}

// Toggle gate
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

// Image modal
function showImageModal(imageUrl) {
  const modal = document.getElementById('imageModal');
  const modalImg = document.getElementById('modalImage');
  modal.style.display = 'block';
  modalImg.src = imageUrl;
}

function closeImageModal() {
  document.getElementById('imageModal').style.display = 'none';
}

// Initialize on load
document.addEventListener("DOMContentLoaded", () => {
  const gate1 = document.getElementById("gateSwitch1");
  const gate2 = document.getElementById("gateSwitch2");

  if (gate1) gate1.addEventListener("click", () => toggleGate("gate1"));
  if (gate2) gate2.addEventListener("click", () => toggleGate("gate2"));

  const slotBtns = document.querySelectorAll(".slot-btn");
  slotBtns.forEach((btn, index) => {
    const slotId = ['A1', 'A2', 'A3', 'A4'][index];
    
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      
      if (btn.classList.contains('available')) {
        showNotification(`Chỗ ${slotId} đang trống`, 'info');
      } else if (btn.classList.contains('reserved')) {
        showNotification(`Chỗ ${slotId} đã được đặt bởi khách hàng`, 'warning');
      } else if (btn.classList.contains('occupied')) {
        showNotification(`Chỗ ${slotId} đã có xe`, 'warning');
      }
    });

    btn.style.cursor = 'pointer';
  });
  
  formatAllDates();
  initWebSocket();
  updateTime();
  autoRefreshImages();
});

// Update time
function updateTime() {
  const now = new Date();
  const dateString = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeString = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('currentDate').textContent = dateString;
  document.getElementById('currentTime').textContent = timeString;
}

setInterval(updateTime, 1000);

// Search booking
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
      <div>
        <label for="searchStatus"><strong>Trạng thái:</strong></label>
        <select id="searchStatus" class="status-select">
          <option value="pending" ${booking.status === 'pending' ? 'selected' : ''}>pending</option>
          <option value="confirmed" ${booking.status === 'confirmed' ? 'selected' : ''}>confirmed</option>
          <option value="cancelled" ${booking.status === 'cancelled' ? 'selected' : ''}>cancelled</option>
        </select>
        <button class="update-status-btn" onclick="updateBookingStatus('${booking.bookingCode}', document.getElementById('searchStatus').value)">Cập nhật</button>
      </div>
    `;
  } catch (err) {
    document.getElementById("searchResult").innerHTML = `<p style="color:red">${err.message}</p>`;
  }
}

// Delete booking
async function deleteBooking() {
  const code = document.getElementById("searchCode").value.trim();
  if (!code) return alert("Nhập mã vé trước");

  if (!confirm(`Bạn có chắc muốn xóa mã vé ${code}?`)) return;

  try {
    const res = await fetch(`/api/manager/${code}`, { method: "DELETE" });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message);

    alert("✅ " + data.message);
    location.reload();
  } catch (err) {
    alert("❌ " + err.message);
  }
}