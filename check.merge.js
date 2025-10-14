// check_merge.js - Script kiểm tra index.js đã merge đúng chưa
const fs = require('fs');
const path = require('path');

console.log('🔍 Checking index.js merge status...\n');

const indexPath = path.join(__dirname, 'src', 'index.js');

if (!fs.existsSync(indexPath)) {
    console.error('❌ File src/index.js not found!');
    process.exit(1);
}

const content = fs.readFileSync(indexPath, 'utf8');

const checks = [
    {
        name: 'Import cameraService',
        pattern: /require\(['"]\.\/cameraService['"]\)/,
        required: true
    },
    {
        name: 'Camera connection variable',
        pattern: /let\s+cameraConnection\s*=\s*null/,
        required: true
    },
    {
        name: 'Image chunks variable',
        pattern: /let\s+imageChunks\s*=\s*\{\}/,
        required: true
    },
    {
        name: 'Camera connect handler',
        pattern: /if\s*\(\s*data\.type\s*===\s*['"]camera_connect['"]/,
        required: true
    },
    {
        name: 'Camera image handler',
        pattern: /if\s*\(\s*data\.type\s*===\s*['"]camera_image['"]/,
        required: true
    },
    {
        name: 'Camera error handler',
        pattern: /if\s*\(\s*data\.type\s*===\s*['"]camera_error['"]/,
        required: true
    },
    {
        name: 'Updated RFID access handler',
        pattern: /cameraConnection\.send.*capture_request/,
        required: true
    },
    {
        name: 'processLicensePlateImage function',
        pattern: /async\s+function\s+processLicensePlateImage/,
        required: true
    },
    {
        name: 'handleEntryWithPlate function',
        pattern: /async\s+function\s+handleEntryWithPlate/,
        required: true
    },
    {
        name: 'handleExitWithPlate function',
        pattern: /async\s+function\s+handleExitWithPlate/,
        required: true
    },
    {
        name: 'processRfidWithoutCamera function',
        pattern: /async\s+function\s+processRfidWithoutCamera/,
        required: true
    },
    {
        name: 'Security alerts API',
        pattern: /app\.get\(['"]\/api\/security-alerts['"]/,
        required: true
    },
    {
        name: 'RFID access API',
        pattern: /app\.get\(['"]\/api\/rfid-access/,
        required: true
    },
    {
        name: 'Camera status API',
        pattern: /app\.get\(['"]\/api\/camera-status['"]/,
        required: true
    },
    {
        name: 'Cron job for cleanup',
        pattern: /cron\.schedule/,
        required: false
    },
    {
        name: 'Static uploads serving',
        pattern: /app\.use\(['"]\/uploads['"]/,
        required: true
    }
];

let passed = 0;
let failed = 0;
let warnings = 0;

checks.forEach(check => {
    const found = check.pattern.test(content);
    
    if (found) {
        console.log(`✅ ${check.name}`);
        passed++;
    } else {
        if (check.required) {
            console.log(`❌ ${check.name} - MISSING!`);
            failed++;
        } else {
            console.log(`⚠️  ${check.name} - Optional (not found)`);
            warnings++;
        }
    }
});

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);
console.log('='.repeat(50) + '\n');

if (failed === 0) {
    console.log('🎉 All required components found!');
    console.log('✅ index.js merge appears complete!\n');
    console.log('Next steps:');
    console.log('1. Check syntax: node -c src/index.js');
    console.log('2. Start server: npm start');
    console.log('3. Test camera: node test_camera.js ws\n');
    process.exit(0);
} else {
    console.log('❌ Some required components are missing!');
    console.log('📖 Please review the merge guide: FILES_TO_UPDATE.md\n');
    console.log('Missing components need to be added to src/index.js\n');
    process.exit(1);
}