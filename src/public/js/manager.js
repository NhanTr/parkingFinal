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