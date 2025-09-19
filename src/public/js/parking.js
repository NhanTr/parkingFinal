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
        alert(`🚗 Đặt chỗ thành công!\nMã đặt chỗ: ${data.bookingCode}`);
        // có thể redirect sang trang xác nhận
        window.location.href = "/confirm";
      } else {
        alert("❌ Lỗi: " + data.message);
      }
    } catch (err) {
      console.error(err);
      alert("Không thể kết nối server!");
    }
  });
});
