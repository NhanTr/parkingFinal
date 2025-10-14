/**
 * MANAGER RFID ACCESS HANDLER
 * Quản lý hiển thị và tương tác với bảng RFID Access
 * Bao gồm: Image Modal, Filters, và Auto-refresh
 */

// ============================================
// PHẦN 1: BIẾN TOÀN CỤC
// ============================================
let allRfidData = []; // Lưu trữ dữ liệu gốc của bảng để filter

// ============================================
// PHẦN 2: IMAGE MODAL (Hiển thị ảnh full size)
// ============================================

/**
 * Hiển thị modal với ảnh và thông tin chi tiết
 * @param {string} imageUrl - URL của ảnh
 * @param {string} rfidCode - Mã thẻ RFID
 * @param {string} action - ENTRY hoặc EXIT
 * @param {string} licensePlate - Biển số xe
 * @param {string} timestamp - Thời gian
 */
function showImageModal(imageUrl, rfidCode, action, licensePlate, timestamp) {
    console.log('📸 Opening image modal:', { rfidCode, action, licensePlate });
    
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    const modalTitle = document.getElementById('modalTitle');
    const modalRFID = document.getElementById('modalRFID');
    const modalAction = document.getElementById('modalAction');
    const modalPlate = document.getElementById('modalPlate');
    const modalTime = document.getElementById('modalTime');
    
    // Kiểm tra các elements có tồn tại không
    if (!modal || !modalImg) {
        console.error('❌ Modal elements not found');
        return;
    }
    
    // Hiển thị modal
    modal.style.display = 'flex';
    modalImg.src = imageUrl;
    
    // Set thông tin modal
    if (modalTitle) {
        modalTitle.textContent = `Chi tiết ảnh ${action === 'ENTRY' ? 'vào' : 'ra'}`;
    }
    
    if (modalRFID) {
        modalRFID.textContent = rfidCode || 'N/A';
    }
    
    if (modalAction) {
        modalAction.textContent = action === 'ENTRY' ? '🚗 Vào bãi' : '🚙 Ra bãi';
        modalAction.style.color = action === 'ENTRY' ? '#2196F3' : '#4CAF50';
    }
    
    if (modalPlate) {
        modalPlate.textContent = licensePlate || 'Không nhận dạng được';
    }
    
    if (modalTime) {
        modalTime.textContent = timestamp || 'N/A';
    }
}

/**
 * Đóng modal khi click outside hoặc nút close
 * @param {Event} event - Click event
 */
function closeImageModal(event) {
    // Chỉ đóng khi click vào background, không đóng khi click vào ảnh
    if (!event || event.target.id === 'imageModal') {
        const modal = document.getElementById('imageModal');
        if (modal) {
            modal.style.display = 'none';
            console.log('✅ Modal closed');
        }
    }
}

// ============================================
// PHẦN 3: FILTER FUNCTIONS (Lọc dữ liệu)
// ============================================

/**
 * Lưu trữ dữ liệu gốc của bảng để có thể filter
 * Chạy một lần khi page load
 */
function storeOriginalData() {
    console.log('💾 Storing original RFID table data...');
    
    const rows = document.querySelectorAll('#rfidTableBody tr');
    
    if (rows.length === 0) {
        console.warn('⚠️ No RFID data found in table');
        return;
    }
    
    allRfidData = Array.from(rows).map(row => ({
        element: row.cloneNode(true),
        rfid: row.dataset.rfid || '',
        status: row.dataset.status || '',
        entryPlate: row.dataset.entryPlate || '',
        exitPlate: row.dataset.exitPlate || ''
    }));
    
    console.log(`✅ Stored ${allRfidData.length} RFID records`);
}

/**
 * Áp dụng filters và hiển thị kết quả
 */
