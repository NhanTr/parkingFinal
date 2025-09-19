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
