#include <WiFi.h>
#include <WebSocketsClient.h>
#include <NTPClient.h>
#include <WiFiUdp.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>

WiFiUDP ntpUDP;

const char* ssid = "Tuan Anh";
const char* password = "tuananh1309@";
const char* ws_host = "10.74.50.249";
const uint16_t ws_port = 4000;
const char* ws_path = "/";

// const char* ssid = "N";
// const char* password = "zxcvbnma";
// const char* ws_host = "172.20.10.2";
// const uint16_t ws_port = 4000;
// const char* ws_path = "/";

// const char* ssid = "KTX J01";
// const char* password = "j01ptithcm";
// const char* ws_host = "192.168.1.15";
// const uint16_t ws_port = 4000;
// const char* ws_path = "/";

// const char* ssid = "AM THANH ANH THANH";
// const char* password = "Dong1357@";
// const char* ws_host = "192.168.100.110";
// const uint16_t ws_port = 4000;
// const char* ws_path = "/";

WebSocketsClient wsClient;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 7*3600, 600000);
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Connection state management
bool wsConnected = false;
unsigned long lastConnectionAttempt = 0;
const unsigned long RECONNECTION_DELAY = 5000;
unsigned long lastPingTime = 0;
const unsigned long PING_INTERVAL = 30000; // Send ping every 30 seconds

// Remove keypad-related variables and keep only admin control
bool useServerStatus = false;
unsigned long lastServerStatusUpdate = 0;
const unsigned long SERVER_STATUS_TIMEOUT = 30000;
bool adminMode = false;

// Server status data structure
struct ServerParkingData {
    uint8_t availableSlots : 4;
    uint8_t totalSlots : 4;
    bool slots[4];
    bool entryGateOpen;
    bool exitGateOpen;
    String lastUpdated;
    bool isAdminMode;
    bool hasData;
} serverParkingData;

struct ParkingData {
    uint8_t availableSlots : 4;
    uint8_t totalSlots : 4;
    bool slots[4];
    bool entryGateOpen;
    bool exitGateOpen;
    String lastUpdated;
    bool isAdminMode;
} parkingData;

String systemLog = "";
const int maxLogEntries = 10;

struct HistoryEntry {
    String event;
    String idCode;
    String action;
    String method;
    String servoType;
    String timestamp;
    String triggerSource;
};
HistoryEntry history[20];
int historycount = 0;

struct ParkingSession {
    String vehicleCode;
    unsigned long entryTime;
    String entryTimeStr;
    bool isActive;
    String method;
};

ParkingSession activeSessions[10];
int sessionCount = 0;

int dotCount = 0;
bool forceDisplayUpdate = false;

void updateDisplay();
void sendBeep(int duration, int frequency);
void parseArduinoData(String data);
void addLog(String message);
void addHistory(String event, String idCode, String action, String method, String servoType, String triggerSource);
void forceUpdateDisplay();
void showActiveSessions();
int endParkingSession(String vehicleCode);
void addParkingSession(String vehicleCode, String method);
String getTimeString(unsigned long timeMillis);
int calculateParkingFee(unsigned long entryTime, unsigned long exitTime);
void initializeWebSocket();
void handleWebSocketEvent(WStype_t type, uint8_t * payload, size_t length);
void notifyServoActivation(String servoType, String triggerMethod, String triggerCode, String triggerSource);
void sendKeepAlive();
void sendHistoryUpdate();  
void sendStatusResponse();  
void handleControlMessage(DynamicJsonDocument& doc);  
void sendModeToArduino(); 
void sendRfidAccessToDatabase(String rfidCode, String action, String servoType); 

void setup() {
    Serial.begin(9600);
    
    Wire.begin(21, 22);
    lcd.init();
    lcd.backlight();
    lcd.setCursor(0, 0);
    lcd.print(F("Smart Parking"));
    lcd.setCursor(0, 1);
    lcd.print(F("RFID System"));
    delay(2000);

    WiFi.begin(ssid, password);
    lcd.clear();
    lcd.print(F("Connecting to WiFi"));
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
        lcd.setCursor(0, 1);
        lcd.print(".");
        dotCount++;
        if (dotCount > 3) {
            dotCount = 0;
            lcd.setCursor(0, 1);
            lcd.print("    ");
        }
    }

    Serial.println();
    Serial.print("Connected to WiFi. IP: ");
    Serial.println(WiFi.localIP());
    lcd.clear();
    lcd.print(F("Connected"));
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP());
    delay(2000);

    timeClient.begin();
    
    delay(1000);
    Serial.println("ESP32 checking Arduino connection...");

    // Initialize parking data
    parkingData.availableSlots = 4;
    parkingData.totalSlots = 4;
    for (int i = 0; i < 4; i++) {
        parkingData.slots[i] = false;
    }
    parkingData.entryGateOpen = false;
    parkingData.exitGateOpen = false;

    // Initialize WebSocket client
    initializeWebSocket();

    Serial.println("RFID System started");
    addLog("RFID System started");
    sendModeToArduino(); // Send RFID mode to Arduino
    updateDisplay();
    sendBeep(100, 1000);
}

