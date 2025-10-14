let ws;
let streaming = false;
let frameCount = 0;
let totalFrames = 0;
let lastFpsUpdate = Date.now();
let streamStartTime = null;
let streamTimer = null;

// Connect to WebSocket
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('✅ WebSocket connected');
        updateStatus(true, 'Đã kết nối');
        
        // Send web client connect message
        ws.send(JSON.stringify({
            type: 'web_client_connect',
            timestamp: new Date().toISOString()
        }));

        // Check camera status
        checkCameraStatus();
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleMessage(data);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus(false, 'Lỗi kết nối');
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateStatus(false, 'Mất kết nối');
        
        if (streaming) {
            stopStreamUI();
        }
        
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };
}

function handleMessage(data) {
    switch(data.type) {
        case 'stream_frame':
            displayFrame(data.data);
            break;
            
        case 'stream_started':
            console.log('Stream started');
            break;
            
        case 'stream_stopped':
            console.log('Stream stopped');
            stopStreamUI();
            break;
            
        case 'camera_connected':
            document.getElementById('cameraStatus').textContent = 'Online';
            document.getElementById('cameraStatus').style.color = '#2ecc71';
            document.getElementById('startBtn').disabled = false;
            break;
            
        case 'camera_disconnected':
            document.getElementById('cameraStatus').textContent = 'Offline';
            document.getElementById('cameraStatus').style.color = '#e74c3c';
            document.getElementById('startBtn').disabled = true;
            if (streaming) {
                stopStream();
            }
            break;
            
        case 'status':
            // Handle status updates if needed
            break;
    }
}

function displayFrame(imageData) {
    const liveFeed = document.getElementById('liveFeed');
    liveFeed.innerHTML = `<img src="data:image/jpeg;base64,${imageData}" alt="Live Feed">`;
    
    // Update FPS counter
    frameCount++;
    totalFrames++;
    document.getElementById('frameCount').textContent = totalFrames;
    
    const now = Date.now();
    if (now - lastFpsUpdate >= 1000) {
        const fps = Math.round(frameCount / ((now - lastFpsUpdate) / 1000));
        document.getElementById('fpsCounter').textContent = `${fps} FPS`;
        
        // Update connection quality based on FPS
        updateConnectionQuality(fps);
        
        frameCount = 0;
        lastFpsUpdate = now;
    }
}

function updateConnectionQuality(fps) {
    const qualityElement = document.getElementById('connectionQuality');
    if (fps >= 8) {
        qualityElement.textContent = 'Tốt';
        qualityElement.style.color = '#2ecc71';
    } else if (fps >= 5) {
        qualityElement.textContent = 'Trung bình';
        qualityElement.style.color = '#f39c12';
    } else {
        qualityElement.textContent = 'Kém';
        qualityElement.style.color = '#e74c3c';
    }
}

function updateStatus(connected, text) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    if (connected) {
        statusDot.classList.add('connected');
    } else {
        statusDot.classList.remove('connected');
    }
    
    statusText.textContent = text;
}

function startStream() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('WebSocket chưa kết nối!');
        return;
    }

    ws.send(JSON.stringify({
        type: 'start_stream',
        timestamp: new Date().toISOString()
    }));

    streaming = true;
    streamStartTime = Date.now();
    totalFrames = 0;
    frameCount = 0;
    lastFpsUpdate = Date.now();
    
    // Start stream timer
    updateStreamTime();
    streamTimer = setInterval(updateStreamTime, 1000);
    
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('feedStatus').textContent = 'Đang stream...';
    
    console.log('🎬 Stream started');
}

function stopStream() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }

    ws.send(JSON.stringify({
        type: 'stop_stream',
        timestamp: new Date().toISOString()
    }));

    stopStreamUI();
}

function stopStreamUI() {
    streaming = false;
    
    if (streamTimer) {
        clearInterval(streamTimer);
        streamTimer = null;
    }
    
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('liveFeed').innerHTML = `
        <div class="no-signal">
            <div class="signal-icon">📷</div>
            <p>Stream đã dừng</p>
            <p id="feedStatus">Nhấn "Bắt đầu Stream" để tiếp tục</p>
        </div>
    `;
    document.getElementById('fpsCounter').textContent = '0 FPS';
    document.getElementById('streamTime').textContent = '00:00:00';
    
    console.log('⏹️ Stream stopped');
}

function updateStreamTime() {
    if (!streamStartTime) return;
    
    const elapsed = Date.now() - streamStartTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    document.getElementById('streamTime').textContent = timeStr;
}

function refreshCamera() {
    if (streaming) {
        stopStream();
        setTimeout(() => {
            startStream();
        }, 1000);
    } else {
        checkCameraStatus();
    }
}

