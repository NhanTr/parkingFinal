const RfidAccess = require('../../models/rfidAccess');
const cameraService = require('../../services/cameraService');
const statusManager = require('../statusManager');

// ============ HANDLE RFID ACCESS ============
async function handleRfidAccess(data) {
    console.log('\n=== RFID ACCESS RECEIVED ===');
    console.log('Raw data:', JSON.stringify(data, null, 2));
    
    const { rfidCode, action, timestamp, slotUsed, servoType } = data.data || data;
    
    console.log('Parsed:', { rfidCode, action, servoType });
    
    const cameraConn = statusManager.getCameraConnection();
    const cameraOnline = cameraConn && cameraConn.readyState === 1;
    console.log('Camera status:', cameraOnline ? 'ONLINE' : 'OFFLINE');
    
    if (cameraOnline) {
        console.log('📷 Requesting camera capture...');
        
        cameraConn.send(JSON.stringify({
            type: 'capture_request',
            data: {
                rfidCode: rfidCode,
                action: action,
                gateType: servoType || (action === 'ENTER' ? 'ENTRY_GATE' : 'EXIT_GATE')
            },
            timestamp: new Date().toISOString()
        }));
        
        console.log('✅ Capture request sent');
        
        // Timeout 10s
        setTimeout(() => {
            console.log('⏰ Camera timeout, processing without image...');
            processRfidWithoutCamera(rfidCode, action, timestamp, slotUsed);
        }, 10000);
        
    } else {
        console.log('⚠️ Camera offline, processing without image');
        processRfidWithoutCamera(rfidCode, action, timestamp, slotUsed);
    }
    
    console.log('=== END RFID ACCESS ===\n');
}

// ============ PROCESS LICENSE PLATE IMAGE ============
async function processLicensePlateImage(rfidCode, action, gateType, imageBase64) {
    try {
        console.log(`\n=== PROCESSING LICENSE PLATE: ${rfidCode} ===`);
        console.log(`Action: ${action}`);
        
        const imageUrl = cameraService.saveImage(imageBase64, rfidCode, action);
        console.log(`📸 Image saved: ${imageUrl}`);
        
        const ocrResult = await cameraService.recognizeLicensePlate(imageBase64);
        
        if (!ocrResult.success) {
            console.log('⚠️ OCR failed, allowing entry without plate');
            
            if (action === 'ENTER' || action === 'Entry') {
                await handleEntryWithoutPlate(rfidCode, imageUrl);
            } else {
                await handleExitWithoutPlate(rfidCode, imageUrl);
            }
            return;
        }
        
        const licensePlate = ocrResult.plate;
        console.log(`🚗 License Plate: ${licensePlate}`);
        
        if (action === 'ENTER' || action === 'Entry') {
            await handleEntryWithPlate(rfidCode, licensePlate, imageUrl);
        } else if (action === 'EXIT' || action === 'Exit') {
            await handleExitWithPlate(rfidCode, licensePlate, imageUrl);
        }
        
    } catch (error) {
        console.error('❌ Error processing image:', error);
        
        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === 1) {
            esp32Conn.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ENTRY_ALLOWED',
                    message: 'Entry allowed (processing error)',
                    allowEntry: true
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}

// ============ HANDLE ENTRY WITH PLATE ============
async function handleEntryWithPlate(rfidCode, licensePlate, imageUrl) {
    try {
        console.log('\n=== HANDLING ENTRY WITH PLATE ===');
        console.log('RFID:', rfidCode, '| Plate:', licensePlate);
        
        const existingAccess = await RfidAccess.findOne({
            rfidCode: rfidCode,
            status: 'ACTIVE'
        });
        
        if (existingAccess) {
            console.log('❌ RFID already has active session');
            
            const esp32Conn = statusManager.getESP32Connection();
            if (esp32Conn && esp32Conn.readyState === 1) {
                esp32Conn.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'ERROR',
                        message: 'Already has active session'
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            return;
        }
        
        const newAccess = new RfidAccess({
            rfidCode: rfidCode,
            entryTime: new Date(),
            licensePlateEntry: licensePlate,
            entryImageUrl: imageUrl,
            status: 'ACTIVE'
        });
        
        await newAccess.save();
        console.log(`✅ Entry recorded: ${rfidCode} - ${licensePlate}`);
        
        await statusManager.updateAvailableSlotsFromRFID();
        await statusManager.sendStatusUpdateToESP32();
        
        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === 1) {
            esp32Conn.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    licensePlate: licensePlate,
                    status: 'ENTRY_RECORDED',
                    message: 'Entry recorded - Gate opening',
                    allowEntry: true,
                    entryTime: newAccess.entryTime,
                    accessId: newAccess._id
                },
                timestamp: new Date().toISOString()
            }));
            console.log('📤 SUCCESS response sent to ESP32');
        }
        
        await statusManager.broadcastToWebClients({
            type: 'rfid_entry',
            data: {
                rfidCode: rfidCode,
                licensePlate: licensePlate,
                entryTime: newAccess.entryTime,
                imageUrl: imageUrl
            },
            timestamp: new Date().toISOString()
        });
        
        console.log('=== ENTRY COMPLETE ===\n');
        
    } catch (error) {
        console.error('❌ Error in handleEntryWithPlate:', error);
        
        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === 1) {
            esp32Conn.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ERROR',
                    message: 'Database error: ' + error.message
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}