void initializeWebSocket() {
    wsClient.begin(ws_host, ws_port, ws_path);
    wsClient.onEvent(handleWebSocketEvent);
    wsClient.setReconnectInterval(5000);
    wsClient.enableHeartbeat(15000, 3000, 2); // Enable heartbeat
    wsConnected = false;
    lastConnectionAttempt = millis();
}

// Cáº­p nháº­t hÃ m handleWebSocketEvent Ä‘á»ƒ xá»­ lÃ½ response tá»« database
void handleWebSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
    switch(type) {
        case WStype_DISCONNECTED:
            Serial.println("WebSocket disconnected");
            addLog("Disconnected from Node.js server");
            wsConnected = false;
            useServerStatus = false;
            break;
            
        case WStype_CONNECTED:
            {
                Serial.printf("WebSocket connected to: %s\n", payload);
                wsConnected = true;
                
                // Send identification immediately
                DynamicJsonDocument doc(256);
                doc["type"] = "esp32_connect";
                doc["deviceId"] = "ESP32_PARKING_SYSTEM";
                doc["timestamp"] = timeClient.getFormattedTime();
                
                String connectMsg;
                serializeJson(doc, connectMsg);
                wsClient.sendTXT(connectMsg);
                
                Serial.println("ESP32 identification sent");
                addLog("Connected to Node.js server");
                lastPingTime = millis();
            }
            break;
            
        case WStype_TEXT:
            {
                DynamicJsonDocument doc(1024);
                DeserializationError error = deserializeJson(doc, (char*)payload);
                if (!error) {
                    String type = doc["type"];
                    
                    if (type == "connection_confirmed") {
                        Serial.println("Connection confirmed by server");
                        addLog("Server confirmed connection");
                    }
                    else if (type == "status_update") {
                        Serial.println("Received status update from server");
                        
                        serverParkingData.availableSlots = doc["data"]["availableSlots"];
                        serverParkingData.totalSlots = doc["data"]["totalSlots"];
                        serverParkingData.entryGateOpen = doc["data"]["entryGateOpen"];
                        serverParkingData.exitGateOpen = doc["data"]["exitGateOpen"];
                        serverParkingData.isAdminMode = doc["data"]["isAdminMode"];
                        serverParkingData.lastUpdated = doc["data"]["lastUpdate"].as<const char*>();
                        serverParkingData.hasData = true;
                        
                        JsonArray slots = doc["data"]["slots"];
                        for (int i = 0; i < 4; i++) {
                            serverParkingData.slots[i] = slots[i];
                        }
                        
                        useServerStatus = true;
                        lastServerStatusUpdate = millis();
                        forceDisplayUpdate = true;
                        updateDisplay();
                        
                        String logMsg = "Server status: " + String(serverParkingData.availableSlots) + "/4 available";
                        addLog(logMsg);
                    }
                    // NEW: Handle RFID response from database
                    else if (type == "rfid_response") {
                        String rfidCode = doc["data"]["rfidCode"];
                        String status = doc["data"]["status"];
                        String message = doc["data"]["message"];
                        
                        Serial.println("RFID Response: " + rfidCode + " - " + status);
                        
                        // Send response back to Arduino
                        if (status == "ENTRY_RECORDED" || status == "EXIT_RECORDED") {
                            Serial.println("DATABASE_RESPONSE:SUCCESS");
                        } else {
                            Serial.println("DATABASE_RESPONSE:ERROR");
                        }
                        
                        if (status == "ENTRY_RECORDED") {
                            lcd.clear();
                            lcd.setCursor(0, 0);
                            lcd.print(F("ENTRY RECORDED"));
                            lcd.setCursor(0, 1);
                            lcd.print(rfidCode);
                            delay(2000);
                            addLog("Entry recorded in database: " + rfidCode);
                            
                            // Update local parking session
                            addParkingSession(rfidCode, "RFID");
                        }
                        else if (status == "EXIT_RECORDED") {
                            int fee = doc["data"]["fee"];
                            int duration = doc["data"]["duration"];
                            String entryTime = doc["data"]["entryTime"].as<String>();
                            String exitTime = doc["data"]["exitTime"].as<String>();
                            
                            Serial.println("=== EXIT DEBUG ===");
                            Serial.println("Entry Time: " + entryTime);
                            Serial.println("Exit Time: " + exitTime);
                            Serial.println("Duration: " + String(duration));
                            Serial.println("Fee from DB: " + String(fee));
                            Serial.println("==================");

                            lcd.clear();
                            lcd.setCursor(0, 0);
                            lcd.print(F("EXIT RECORDED"));
                            lcd.setCursor(0, 1);
                            lcd.print("Fee: " + String(fee) + " VND");
                            delay(2000);
                            
                            lcd.clear();
                            lcd.setCursor(0, 0);
                            lcd.print(F("Duration:"));
                            lcd.setCursor(0, 1);
                            lcd.print(String(duration) + " minutes");
                            delay(2000);
                            
                            addLog("Exit recorded in database: " + rfidCode + ", Fee: " + String(fee));
                            
                            // End local parking session
                            endParkingSession(rfidCode);
                        }
                        else if (status == "ERROR") {
                            lcd.clear();
                            lcd.setCursor(0, 0);
                            lcd.print(F("DATABASE ERROR"));
                            lcd.setCursor(0, 1);
                            if (message == "Already has active session") {
                                lcd.print(F("Already inside"));
                            } else if (message == "No active session found") {
                                lcd.print(F("No entry record"));
                            } else {
                                lcd.print(F("DB Connection"));
                            }
                            delay(3000);
                            addLog("RFID Database Error: " + message);
                        }
                        
                        forceDisplayUpdate = true;
                    }
                    // Handle other message types...
                    else if (type == "slot_reservation") {
                        String action = doc["data"]["action"];
                        String slotId = doc["data"]["slotId"];
                        
                        Serial.println("Slot reservation: " + action + " for " + slotId);
                        
                        lcd.clear();
                        lcd.setCursor(0, 0);
                        if (action == "reserve") {
                            lcd.print(F("RESERVED: "));
                            lcd.print(slotId);
                            lcd.setCursor(0, 1);
                            lcd.print(F("30s timeout"));
                        } else if (action == "cancel") {
                            lcd.print(F("CANCELLED: "));
                            lcd.print(slotId);
                            lcd.setCursor(0, 1);
                            lcd.print(F("Slot available"));
                        } else if (action == "expire") {
                            lcd.print(F("EXPIRED: "));
                            lcd.print(slotId);
                            lcd.setCursor(0, 1);
                            lcd.print(F("Slot available"));
                        }
                        
                        delay(1500);
                        forceDisplayUpdate = true;
                        
                        String logMsg = "Slot " + slotId + " " + action + "d";
                        addLog(logMsg);
                    }
                    else if (type == "control") {
                        handleControlMessage(doc);
                    }
                    else if (type == "ping") {
                        // Respond to ping
                        wsClient.sendTXT("{\"type\":\"pong\",\"timestamp\":\"" + timeClient.getFormattedTime() + "\"}");
                    }
                } else {
                    Serial.print("JSON parse error: ");
                    Serial.println(error.c_str());
                }
            }
            break;
            
        case WStype_ERROR:
            Serial.printf("WebSocket Error: %s\n", payload);
            wsConnected = false;
            break;
            
        case WStype_PONG:
            Serial.println("Received pong from server");
            break;
            
        default:
            break;
    }
}


