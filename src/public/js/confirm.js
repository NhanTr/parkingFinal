// Cập nhật thông tin xác nhận
function confirmBooking() {
  const start = document.getElementById('time_arrive').value;
  const end = document.getElementById('time_left').value;
  const loc = document.getElementById('location').value;

  document.getElementById('finalTime').innerText = `${start} - ${end}`;
  document.getElementById('finalPosition').innerText = loc;

  showFrame('confirm-screen');
}
document.addEventListener('DOMContentLoaded', function () {
  const startBtn = document.getElementById('start-payment-btn');
  const paymentInfo = document.getElementById('payment-info');
  const startTimeSpan = document.getElementById('start-time');
  const currentTimeSpan = document.getElementById('current-time');
  const elapsedTimeSpan = document.getElementById('elapsed-time');
  const totalAmountSpan = document.getElementById('total-amount');

  let startTime = null;
  let timerInterval = null;

  // Định nghĩa giá tiền mỗi giờ
  const pricePerHour = 10000; // 10.000 VNĐ/giờ

  function formatTime(date) {
    return date.toLocaleTimeString('vi-VN');
  }

  function getElapsedTimeString(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  function calculateAmount(ms) {
    const hours = ms / (1000 * 60 * 60);
    return Math.ceil(hours) * pricePerHour;
  }

  startBtn.addEventListener('click', function () {
    startTime = new Date();
    startTimeSpan.textContent = formatTime(startTime);
    paymentInfo.style.display = 'block';
    startBtn.disabled = true;

    timerInterval = setInterval(function () {
      const now = new Date();
      currentTimeSpan.textContent = formatTime(now);
      const elapsed = now - startTime;
      elapsedTimeSpan.textContent = getElapsedTimeString(elapsed);
      totalAmountSpan.textContent = calculateAmount(elapsed).toLocaleString('vi-VN');
    }, 1000);
  });
});

document.addEventListener('DOMContentLoaded', function() {
  const saveBtn = document.getElementById('saveNoteBtn');
  const noteInput = document.getElementById('noteInput');
  const noteStatus = document.getElementById('noteStatus');
  const bookingCode = window.bookingCode ;
  
  console.log('Booking Code:', bookingCode);

  if (!saveBtn || !noteInput || !noteStatus) return;

  saveBtn.addEventListener('click', async function() {
    const note = noteInput.value.trim();
    if (!note) {
      noteStatus.textContent = "Vui lòng nhập ghi chú!";
      noteStatus.style.color = "red";
      return;
    }
    noteStatus.textContent = "Đang lưu...";
    noteStatus.style.color = "#333";
    try {
      const res = await fetch(window.location.origin + '/api/bookings/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingCode, note })
      });
      const data = await res.json();
      if (res.ok) {
        noteStatus.textContent = "Đã lưu ghi chú!";
        noteStatus.style.color = "green";
      } else {
        noteStatus.textContent = data.message || "Lỗi khi lưu ghi chú!";
        noteStatus.style.color = "red";
      }
    } catch (err) {
      noteStatus.textContent = "Lỗi kết nối server!";
      noteStatus.style.color = "red";
    }
  });
});