async function checkCameraStatus() {
    try {
        const response = await fetch('/api/camera/status');
        const data = await response.json();
        
        document.getElementById('cameraStatus').textContent = data.connected ? 'Online' : 'Offline';
        document.getElementById('cameraStatus').style.color = data.connected ? '#2ecc71' : '#e74c3c';
        document.getElementById('viewerCount').textContent = data.viewers || 0;
        document.getElementById('startBtn').disabled = !data.connected;
    } catch (error) {
        console.error('Error checking camera status:', error);
    }
}

async function loadRecentImages() {
    const grid = document.getElementById('capturesGrid');
    grid.innerHTML = '<div class="loading-message">Đang tải ảnh...</div>';
    
    try {
        const response = await fetch('/api/camera/recent-images?limit=20');
        const images = await response.json();
        
        if (images.length === 0) {
            grid.innerHTML = '<div class="loading-message">Chưa có ảnh nào</div>';
            return;
        }
        
        grid.innerHTML = images.map(img => {
            const timestamp = new Date(img.timestamp).toLocaleString('vi-VN');
            const badgeClass = img.action === 'ENTRY' ? 'badge-entry' : 
                               (img.plateMatch === false ? 'badge-mismatch' : 'badge-exit');
            
            console.log('Rendering image:', {
            rfid: img.rfidCode,
            url: img.url,
            action: img.action
            });

            return `
                <div class="capture-card" onclick='showCaptureModal(${JSON.stringify(img).replace(/'/g, "&apos;")})'>
                    <img src="${img.url}" alt="${img.action}" class="capture-image" loading="lazy">
                    <div class="capture-info">
                        <h4>${img.rfidCode}</h4>
                        <span class="capture-badge ${badgeClass}">${img.action}</span>
                        <div class="capture-details">
                            ${img.licensePlate ? `<p>🚗 ${img.licensePlate}</p>` : '<p style="color: #999;">Không nhận dạng được</p>'}
                            <p>⏰ ${timestamp}</p>
                            ${img.plateMatch === false ? '<p style="color: #e74c3c; font-weight: bold;">⚠️ Biển số không khớp</p>' : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading images:', error);
        grid.innerHTML = '<div class="loading-message" style="color: #e74c3c;">Lỗi khi tải ảnh</div>';
    }
}

function showCaptureModal(imageData) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    const modalTitle = document.getElementById('modalTitle');
    const modalRFID = document.getElementById('modalRFID');
    const modalAction = document.getElementById('modalAction');
    const modalPlate = document.getElementById('modalPlate');
    const modalTime = document.getElementById('modalTime');
    const modalStatus = document.getElementById('modalStatus');
    
    modal.style.display = 'flex';
    modalImg.src = imageData.url;
    
    // Set modal info
    modalTitle.textContent = `Chi tiết ảnh ${imageData.action === 'ENTRY' ? 'vào' : 'ra'}`;
    modalRFID.textContent = imageData.rfidCode || 'N/A';
    modalAction.textContent = imageData.action === 'ENTRY' ? '🚗 Vào bãi' : '🚙 Ra bãi';
    modalPlate.textContent = imageData.licensePlate || 'Không nhận dạng được';
    modalTime.textContent = new Date(imageData.timestamp).toLocaleString('vi-VN');
    
    // Status with color
    let statusText = imageData.status || 'N/A';
    let statusColor = '#333';
    
    if (imageData.plateMatch === false) {
        statusText = '⚠️ BIỂN SỐ KHÔNG KHỚP';
        statusColor = '#e74c3c';
    } else if (imageData.status === 'COMPLETED') {
        statusColor = '#2ecc71';
    } else if (imageData.status === 'ACTIVE') {
        statusColor = '#3498db';
    }
    
    modalStatus.textContent = statusText;
    modalStatus.style.color = statusColor;
    modalStatus.style.fontWeight = 'bold';
}

function closeImageModal(event) {
    const modal = document.getElementById('imageModal');
    // Only close if clicking on the modal background
    if (!event || event.target === modal) {
        modal.style.display = 'none';
    }
}

// Prevent modal close when clicking on modal content
document.addEventListener('DOMContentLoaded', function() {
    const modalWrapper = document.querySelector('.modal-wrapper');
    if (modalWrapper) {
        modalWrapper.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeImageModal();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (streaming) {
        stopStream();
    }
});

// Initialize on page load
window.addEventListener('load', () => {
    connectWebSocket();
    loadRecentImages();
    
    // Refresh images every 30 seconds
    setInterval(loadRecentImages, 30000);
    
    // Update camera status every 10 seconds
    setInterval(checkCameraStatus, 10000);
});

// Add visibility change handler to pause/resume stream
document.addEventListener('visibilitychange', () => {
    if (document.hidden && streaming) {
        console.log('Page hidden, pausing stream');
        // Optional: stop stream when page is hidden to save bandwidth
        // stopStream();
    } else if (!document.hidden && ws && ws.readyState === WebSocket.OPEN) {
        console.log('Page visible again');
        checkCameraStatus();
    }
});
    