void sendStatusResponse() {
    DynamicJsonDocument statusDoc(1024);
    
    if (useServerStatus && serverParkingData.hasData) {
        statusDoc["availableSlots"] = serverParkingData.availableSlots;
        statusDoc["totalSlots"] = serverParkingData.totalSlots;
        statusDoc["entryGateOpen"] = serverParkingData.entryGateOpen;
        statusDoc["exitGateOpen"] = serverParkingData.exitGateOpen;
        statusDoc["lastUpdate"] = serverParkingData.lastUpdated;
        statusDoc["isAdminMode"] = serverParkingData.isAdminMode;
        statusDoc["isRFIDMode"] = true;
        JsonArray slots = statusDoc.createNestedArray("slots");
        for (int i = 0; i < 4; i++) {
            slots.add(serverParkingData.slots[i]);
        }
    } else {
        statusDoc["availableSlots"] = parkingData.availableSlots;
        statusDoc["totalSlots"] = parkingData.totalSlots;
        statusDoc["entryGateOpen"] = parkingData.entryGateOpen;
        statusDoc["exitGateOpen"] = parkingData.exitGateOpen;
        statusDoc["lastUpdate"] = parkingData.lastUpdated;
        statusDoc["isAdminMode"] = parkingData.isAdminMode;
        statusDoc["isRFIDMode"] = true;
        JsonArray slots = statusDoc.createNestedArray("slots");
        for (int i = 0; i < 4; i++) {
            slots.add(parkingData.slots[i]);
        }
    }
    
    String statusJson;
    serializeJson(statusDoc, statusJson);
    wsClient.sendTXT("{\"type\":\"status\",\"data\":" + statusJson + "}");
}

void handleControlMessage(DynamicJsonDocument& doc) {
    String action = doc["data"]["action"];
    String gateId = doc["data"]["gateId"];
    Serial.println("Action: " + action + ", Gate ID: " + gateId);
    
    if (action == "toggle_gate") {
        String gateType = (gateId == "gate1") ? "ENTRY_GATE" : "EXIT_GATE";

        if (gateId == "gate1"|| gateId == "entry_gate") {
            Serial.println("OPEN_ENTRY_GATE");
            addHistory("WEB_CONTROL", "REMOTE", "OPEN", "WEB", "ENTRY_GATE", "WEB");
            notifyServoActivation("ENTRY_GATE", "WEB", "REMOTE", "WEB");
        } else if (gateId == "gate2"|| gateId == "exit_gate") {
            Serial.println("OPEN_EXIT_GATE");
            addHistory("WEB_CONTROL", "REMOTE", "OPEN", "WEB", "EXIT_GATE", "WEB");
            notifyServoActivation("EXIT_GATE", "WEB", "REMOTE", "WEB");
        }
        addLog("Web control: " + gateId + " activated");
    }
}

