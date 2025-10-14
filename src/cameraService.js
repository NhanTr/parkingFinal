// src/cameraService.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const OCR_API_URL = process.env.OCR_API_URL || 'https://api.platerecognizer.com/v1/plate-reader/';
const OCR_API_KEY = process.env.OCR_API_KEY || 'bdf15279787de870eefb88b6cdb4148c4c84a530';

// Upload directory
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'license_plates');

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('✅ Created upload directory:', uploadDir);
}

/**
 * Recognize license plate from base64 image
 */
async function recognizeLicensePlate(imageBase64) {
    try {
        console.log('🔍 STARTING LICENSE PLATE RECOGNITION...');
        console.log(`   API URL: ${OCR_API_URL}`);
        console.log(`   API Key configured: ${OCR_API_KEY ? 'YES ✅' : 'NO ❌'}`);
        
        if (!OCR_API_KEY || OCR_API_KEY === 'YOUR_API_KEY') {
            console.log('   ⚠️ OCR_API_KEY not configured');
            return {
                success: false,
                error: 'OCR API key not configured'
            };
        }
        
        console.log(`   Image data length: ${imageBase64.length}`);
        
        // ✅ VALIDATE BASE64 FORMAT
        if (!imageBase64 || typeof imageBase64 !== 'string') {
            console.log('   ❌ Invalid Base64 format');
            return {
                success: false,
                error: 'Invalid Base64 format'
            };
        }
        
        // ✅ REMOVE DATA URL PREFIX (nếu có)
        const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        
        const imageBuffer = Buffer.from(base64Data, 'base64');
        console.log(`   Buffer size: ${imageBuffer.length} bytes (${(imageBuffer.length/1024).toFixed(1)} KB)`);
        
        // ✅ VALIDATE BUFFER SIZE
        if (imageBuffer.length < 5000) {
            console.log('   ❌ Image too small, likely corrupted');
            return {
                success: false,
                error: 'Image too small or corrupted (< 5KB)'
            };
        }
        
        // ✅ VALIDATE JPEG SIGNATURE
        if (imageBuffer[0] !== 0xFF || imageBuffer[1] !== 0xD8 || imageBuffer[2] !== 0xFF) {
            console.log('   ❌ Not a valid JPEG image');
            return {
                success: false,
                error: 'Not a valid JPEG image'
            };
        }
        
        console.log('   ✅ Image validation passed');
        console.log('   Sending request to OCR API...');
        
        // ✅ RETRY LOGIC với exponential backoff
        const MAX_RETRIES = 3;
        let lastError = null;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`   Attempt ${attempt}/${MAX_RETRIES}...`);
                
                const startTime = Date.now();
                
                // ✅ SỬ DỤNG FORMDATA THAY VÌ RAW BUFFER
                const formData = new FormData();
                formData.append('upload', imageBuffer, {
                    filename: 'plate.jpg',
                    contentType: 'image/jpeg'
                });
                
                const response = await axios.post(
                    OCR_API_URL,
                    formData,
                    {
                        headers: {
                            'Authorization': `Token ${OCR_API_KEY}`,
                            ...formData.getHeaders() // ⚠️ QUAN TRỌNG: Thêm multipart headers
                        },
                        timeout: 20000,
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity
                    }
                );
                
                const duration = Date.now() - startTime;
                console.log(`   ✅ OCR API Response received (${duration}ms)`);
                console.log('   Response status:', response.status);
                
                if (response.data.results && response.data.results.length > 0) {
                    const plate = response.data.results[0].plate.toUpperCase();
                    const confidence = response.data.results[0].score;
                    
                    console.log(`   ✅ Recognized: ${plate} (${(confidence * 100).toFixed(1)}%)`);
                    
                    // ✅ VALIDATE VIETNAM PLATE FORMAT
                    const vietnamPlatePattern = /^[0-9]{2}[A-Z]{1,2}[-\s]?[0-9]{3,5}$/;
                    const normalizedPlate = plate.replace(/\./g, '').replace(/\s/g, '');
                    
                    if (!vietnamPlatePattern.test(normalizedPlate)) {
                        console.log(`   ⚠️ Plate format unusual: ${plate}`);
                    }
                    
                    return {
                        success: true,
                        plate: plate,
                        confidence: confidence,
                        rawData: response.data
                    };
                }
                
                console.log('   ❌ No plate detected in image');
                return {
                    success: false,
                    error: 'No plate detected'
                };
                
            } catch (err) {
                lastError = err;
                console.log(`   ❌ Attempt ${attempt} failed:`, err.message);
                
                if (err.response) {
                    console.log('   Response status:', err.response.status);
                    console.log('   Response data:', err.response.data);
                }
                
                if (attempt < MAX_RETRIES) {
                    const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
                    console.log(`   Retrying in ${waitTime/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        
        // All retries failed
        throw lastError;
        
    } catch (error) {
        console.error('❌ OCR ERROR:', error.message);
        if (error.response) {
            console.error('   Response status:', error.response.status);
            console.error('   Response data:', error.response.data);
        }
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Save image to disk
 */
function saveImage(imageBase64, rfidCode, action) {
    try {
        const timestamp = Date.now();
        const filename = `${rfidCode}_${action}_${timestamp}.jpg`;
        const filepath = path.join(uploadDir, filename);
        
        fs.writeFileSync(filepath, Buffer.from(imageBase64, 'base64'));
        
        console.log(`💾 Image saved: ${filename}`);
        
        return `/uploads/license_plates/${filename}`;
    } catch (error) {
        console.error('❌ Error saving image:', error);
        return null;
    }
}

/**
 * Delete old images (cleanup)
 */
function deleteOldImages(daysOld = 90) {
    try {
        const files = fs.readdirSync(uploadDir);
        const now = Date.now();
        const maxAge = daysOld * 24 * 60 * 60 * 1000;
        
        let deletedCount = 0;
        
        files.forEach(file => {
            const filepath = path.join(uploadDir, file);
            const stats = fs.statSync(filepath);
            const age = now - stats.mtimeMs;
            
            if (age > maxAge) {
                fs.unlinkSync(filepath);
                deletedCount++;
            }
        });
        
        if (deletedCount > 0) {
            console.log(`🗑️  Deleted ${deletedCount} old images`);
        }
        
        return deletedCount;
    } catch (error) {
        console.error('❌ Error deleting old images:', error);
        return 0;
    }
}

/**
 * Compare two license plates
 */
function comparePlates(plate1, plate2) {
    if (!plate1 || !plate2) return false;
    
    const normalized1 = plate1.replace(/\s+/g, '').toUpperCase();
    const normalized2 = plate2.replace(/\s+/g, '').toUpperCase();
    
    return normalized1 === normalized2;
}

/**
 * Get image info
 */
function getImageInfo(imageUrl) {
    if (!imageUrl) return null;
    
    const filename = path.basename(imageUrl);
    const filepath = path.join(uploadDir, filename);
    
    if (!fs.existsSync(filepath)) {
        return null;
    }
    
    const stats = fs.statSync(filepath);
    
    return {
        filename: filename,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
    };
}

/**
 * Validate image before sending to OCR
 */
function validateImage(imageBase64) {
    try {
        if (!imageBase64 || imageBase64.length < 100) {
            return { valid: false, error: 'Image data too short' };
        }
        
        const buffer = Buffer.from(imageBase64, 'base64');
        
        if (buffer.length < 1000) {
            return { valid: false, error: 'Image too small' };
        }
        
        // Check JPEG signature (FF D8 FF)
        if (buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
            return { valid: false, error: 'Not a valid JPEG image' };
        }
        
        return { valid: true };
        
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

module.exports = {
    recognizeLicensePlate,
    saveImage,
    deleteOldImages,
    comparePlates,
    getImageInfo,
    validateImage,
    uploadDir
};