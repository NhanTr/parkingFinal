let submitted = false;

  // Khi submit form thì gán lại submitted = true
document.getElementById("bookingForm").addEventListener("submit", function() {
    submitted = true;
});