void sendKeepAlive() {
    if (wsConnected && (millis() - lastPingTime > PING_INTERVAL)) {
        DynamicJsonDocument pingDoc(256);
        pingDoc["type"] = "ping";
        pingDoc["deviceId"] = "ESP32_PARKING_SYSTEM";
        pingDoc["timestamp"] = timeClient.getFormattedTime();
        
        String pingMsg;
        serializeJson(pingDoc, pingMsg);
        wsClient.sendTXT(pingMsg);
        
        lastPingTime = millis();
        Serial.println("Sent keepalive ping to server");
    }
}

void loop() {
    // Handle WebSocket connection
    if (WiFi.status() == WL_CONNECTED) {
        wsClient.loop();
        sendKeepAlive();
    } else {
        Serial.println("WiFi disconnected, attempting to reconnect...");
        WiFi.begin(ssid, password);
        wsConnected = false;
        delay(1000);
    }
    
    timeClient.update();

    if (Serial.available()) {
        String data = Serial.readStringUntil('\n');
        parseArduinoData(data);
    }

    parkingData.isAdminMode = adminMode;

    //Gửi status định kỳ mỗi 2 giây
    static unsigned long lastPeriodicUpdate = 0;
    if (wsConnected && millis() - lastPeriodicUpdate > 2000) {
        sendStatusResponse();
        lastPeriodicUpdate = millis();
    }

    static unsigned long lastDisplayUpdate = 0;
    if (millis() - lastDisplayUpdate > 200) {
        updateDisplay();
        forceDisplayUpdate = false;
        lastDisplayUpdate = millis();
    }

    delay(100);
}

void sendModeToArduino() {
    Serial.print("MODE_CHANGE:");
    Serial.println("RFID"); // Always RFID mode
    addLog("Mode set to: RFID");
    Serial.print("Sent to Arduino: MODE_CHANGE:");
    Serial.println("RFID");
}

void forceUpdateDisplay() {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(F("Slots: "));
    lcd.print(parkingData.availableSlots);
    lcd.print(F("/4"));

    lcd.setCursor(0, 1);
    if (parkingData.availableSlots > 0) {
        lcd.print(F("Status: "));
        for (int i = 0; i < parkingData.totalSlots; i++) {
            if (parkingData.slots[i]) {
                lcd.print(F("O"));
            } else {
                lcd.print(F("X"));
            }
        }
    } else {
        lcd.print(F("PARKING FULL"));
    }
}

void updateDisplay() {
    static bool displayChanged = false;
    static int lastAvailableSlots = -1;
    static bool lastSlots[4] = {false, false, false, false};
    static unsigned long lastForceUpdate = 0;
    static bool lastUseServerStatus = false;

    if (useServerStatus && (millis() - lastServerStatusUpdate > SERVER_STATUS_TIMEOUT)) {
        useServerStatus = false;
        addLog("Server status timeout, falling back to Arduino data");
        forceDisplayUpdate = true;
    }

    struct ParkingData* displayData;
    if (useServerStatus && serverParkingData.hasData) {
        displayData = (struct ParkingData*)&serverParkingData;
    } else {
        displayData = &parkingData;
    }

    bool slotsChanged = false;
    for (int i = 0; i < 4; i++) {
        if (displayData->slots[i] != lastSlots[i]) {
            slotsChanged = true;
            lastSlots[i] = displayData->slots[i];
        }
    }    

    if (millis() - lastForceUpdate > 30000) {
        displayChanged = true;
        lastForceUpdate = millis();
    }

    if (lastAvailableSlots != displayData->availableSlots || 
        slotsChanged ||  
        displayChanged || 
        forceDisplayUpdate ||
        lastUseServerStatus != useServerStatus) {
        
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print(F("Slots: "));
        lcd.print(displayData->availableSlots);
        lcd.print(F("/"));
        lcd.print(displayData->totalSlots);
        
        // Show connection status
        if (wsConnected) {
            if (useServerStatus && serverParkingData.hasData) {
                lcd.print(F(" (S)")); // Server data
            } else {
                lcd.print(F(" (A)")); // Arduino data
            }
        } else {
            lcd.print(F(" (!)")); // Not connected
        }

        lcd.setCursor(0, 1);
        if (displayData->availableSlots > 0) {
            lcd.print(F("RFID Ready: "));
            for (int i = 0; i < displayData->totalSlots && i < 4; i++) {
                if (useServerStatus && serverParkingData.hasData) {
                    if (serverParkingData.slots[i] == 1) {
                        lcd.print(F("O"));
                    } else if (serverParkingData.slots[i] == 2) {
                        lcd.print(F("R"));
                    } else {
                        lcd.print(F("X"));
                    }
                } else {
                    if (displayData->slots[i]) {
                        lcd.print(F("O"));
                    } else {
                        lcd.print(F("X"));
                    }
                }
            }
        } else {
            lcd.print(F("PARKING FULL"));
        }
        
        lastAvailableSlots = displayData->availableSlots;
        lastUseServerStatus = useServerStatus;
        displayChanged = false;
        forceDisplayUpdate = false;
        
        Serial.print("Display updated: ");
        Serial.print(displayData->availableSlots);
        Serial.print("/");
        Serial.print(displayData->totalSlots);
        Serial.print(" using ");
        Serial.println(useServerStatus ? "server data" : "Arduino data");
    }
}