function applyFilters() {
    console.log('🔍 Applying filters...');
    
    const rfidFilter = document.getElementById('rfidFilter');
    const statusFilter = document.getElementById('statusFilter');
    const tbody = document.getElementById('rfidTableBody');
    
    if (!rfidFilter || !statusFilter || !tbody) {
        console.error('❌ Filter elements not found');
        return;
    }
    
    const rfidValue = rfidFilter.value.toLowerCase().trim();
    const statusValue = statusFilter.value;
    
    console.log('Filter values:', { rfid: rfidValue, status: statusValue });
    
    // Xóa nội dung hiện tại
    tbody.innerHTML = '';
    
    // Lọc và hiển thị rows phù hợp
    let matchCount = 0;
    
    allRfidData.forEach(data => {
        let matches = true;
        
        // Lọc theo RFID hoặc biển số
        if (rfidValue) {
            const rfidMatch = data.rfid.toLowerCase().includes(rfidValue);
            const entryMatch = data.entryPlate && data.entryPlate.toLowerCase().includes(rfidValue);
            const exitMatch = data.exitPlate && data.exitPlate.toLowerCase().includes(rfidValue);
            
            matches = matches && (rfidMatch || entryMatch || exitMatch);
        }
        
        // Lọc theo status
        if (statusValue) {
            matches = matches && (data.status === statusValue);
        }
        
        // Nếu match, thêm vào table
        if (matches) {
            tbody.appendChild(data.element.cloneNode(true));
            matchCount++;
        }
    });
    
    // Hiển thị message nếu không có kết quả
    if (matchCount === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 20px; color: #999;">
                    Không tìm thấy kết quả phù hợp
                </td>
            </tr>
        `;
    }
    
    console.log(`✅ Filter applied: ${matchCount} matches found`);
    
    // Gắn lại event listeners cho ảnh
    reattachImageListeners();
}

/**
 * Xóa tất cả filters và hiển thị lại toàn bộ data
 */
function clearFilters() {
    console.log('🧹 Clearing filters...');
    
    const rfidFilter = document.getElementById('rfidFilter');
    const statusFilter = document.getElementById('statusFilter');
    const tbody = document.getElementById('rfidTableBody');
    
    if (rfidFilter) rfidFilter.value = '';
    if (statusFilter) statusFilter.value = '';
    
    if (!tbody) {
        console.error('❌ Table body not found');
        return;
    }
    
    // Xóa và hiển thị lại tất cả data
    tbody.innerHTML = '';
    
    allRfidData.forEach(data => {
        tbody.appendChild(data.element.cloneNode(true));
    });
    
    console.log(`✅ Filters cleared, showing all ${allRfidData.length} records`);
    
    // Gắn lại event listeners
    reattachImageListeners();
}

/**
 * Gắn lại event listeners cho các ảnh sau khi filter
 * Cần thiết vì các elements mới được clone
 */
function reattachImageListeners() {
    const images = document.querySelectorAll('.license-plate-image');
    
    console.log(`🔗 Reattaching listeners to ${images.length} images`);
    
    images.forEach(img => {
        img.onclick = function() {
            const imageUrl = this.src;
            const row = this.closest('tr');
            
            if (!row) {
                console.error('❌ Cannot find parent row');
                return;
            }
            
            const rfid = row.dataset.rfid;
            const action = this.alt.includes('Entry') ? 'ENTRY' : 'EXIT';
            const plate = action === 'ENTRY' ? 
                row.dataset.entryPlate : 
                row.dataset.exitPlate;
            const timeCell = row.querySelector('td:nth-child(8)');
            const time = timeCell ? timeCell.textContent : 'N/A';
            
            showImageModal(imageUrl, rfid, action, plate, time);
        };
    });
}

// ============================================
// PHẦN 4: AUTO-REFRESH (Tự động làm mới)
// ============================================

/**
 * Tự động reload page mỗi 30 giây để cập nhật data mới
 * Có thể tắt bằng cách comment dòng này
 */
function startAutoRefresh() {
    const REFRESH_INTERVAL = 30000; // 30 seconds
    
    console.log('🔄 Auto-refresh enabled (30 seconds)');
    
    setInterval(() => {
        console.log('♻️ Auto-refreshing page...');
        location.reload();
    }, REFRESH_INTERVAL);
}

// ============================================
// PHẦN 5: HIGHLIGHT NEW ENTRIES
// ============================================

/**
 * Highlight các entries mới trong 5 phút gần đây
 * (Hiện tại chỉ là placeholder, có thể mở rộng)
 */
function highlightRecentEntries() {
    const rows = document.querySelectorAll('#rfidTableBody tr');
    const now = new Date();
    const FIVE_MINUTES = 5 * 60 * 1000;
    
    console.log('✨ Checking for recent entries...');
    
    let recentCount = 0;
    
    rows.forEach(row => {
        const timeCell = row.querySelector('td:nth-child(8)');
        if (timeCell) {
            const timeStr = timeCell.textContent.trim();
            
            // Parse thời gian (format: DD/MM/YYYY HH:MM:SS)
            // TODO: Implement highlight logic nếu cần
            // Có thể thêm class 'recent-entry' cho row
            
            /* Example implementation:
            const entryTime = parseVietnameseDateTime(timeStr);
            if (now - entryTime < FIVE_MINUTES) {
                row.classList.add('recent-entry');
                recentCount++;
            }
            */
        }
    });
    
    if (recentCount > 0) {
        console.log(`🆕 Found ${recentCount} recent entries`);
    }
}

// ============================================
// PHẦN 6: EVENT LISTENERS (Khởi tạo)
// ============================================

/**
 * Khởi tạo tất cả event listeners khi DOM ready
 */
function initializeManagerRFID() {
    console.log('🚀 Initializing Manager RFID module...');
    
    // 1. Prevent modal close when clicking on modal content
    const modalContent = document.querySelector('.modal-container');
    if (modalContent) {
        modalContent.addEventListener('click', function(e) {
            e.stopPropagation();
            console.log('🛡️ Modal content click prevented');
        });
    }
    
    // 2. Store original table data for filtering
    storeOriginalData();
    
    // 3. Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeImageModal();
        }
    });
    
    // 4. Highlight recent entries
    highlightRecentEntries();
    
    // 5. Start auto-refresh (có thể tắt nếu không cần)
    // startAutoRefresh(); // Comment dòng này để tắt auto-refresh
    
    console.log('✅ Manager RFID module initialized successfully');
}

// Khởi động khi DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeManagerRFID);
} else {
    // DOM đã ready rồi
    initializeManagerRFID();
}

// ============================================
// PHẦN 7: HELPER FUNCTIONS (Hàm hỗ trợ)
// ============================================

/**
 * Parse thời gian định dạng Việt Nam
 * @param {string} dateStr - Chuỗi thời gian (DD/MM/YYYY HH:MM:SS)
 * @returns {Date} Date object
 */
function parseVietnameseDateTime(dateStr) {
    // Example: "10/10/2025 14:30:45"
    const parts = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    
    if (!parts) return new Date();
    
    const [, day, month, year, hour, minute, second] = parts;
    return new Date(year, month - 1, day, hour, minute, second);
}

/**
 * Format số với dấu phẩy phân cách
 * @param {number} number - Số cần format
 * @returns {string} Số đã format
 */
function formatNumber(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Export functions để có thể dùng từ HTML
window.showImageModal = showImageModal;
window.closeImageModal = closeImageModal;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;