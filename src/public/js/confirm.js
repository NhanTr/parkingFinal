// Cập nhật thông tin xác nhận
function confirmBooking() {
  const start = document.getElementById('time_arrive').value;
  const end = document.getElementById('time_left').value;
  const loc = document.getElementById('location').value;

  document.getElementById('finalTime').innerText = `${start} - ${end}`;
  document.getElementById('finalPosition').innerText = loc;

  showFrame('confirm-screen');
}