void sendBeep(int duration, int frequency) {
    Serial.print(F("BEEP:"));
    Serial.print(duration);
    Serial.print(F(","));
    Serial.println(frequency);
}

void parseArduinoData(String data) {
    Serial.print("Received data: ");
    Serial.println(data);

    data.trim();

    if (data.length() == 0) {
        Serial.println("Empty data, skipping.");
        addLog("Empty data received");
        return;
    }

    // NEW: Handle RFID_DATABASE format from Arduino
    if (data.startsWith("RFID_DATABASE:")) {
        String dbData = data.substring(14);
        int firstComma = dbData.indexOf(',');
        int secondComma = dbData.indexOf(',', firstComma + 1);
        int thirdComma = dbData.indexOf(',', secondComma + 1);
        int fourthComma = dbData.indexOf(',', thirdComma + 1);
        
        if (firstComma != -1 && secondComma != -1 && thirdComma != -1 && fourthComma != -1) {
            String event = dbData.substring(0, firstComma);
            String rfidCode = dbData.substring(firstComma + 1, secondComma);
            String action = dbData.substring(secondComma + 1, thirdComma);
            String servoType = dbData.substring(thirdComma + 1, fourthComma);
            String timestamp = dbData.substring(fourthComma + 1);

            Serial.println("Processing RFID for database: " + rfidCode + " " + action);

            // Send to database via WebSocket
            if (wsConnected) {
                sendRfidAccessToDatabase(rfidCode, action, servoType);
                Serial.println("RFID data forwarded to database successfully");
                
                // Send confirmation back to Arduino
                Serial.println("DATABASE_RESPONSE:SUCCESS");
            } else {
                Serial.println("WebSocket not connected, cannot send RFID data");
                addLog("Database sync failed - no WebSocket connection");
                
                // Send error back to Arduino
                Serial.println("DATABASE_RESPONSE:ERROR");
            }
        }
        return;
    }

    // NEW: Handle vehicle entry logging
    if (data.startsWith("VEHICLE_ENTRY:")) {
        String entryData = data.substring(14);
        Serial.println("Vehicle entry logged: " + entryData);
        addLog("Vehicle entry: " + entryData);
        return;
    }

    // NEW: Handle vehicle exit logging
    if (data.startsWith("VEHICLE_EXIT:")) {
        String exitData = data.substring(13);
        Serial.println("Vehicle exit logged: " + exitData);
        addLog("Vehicle exit: " + exitData);
        return;
    }

    if (!data.startsWith("{")) {
        if (data == "OPEN_ENTRY_GATE") {
            Serial.println("OPEN_ENTRY_GATE");
            addLog("Gate control: entry gate opened");
            addHistory("GATE_CONTROL", "MANUAL", "ENTER", "RFID", "ENTRY_GATE", "WEB");
            notifyServoActivation("ENTRY_GATE", "RFID", "MANUAL", "WEB");
            parkingData.entryGateOpen = true;
            parkingData.exitGateOpen = false;
        } else if (data == "OPEN_EXIT_GATE") {
            Serial.println("OPEN_EXIT_GATE");
            addLog("Gate control: exit gate opened");
            addHistory("GATE_CONTROL", "MANUAL", "EXIT", "RFID", "EXIT_GATE", "WEB");
            notifyServoActivation("EXIT_GATE", "RFID", "MANUAL", "WEB");
            parkingData.entryGateOpen = false;
            parkingData.exitGateOpen = true;
        } else if (data.startsWith("MODE_CHANGED:")) {
            String mode = data.substring(13);
            addLog("Arduino confirmed mode: " + mode);
            Serial.println("Arduino mode confirmed: " + mode);
        } else if (data.startsWith("HISTORY:")) {
            String historyData = data.substring(8);
            int firstComma = historyData.indexOf(',');
            int secondComma = historyData.indexOf(',', firstComma + 1);
            int thirdComma = historyData.indexOf(',', secondComma + 1);
            
            if (firstComma != -1 && secondComma != -1) {
                String event = historyData.substring(0, firstComma);
                String idCode = historyData.substring(firstComma + 1, secondComma);
                String action = historyData.substring(secondComma + 1, thirdComma != -1 ? thirdComma : historyData.length());
                String servoType = (thirdComma != -1) ? historyData.substring(thirdComma + 1) : (action == "Entry" ? "ENTRY_GATE" : "EXIT_GATE");

                Serial.println("Processing legacy HISTORY: " + event + ", " + idCode + ", " + action);

                if (action.equalsIgnoreCase("Entry")) {
                    servoType = "ENTRY_GATE";
                    addParkingSession(idCode, "RFID");
                } else if (action.equalsIgnoreCase("Exit")) {
                    servoType = "EXIT_GATE";
                    addHistory(event, idCode, action, "RFID", servoType, "USER");
                } else {
                    servoType = "N/A";
                }

                addHistory(event, idCode, action, "RFID", servoType, "USER");
                notifyServoActivation(servoType, "RFID", idCode, "USER");
                
                if (!action.equalsIgnoreCase("Exit")) {
                    lcd.clear();
                    lcd.setCursor(0, 0);
                    lcd.print(event);
                    lcd.print(F(": "));
                    lcd.print(action);
                    lcd.setCursor(0, 1);
                    lcd.print(idCode);
                    delay(2000);
                    updateDisplay();
                }
                forceDisplayUpdate = true;
            }
        } else if (data == "ALIVE") {
            addLog("Arduino heartbeat received");
        }
        return;
    }

    // Parse JSON data from Arduino
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, data);
    if (error) {
        Serial.print("parseArduinoData() failed: ");
        Serial.println(error.c_str());
        addLog("JSON parse error: " + String(error.c_str()));
        return;
    }

    parkingData.availableSlots = doc["available"];
    parkingData.totalSlots = doc["total"];
    parkingData.entryGateOpen = doc["entryGateOpen"];
    parkingData.exitGateOpen = doc["exitGateOpen"];
    parkingData.lastUpdated = timeClient.getFormattedTime();

    JsonArray slots = doc["slots"];
    for (int i = 0; i < 4; i++) {
        parkingData.slots[i] = slots[i];
    }

    // NEW: Handle database mode info from Arduino
    if (doc.containsKey("databaseMode")) {
        bool databaseMode = doc["databaseMode"];
        if (databaseMode) {
            static bool loggedDatabaseMode = false;
            if (!loggedDatabaseMode) {
                addLog("Arduino running in database integration mode");
                loggedDatabaseMode = true;
            }
        }
    }

    // NEW: Handle active vehicles count
    if (doc.containsKey("activeVehicles")) {
        int activeVehicles = doc["activeVehicles"];
        static int lastActiveVehicles = -1;
        if (lastActiveVehicles != activeVehicles && lastActiveVehicles != -1) {
            addLog("Active vehicles count: " + String(activeVehicles));
        }
        lastActiveVehicles = activeVehicles;
    }

    // Handle gate sensor information
    if (doc.containsKey("entryVehicleDetected")) {
        bool entryDetected = doc["entryVehicleDetected"];
        bool exitDetected = doc["exitVehicleDetected"];
        
        static bool lastEntryDetected = false;
        static bool lastExitDetected = false;
        
        if (entryDetected != lastEntryDetected) {
            String status = entryDetected ? "DETECTED" : "CLEARED";
            addLog("Entry gate sensor: " + status);
            lastEntryDetected = entryDetected;
        }
        
        if (exitDetected != lastExitDetected) {
            String status = exitDetected ? "DETECTED" : "CLEARED";
            addLog("Exit gate sensor: " + status);
            lastExitDetected = exitDetected;
        }
    }

    // Handle parking status changes
    static int lastAvailable = -1;
    static bool lastSlots[4] = {false, false, false, false};
    
    bool slotsChanged = false;
    for (int i = 0; i < 4; i++) {
        if (parkingData.slots[i] != lastSlots[i]) {
            slotsChanged = true;
            lastSlots[i] = parkingData.slots[i];
        }
    }
    
    // Gửi status nếu có BẤT KỲ thay đổi nào
    if ((lastAvailable != parkingData.availableSlots || slotsChanged) && 
        lastAvailable != -1 && wsConnected) {
        String logMsg = "Parking status changed: " + String(parkingData.availableSlots) + "/4 available";
        addLog(logMsg);
        sendStatusResponse();  // ← GỬI NGAY KHI CÓ THAY ĐỔI
    }
    lastAvailable = parkingData.availableSlots;
}