// ============ HANDLE EXIT WITH PLATE ============
async function handleExitWithPlate(rfidCode, licensePlate, imageUrl) {
    try {
        console.log('\n=== HANDLING EXIT WITH PLATE ===');
        console.log('RFID:', rfidCode, '| Plate:', licensePlate);
        
        const activeAccess = await RfidAccess.findOne({
            rfidCode: rfidCode,
            status: 'ACTIVE'
        });
        
        if (!activeAccess) {
            console.log('❌ No active session found');
            
            const esp32Conn = statusManager.getESP32Connection();
            if (esp32Conn && esp32Conn.readyState === 1) {
                esp32Conn.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'ERROR',
                        message: 'No active session found',
                        allowExit: false
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            return;
        }
        
        activeAccess.exitTime = new Date();
        activeAccess.licensePlateExit = licensePlate;
        activeAccess.exitImageUrl = imageUrl;
        
        const plateMatch = activeAccess.checkPlateMatch();
        activeAccess.plateMatch = plateMatch;
        
        if (!plateMatch) {
            console.log(`⚠️ PLATE MISMATCH: Entry=${activeAccess.licensePlateEntry}, Exit=${licensePlate}`);
            activeAccess.status = 'MISMATCH';
            activeAccess.mismatchReason = `Entry: ${activeAccess.licensePlateEntry}, Exit: ${licensePlate}`;
            
            await activeAccess.save();
            
            const esp32Conn = statusManager.getESP32Connection();
            if (esp32Conn && esp32Conn.readyState === 1) {
                esp32Conn.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'PLATE_MISMATCH',
                        message: 'License plate mismatch - Security alert',
                        allowExit: false,
                        entryPlate: activeAccess.licensePlateEntry,
                        exitPlate: licensePlate
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            
            statusManager.broadcastToWebClients({
                type: 'security_alert',
                data: {
                    alertType: 'PLATE_MISMATCH',
                    rfidCode: rfidCode,
                    entryPlate: activeAccess.licensePlateEntry,
                    exitPlate: licensePlate,
                    entryTime: activeAccess.entryTime,
                    exitTime: activeAccess.exitTime,
                    action: 'EXIT_DENIED'
                },
                timestamp: new Date().toISOString()
            });
            
            return;
        }
        
        activeAccess.status = 'COMPLETED';
        activeAccess.parkingFee = activeAccess.calculateParkingFee();
        
        await activeAccess.save();
        console.log(`✅ Exit recorded: ${rfidCode} - Fee: ${activeAccess.parkingFee}`);
        
        await statusManager.updateAvailableSlotsFromRFID();
        await statusManager.sendStatusUpdateToESP32();
        
        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === 1) {
            esp32Conn.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    licensePlate: licensePlate,
                    status: 'EXIT_RECORDED',
                    message: 'Exit recorded - Gate opening',
                    allowExit: true,
                    entryTime: activeAccess.entryTime,
                    exitTime: activeAccess.exitTime,
                    duration: activeAccess.duration,
                    fee: activeAccess.parkingFee,
                    plateMatch: true
                },
                timestamp: new Date().toISOString()
            }));
            console.log('📤 SUCCESS response sent to ESP32');
        }
        
        statusManager.broadcastToWebClients({
            type: 'rfid_exit',
            data: {
                rfidCode: rfidCode,
                licensePlate: licensePlate,
                entryTime: activeAccess.entryTime,
                exitTime: activeAccess.exitTime,
                duration: activeAccess.duration,
                fee: activeAccess.parkingFee,
                plateMatch: true,
                imageUrl: imageUrl
            },
            timestamp: new Date().toISOString()
        });
        
        console.log('=== EXIT COMPLETE ===\n');
        
    } catch (error) {
        console.error('❌ Error in handleExitWithPlate:', error);
        
        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === 1) {
            esp32Conn.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ERROR',
                    message: 'Database error: ' + error.message
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}