void addLog(String message) {
    String timestamp = timeClient.getFormattedTime();
    String logEntry = "[" + timestamp + "] " + message + "\n";
    
    systemLog += logEntry;
    
    int lineCount = 0;
    for (int i = 0; i < systemLog.length(); i++) {
        if (systemLog.charAt(i) == '\n') lineCount++;
    }
    
    if (lineCount > maxLogEntries) {
        int firstNewline = systemLog.indexOf('\n');
        systemLog = systemLog.substring(firstNewline + 1);
    }
    
    Serial.println("LOG: " + message);
}

void addHistory(String event, String idCode, String action, String method, String servoType, String triggerSource) {
    if (historycount < 20) {
        history[historycount].event = event;
        history[historycount].idCode = idCode;
        history[historycount].action = action;
        history[historycount].method = "RFID"; // Always RFID

        if (servoType.isEmpty()) {
            if (action == "ENTER" || action == "Entry") {
                history[historycount].servoType = "ENTRY_GATE";
            } else if (action == "EXIT" || action == "Exit") {
                history[historycount].servoType = "EXIT_GATE";
            } else {
                history[historycount].servoType = parkingData.entryGateOpen ? "ENTRY_GATE" : (parkingData.exitGateOpen ? "EXIT_GATE" : "N/A");
            }
        } else {
            history[historycount].servoType = servoType;
        }

        history[historycount].triggerSource = triggerSource;
        history[historycount].timestamp = timeClient.getFormattedTime();
        historycount++;
    } else {
        for (int i = 0; i < 19; i++) {
            history[i] = history[i + 1];
        }
        history[19].event = event;
        history[19].idCode = idCode;
        history[19].action = action;
        history[19].method = "RFID"; // Always RFID
        
        if (servoType.isEmpty()) {
            if (action == "ENTER" || action == "Entry") {
                history[19].servoType = "ENTRY_GATE";
            } else if (action == "EXIT" || action == "Exit") {
                history[19].servoType = "EXIT_GATE";
            } else {
                history[19].servoType = parkingData.entryGateOpen ? "ENTRY_GATE" : (parkingData.exitGateOpen ? "EXIT_GATE" : "N/A");
            }
        } else {
            history[19].servoType = servoType;
        }

        history[19].triggerSource = triggerSource;
        history[19].timestamp = timeClient.getFormattedTime();
    }

    if (wsConnected) {
        sendHistoryUpdate();
    }

    String logMessage = "History: " + event + " | Code: " + idCode + " | Action: " + action + 
                       " | Method: RFID | Servo: " + servoType + " | Source: " + triggerSource;
    addLog(logMessage);
}

void sendHistoryUpdate() {
    if (!wsConnected) return;
    
    DynamicJsonDocument historyDoc(3072);
    JsonArray historyArray = historyDoc.createNestedArray("history");
    
    for (int i = 0; i < historycount; i++) {
        JsonObject entry = historyArray.createNestedObject();
        entry["event"] = history[i].event;
        entry["idCode"] = history[i].idCode;
        entry["action"] = history[i].action;
        entry["method"] = "RFID"; // Always RFID
        entry["servoType"] = history[i].servoType;
        entry["triggerSource"] = history[i].triggerSource;
        entry["timestamp"] = history[i].timestamp;
    }
    
    String historyJson;
    serializeJson(historyDoc, historyJson);
    wsClient.sendTXT("{\"type\":\"history\",\"data\":" + historyJson + "}");
}

void notifyServoActivation(String servoType, String triggerMethod, String triggerCode, String triggerSource) {
    if (!wsConnected) return;
    
    if (servoType == "PENDING") {
        servoType = parkingData.entryGateOpen ? "ENTRY_GATE" : (parkingData.exitGateOpen ? "EXIT_GATE" : "N/A");
    }
    
    DynamicJsonDocument doc(512);
    doc["type"] = "servo_activation";
    doc["servoType"] = servoType;
    doc["triggerMethod"] = "RFID"; // Always RFID
    doc["triggerCode"] = triggerCode;
    doc["triggerSource"] = triggerSource;
    doc["timestamp"] = timeClient.getFormattedTime();
    
    String json;
    serializeJson(doc, json);
    wsClient.sendTXT(json);
    
    Serial.println("Servo activation notification sent: " + servoType);
}

int calculateParkingFee(unsigned long entryTime, unsigned long exitTime) {
    unsigned long duration = exitTime - entryTime;
    unsigned long minutes = duration / 60000;
    
    int hours = (minutes < 60) ? 1 : ((minutes + 59) / 60);
    
    String currentTimeStr = timeClient.getFormattedTime();
    int currentHour = currentTimeStr.substring(0, 2).toInt();
    
    String entryTimeStr = getTimeString(entryTime);
    String exitTimeStr = getTimeString(exitTime);
    int entryHour = entryTimeStr.substring(0, 2).toInt();
    int exitHour = exitTimeStr.substring(0, 2).toInt();
    
    int hourlyRate = 0;
    
    bool isFreeTime = false;
    if ((entryHour >= 23 || entryHour <= 5) && (exitHour >= 23 || exitHour <= 5)) {
        isFreeTime = true;
    }
    
    if (isFreeTime) {
        return 0;
    }
    
    if (entryHour >= 6 && entryHour <= 17) {
        hourlyRate = 10000;
    } else if (entryHour >= 18 && entryHour <= 22) {
        hourlyRate = 15000;
    } else {
        return 10000;
    }
    
    return hours * hourlyRate;
}

String getTimeString(unsigned long timeMillis) {
    unsigned long totalSeconds = timeMillis / 1000;
    unsigned long hours = (totalSeconds / 3600) % 24;
    unsigned long minutes = (totalSeconds / 60) % 60;
    unsigned long seconds = totalSeconds % 60;
    
    String timeStr = "";
    if (hours < 10) timeStr += "0";
    timeStr += String(hours) + ":";
    if (minutes < 10) timeStr += "0";
    timeStr += String(minutes) + ":";
    if (seconds < 10) timeStr += "0";
    timeStr += String(seconds);
    
    return timeStr;
}