// ============ HANDLE WITHOUT PLATE ============
async function handleEntryWithoutPlate(rfidCode, imageUrl) {
    try {
        console.log('\n=== ENTRY WITHOUT PLATE ===');
        
        const newAccess = new RfidAccess({
            rfidCode: rfidCode,
            entryTime: new Date(),
            entryImageUrl: imageUrl,
            status: 'ACTIVE'
        });
        
        await newAccess.save();
        await statusManager.updateAvailableSlotsFromRFID();
        await statusManager.sendStatusUpdateToESP32();
        
        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === 1) {
            esp32Conn.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ENTRY_RECORDED',
                    message: 'Entry recorded (no plate detected)',
                    allowEntry: true
                },
                timestamp: new Date().toISOString()
            }));
        }
        
        await statusManager.broadcastToWebClients({
            type: 'status',
            data: statusManager.getCurrentStatus(),
            timestamp: new Date().toISOString()
        });
        
        console.log('=== ENTRY WITHOUT PLATE COMPLETE ===\n');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

async function handleExitWithoutPlate(rfidCode, imageUrl) {
    try {
        console.log('\n=== EXIT WITHOUT PLATE ===');
        
        const activeAccess = await RfidAccess.findOne({
            rfidCode: rfidCode,
            status: 'ACTIVE'
        });
        
        if (!activeAccess) {
            const esp32Conn = statusManager.getESP32Connection();
            if (esp32Conn && esp32Conn.readyState === 1) {
                esp32Conn.send(JSON.stringify({
                    type: 'rfid_response',
                    data: {
                        rfidCode: rfidCode,
                        status: 'ERROR',
                        message: 'No active session'
                    },
                    timestamp: new Date().toISOString()
                }));
            }
            return;
        }
        
        activeAccess.exitTime = new Date();
        activeAccess.exitImageUrl = imageUrl;
        activeAccess.status = 'COMPLETED';
        activeAccess.parkingFee = activeAccess.calculateParkingFee();
        
        await activeAccess.save();
        await statusManager.updateAvailableSlotsFromRFID();
        await statusManager.sendStatusUpdateToESP32();
        
        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === 1) {
            esp32Conn.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'EXIT_RECORDED',
                    message: 'Exit recorded (no plate)',
                    allowExit: true,
                    duration: activeAccess.duration,
                    fee: activeAccess.parkingFee
                },
                timestamp: new Date().toISOString()
            }));
        }
        
        await statusManager.broadcastToWebClients({
            type: 'status',
            data: statusManager.getCurrentStatus(),
            timestamp: new Date().toISOString()
        });
        
        console.log('=== EXIT WITHOUT PLATE COMPLETE ===\n');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

// ============ PROCESS WITHOUT CAMERA ============
async function processRfidWithoutCamera(rfidCode, action, timestamp, slotUsed) {
    try {
        console.log(`\n=== PROCESSING WITHOUT CAMERA ===`);
        console.log(`RFID: ${rfidCode}, Action: ${action}`);
        
        if (action === 'ENTER' || action === 'Entry') {
            await handleEntryWithoutPlate(rfidCode, null);
        } else if (action === 'EXIT' || action === 'Exit') {
            await handleExitWithoutPlate(rfidCode, null);
        }
        
        console.log('=== RFID WITHOUT CAMERA COMPLETE ===\n');
        
    } catch (error) {
        console.error('❌ Error processing without camera:', error);
        
        const esp32Conn = statusManager.getESP32Connection();
        if (esp32Conn && esp32Conn.readyState === 1) {
            esp32Conn.send(JSON.stringify({
                type: 'rfid_response',
                data: {
                    rfidCode: rfidCode,
                    status: 'ERROR',
                    message: 'Database error: ' + error.message
                },
                timestamp: new Date().toISOString()
            }));
        }
    }
}

module.exports = {
    handleRfidAccess,
    processLicensePlateImage,
    handleEntryWithPlate,
    handleExitWithPlate,
    handleEntryWithoutPlate,
    handleExitWithoutPlate,
    processRfidWithoutCamera
};