void addParkingSession(String vehicleCode, String method) {
    for (int i = 0; i < sessionCount; i++) {
        if (activeSessions[i].vehicleCode == vehicleCode && activeSessions[i].isActive) {
            Serial.println("Vehicle already has active session: " + vehicleCode);
            return;
        }
    }
    
    if (sessionCount < 10) {
        activeSessions[sessionCount].vehicleCode = vehicleCode;
        activeSessions[sessionCount].entryTime = millis();
        activeSessions[sessionCount].entryTimeStr = timeClient.getFormattedTime();
        activeSessions[sessionCount].isActive = true;
        activeSessions[sessionCount].method = "RFID"; // Always RFID
        sessionCount++;
        
        Serial.println("Added parking session for: " + vehicleCode);
        addLog("Started parking session: " + vehicleCode + " at " + timeClient.getFormattedTime());
    } else {
        Serial.println("Maximum sessions reached!");
        addLog("Cannot add session - maximum limit reached");
    }
}

// Simplified endParkingSession Ä‘á»ƒ tÆ°Æ¡ng thÃ­ch vá»›i database
int endParkingSession(String vehicleCode) {
    for (int i = 0; i < sessionCount; i++) {
        if (activeSessions[i].vehicleCode == vehicleCode && activeSessions[i].isActive) {
            activeSessions[i].isActive = false;
            
            unsigned long currentTime = millis();
            unsigned long duration = currentTime - activeSessions[i].entryTime;
            unsigned long minutes = duration / 60000;
            unsigned long hours = minutes / 60;
            minutes = minutes % 60;
            
            // Simple local calculation for fallback only
            int localFee = 10000; // Minimum fee
            
            String logMsg = "Local session ended: " + vehicleCode + 
                          ", Duration: " + String(hours) + "h" + String(minutes) + "m";
            addLog(logMsg);
            
            Serial.println("Local session ended for: " + vehicleCode);
            
            // Remove session from array
            for (int j = i; j < sessionCount - 1; j++) {
                activeSessions[j] = activeSessions[j + 1];
            }
            sessionCount--;
            
            return localFee; // Database fee takes priority
        }
    }
    
    Serial.println("No local session found for: " + vehicleCode);
    addLog("No local session found for vehicle: " + vehicleCode);
    
    return -1; // Database will handle this case
}

void showActiveSessions() {
    lcd.clear();
    if (sessionCount == 0) {
        lcd.setCursor(0, 0);
        lcd.print(F("No Active"));
        lcd.setCursor(0, 1);
        lcd.print(F("Sessions"));
        delay(2000);
        return;
    }
    
    for (int i = 0; i < sessionCount; i++) {
        if (activeSessions[i].isActive) {
            unsigned long duration = millis() - activeSessions[i].entryTime;
            unsigned long minutes = duration / 60000;
            unsigned long hours = minutes / 60;
            minutes = minutes % 60;
            
            lcd.clear();
            lcd.setCursor(0, 0);
            lcd.print(F("Code: "));
            lcd.print(activeSessions[i].vehicleCode);
            lcd.setCursor(0, 1);
            lcd.print(String(hours) + "h" + String(minutes) + "m");
            delay(3000);
        }
    }
}

void sendRfidAccessToDatabase(String rfidCode, String action, String servoType) {
    if (!wsConnected) {
        Serial.println("WebSocket not connected, cannot send RFID data");
        // Send error response back to Arduino
        Serial.println("DATABASE_RESPONSE:ERROR");
        return;
    }
    
    DynamicJsonDocument doc(512);
    doc["type"] = "rfid_access";
    doc["data"]["rfidCode"] = rfidCode;
    doc["data"]["action"] = action;
    // doc["data"]["timestamp"] = timeClient.getFormattedTime();
    doc["data"]["servoType"] = servoType;

    time_t now = timeClient.getEpochTime();
    struct tm *timeinfo = gmtime(&now);
    char isoTime[25];
    strftime(isoTime, sizeof(isoTime), "%Y-%m-%dT%H:%M:%SZ", timeinfo);
    doc["data"]["timestamp"] = isoTime;

    Serial.println("=== SENDING TO DATABASE ===");
    Serial.println("RFID Code: " + rfidCode);
    Serial.println("Action: " + action);
    Serial.println("Timestamp: " + String(isoTime));
    Serial.println("Epoch Time: " + String(now));
    Serial.println("===========================");
    
    // Improved slot assignment logic
    String slotInfo = "Unknown";
    if (servoType == "ENTRY_GATE") {
        // TÃ¬m slot trá»‘ng Ä‘á»ƒ gÃ¡n
        for (int i = 0; i < 4; i++) {
            if (useServerStatus && serverParkingData.hasData) {
                if (serverParkingData.slots[i] == 0) { // 0 = available
                    slotInfo = "A" + String(i + 1);
                    break;
                }
            } else {
                if (!parkingData.slots[i]) {
                    slotInfo = "A" + String(i + 1);
                    break;
                }
            }
        }
    } else if (servoType == "EXIT_GATE") {
        slotInfo = "Unknown"; // Database will determine this
    }
    doc["data"]["slotUsed"] = slotInfo;
    
    // Add device info for better tracking
    doc["data"]["deviceId"] = "ESP32_PARKING_SYSTEM";
    doc["data"]["method"] = "RFID";
    
    String rfidJson;
    serializeJson(doc, rfidJson);
    wsClient.sendTXT(rfidJson);
    
    Serial.println("RFID access data sent to database: " + rfidCode + " - " + action);
    addLog("RFID data sent: " + rfidCode + " " + action);
}