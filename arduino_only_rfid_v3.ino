#include <Servo.h>
#include <SPI.h>
#include <MFRC522.h>
#include <EEPROM.h>
#include <ArduinoJson.h>


// RFID Configuration
#define RST_PIN         9
#define SS_PIN          10
MFRC522 rfid(SS_PIN, RST_PIN);


// Servo Configuration
Servo servoEntry;
Servo servoExit;


// IR sensors for parking slots
#define IR_SLOT1        3
#define IR_SLOT2        4
#define IR_SLOT3        7
#define IR_SLOT4        8


// IR sensors for gates
#define IR_ENTRY_GATE   A0
#define IR_EXIT_GATE    A5


// Status LEDs
#define LED_AVAILABLE   A2
#define LED_FULL        A3


// Buzzer
#define BUZZER_PIN      A4


// Servo pins
#define SERVO_ENTRY_PIN 5
#define SERVO_EXIT_PIN  6


// State variables
bool parkingSlots[4] = {false, false, false, false};
const int totalSlots = 4;
int activeVehicles = 0;    // tính bằng RFID
int availableSlots = totalSlots;


// RFID card management - removed keypad code arrays
char authorizedCards[10][9]; // Maximum 10 RFID cards
int cardCount = 0;
unsigned long lastUpdate = 0;
unsigned long lastHeartbeat = 0;


// Gate management variables with sensor logic
unsigned long gateOpenTime = 0;
bool entryGateOpen = false;
bool exitGateOpen = false;
const unsigned long GATE_OPEN_DURATION = 5000; // 5 seconds


// Gate sensor state variables
bool entryGateVehicleDetected = false;
bool exitGateVehicleDetected = false;
bool entryGateVehiclePassed = false;
bool exitGateVehiclePassed = false;


// Vehicle management
struct VehicleInfo {
  char identifier[9];
  unsigned long entryTime;
  bool isActive;
  byte slotNumber;
};
VehicleInfo parkedVehicles[4];


// NEW: Database integration variables
bool databaseMode = true; // Enable database integration
unsigned long lastDatabaseSync = 0;
const unsigned long DATABASE_SYNC_INTERVAL = 2000;


// Function declarations
void loadAuthorizedData();
void updateParkingStatus();
void checkRFID();
void sendHistory(const char* event, const char* idCode, const char* action);
void sendRfidToDatabase(const char* event, const char* idCode, const char* action, const char* servoType);
bool isAuthorizedCard(const char* cardID);
void openEntryGate();
void openExitGate();
void closeAllGates();
void checkGateTimeout();
void sendDataToESP32();
void beep(int duration, int frequency);
void addAuthorizedCard(const char* cardID);
void removeAuthorizedCard(const char* cardID);
void processSerialCommand(String command);
int findVehicleByID(const char* identifier);
int findEmptySlot();
void addVehicle(const char* identifier);
void removeVehicle(int vehicleIndex);
void initializeDefaultCards();
void saveAuthorizedData();
void checkGateSensors();


void setup() {
  Serial.begin(9600);
 
  SPI.begin();
  rfid.PCD_Init();
 
  servoEntry.attach(SERVO_ENTRY_PIN);
  servoExit.attach(SERVO_EXIT_PIN);
  servoEntry.write(0);  // Close entry gate
  servoExit.write(0);   // Close exit gate
 
  // Configure sensors for parking slots
  pinMode(IR_SLOT1, INPUT_PULLUP);
  pinMode(IR_SLOT2, INPUT_PULLUP);
  pinMode(IR_SLOT3, INPUT_PULLUP);
  pinMode(IR_SLOT4, INPUT_PULLUP);
 
  // Configure gate sensors
  pinMode(IR_ENTRY_GATE, INPUT_PULLUP);
  pinMode(IR_EXIT_GATE, INPUT_PULLUP);
 
  pinMode(LED_AVAILABLE, OUTPUT);
  pinMode(LED_FULL, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
 
  loadAuthorizedData();
  initializeDefaultCards();


  // Debug output
  Serial.println(F("=== DEBUG: Loaded authorized cards ==="));
  Serial.print(F("Total cards: "));
  Serial.println(cardCount);
  for (int i = 0; i < cardCount; i++) {
    Serial.print(F("  Card "));
    Serial.print(i);
    Serial.print(F(": '"));
    Serial.print(authorizedCards[i]);
    Serial.print(F("' (length: "));
    Serial.print(strlen(authorizedCards[i]));
    Serial.println(F(")"));
  }
  Serial.println(F("=== END DEBUG ==="));
 
  // Initialize parkedVehicles array
  for (int i = 0; i < 4; i++) {
    memset(parkedVehicles[i].identifier, 0, 9);
    parkedVehicles[i].entryTime = 0;
    parkedVehicles[i].isActive = false;
    parkedVehicles[i].slotNumber = 0;
  }
 
  beep(200, 1000);
  Serial.println(F("RFID-only System initialized with database integration"));
}


void initializeDefaultCards() {
  if (cardCount == 0) {
    const char* defaultCards[] = {
      "8DC56905",  // Card 1
      "0CE06C05",  // Card 2  
      "67A13606",  // Card 3
      "82219504"   // Card 4
    };
   
    for (int i = 0; i < 4; i++) {
      strncpy(authorizedCards[i], defaultCards[i], 8);
      authorizedCards[i][8] = '\0';
      cardCount++;
    }


    saveAuthorizedData();
    Serial.println(F("Default RFID cards added"));
  }
}


void loop() {
  // Check commands from ESP32
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    processSerialCommand(command);
  }
 
  updateParkingStatus();
  checkGateSensors();
  checkRFID(); // Always check RFID - no mode switching needed
  checkGateTimeout();
 
  if (millis() - lastUpdate > 1000) {
    sendDataToESP32();
    lastUpdate = millis();
  }


  if (millis() - lastHeartbeat > 10000) {
    Serial.println(F("ALIVE"));
    lastHeartbeat = millis();
  }
 
  delay(50);
}



void updateParkingStatus() {
  parkingSlots[0] = (digitalRead(IR_SLOT1) == LOW);
  parkingSlots[1] = (digitalRead(IR_SLOT2) == LOW);
  parkingSlots[2] = (digitalRead(IR_SLOT3) == LOW);
  parkingSlots[3] = (digitalRead(IR_SLOT4) == LOW);
 
  // availableSlots = 0;
  // for (int i = 0; i < 4; i++) {
  //   if (!parkingSlots[i]) availableSlots++;
  // }
 
  if (availableSlots > 0) {
    digitalWrite(LED_AVAILABLE, HIGH);
    digitalWrite(LED_FULL, LOW);
  } else {
    digitalWrite(LED_AVAILABLE, LOW);
    digitalWrite(LED_FULL, HIGH);
  }
}


void checkGateSensors() {
  // Read sensor states (LOW = vehicle detected, HIGH = clear with INPUT_PULLUP)
  bool entryDetected = (digitalRead(IR_ENTRY_GATE) == LOW);
  bool exitDetected = (digitalRead(IR_EXIT_GATE) == LOW);
 
  // Handle entry gate sensor
  if (entryGateOpen) {
    if (entryDetected && !entryGateVehicleDetected) {
      // Vehicle just entered sensor zone
      entryGateVehicleDetected = true;
      Serial.println(F("Vehicle detected at entry gate"));
    } else if (!entryDetected && entryGateVehicleDetected && !entryGateVehiclePassed) {
      // Vehicle passed through sensor (from detected to clear)
      entryGateVehiclePassed = true;
      Serial.println(F("Vehicle passed through entry gate"));
     
      // Close gate after vehicle passes
      delay(1000); // Wait 1 second to ensure vehicle has passed
      servoEntry.write(0);
      entryGateOpen = false;
      entryGateVehicleDetected = false;
      entryGateVehiclePassed = false;
      Serial.println(F("Entry gate closed - vehicle passed"));
      beep(300, 1200);
    }
  }
 
  // Handle exit gate sensor
  if (exitGateOpen) {
    if (exitDetected && !exitGateVehicleDetected) {
      // Vehicle just entered sensor zone
      exitGateVehicleDetected = true;
      Serial.println(F("Vehicle detected at exit gate"));
    } else if (!exitDetected && exitGateVehicleDetected && !exitGateVehiclePassed) {
      // Vehicle passed through sensor
      exitGateVehiclePassed = true;
      Serial.println(F("Vehicle passed through exit gate"));
     
      // Close gate after vehicle passes
      delay(1000); // Wait 1 second to ensure vehicle has passed
      servoExit.write(0);
      exitGateOpen = false;
      exitGateVehicleDetected = false;
      exitGateVehiclePassed = false;
      Serial.println(F("Exit gate closed - vehicle passed"));
      beep(300, 1200);
    }
  }
}


void checkRFID() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    return;
  }
 
  char cardID[9];
  memset(cardID, 0, 9);
  for (byte i = 0; i < rfid.uid.size && i < 4; i++) {
    sprintf(cardID + i*2, "%02X", rfid.uid.uidByte[i]);
  }
  cardID[8] = '\0';


  Serial.print(F("RFID detected: "));
  Serial.println(cardID);

  rfid.PICC_HaltA();
 
  if (isAuthorizedCard(cardID)) {
    int vehicleIndex = findVehicleByID(cardID);
    if (vehicleIndex != -1) {
      // Vehicle is parked -> exit
      removeVehicle(vehicleIndex);
      openExitGate();
      Serial.print(F("RFID Exit: "));
      Serial.println(cardID);
     
      //Cập nhật lại số slot còn trống
      availableSlots = totalSlots - activeVehicles;
      if (availableSlots < 0) availableSlots = 0;

      // NEW: Send to database via ESP32
      sendRfidToDatabase("RFID_ACCESS", cardID, "EXIT", "EXIT_GATE");
      sendHistory("RFID", cardID, "Exit"); // Keep legacy format for ESP32 local processing
      beep(200, 1200);
    } else if (availableSlots > 0) {
      // Vehicle not parked - allow entry
      addVehicle(cardID);

      openEntryGate();
      Serial.print(F("RFID Entry: "));
      Serial.println(cardID);
     
      // 🔹 Cập nhật lại số slot còn trống
      availableSlots = totalSlots - activeVehicles;
      if (availableSlots < 0) availableSlots = 0;

      // NEW: Send to database via ESP32
      sendRfidToDatabase("RFID_ACCESS", cardID, "ENTER", "ENTRY_GATE");
      sendHistory("RFID", cardID, "Entry"); // Keep legacy format for ESP32 local processing
      beep(200, 1000);
    } else {
      // Parking full
      Serial.println(F("Parking full"));
      beep(500, 500);
    }
  } else {
    // Unauthorized card
    Serial.println(F("Unauthorized RFID"));
    beep(100, 300);
    delay(100);
    beep(100, 300);
  }
}


void openEntryGate() {
  servoEntry.write(90);
  entryGateOpen = true;
  entryGateVehicleDetected = false;
  entryGateVehiclePassed = false;
  gateOpenTime = millis();
  Serial.println(F("Entry gate opened"));
  beep(300, 1500);
}


void openExitGate() {
  servoExit.write(90);
  exitGateOpen = true;
  exitGateVehicleDetected = false;
  exitGateVehiclePassed = false;
  gateOpenTime = millis();
  Serial.println(F("Exit gate opened"));
  beep(300, 1500);
}


void closeAllGates() {
  bool gatesClosed = false;
 
  if (entryGateOpen) {
    servoEntry.write(0);
    entryGateOpen = false;
    entryGateVehicleDetected = false;
    entryGateVehiclePassed = false;
    Serial.println(F("Entry gate closed"));
    gatesClosed = true;
  }
 
  if (exitGateOpen) {
    servoExit.write(0);
    exitGateOpen = false;
    exitGateVehicleDetected = false;
    exitGateVehiclePassed = false;
    Serial.println(F("Exit gate closed"));
    gatesClosed = true;
  }
 
  if (gatesClosed) {
    beep(300, 1200);
  }
}


void checkGateTimeout() {
  unsigned long currentTime = millis();
 
  // Check timeout for entry gate
  if (entryGateOpen && (currentTime - gateOpenTime > GATE_OPEN_DURATION)) {
    // If no vehicle at sensor after 5 seconds, close gate
    if (!entryGateVehicleDetected) {
      servoEntry.write(0);
      entryGateOpen = false;
      entryGateVehicleDetected = false;
      entryGateVehiclePassed = false;
      Serial.println(F("Entry gate closed due to timeout - no vehicle detected"));
      beep(300, 1200);
    }
    // If vehicle is at sensor, keep gate open and reset timer
    else {
      gateOpenTime = currentTime; // Reset timer to avoid closing gate while vehicle is passing
    }
  }
 
  // Check timeout for exit gate
  if (exitGateOpen && (currentTime - gateOpenTime > GATE_OPEN_DURATION)) {
    // If no vehicle at sensor after 5 seconds, close gate
    if (!exitGateVehicleDetected) {
      servoExit.write(0);
      exitGateOpen = false;
      exitGateVehicleDetected = false;
      exitGateVehiclePassed = false;
      Serial.println(F("Exit gate closed due to timeout - no vehicle detected"));
      beep(300, 1200);
    }
    // If vehicle is at sensor, keep gate open and reset timer
    else {
      gateOpenTime = currentTime; // Reset timer to avoid closing gate while vehicle is passing
    }
  }
}


// NEW: Function to send RFID data to database via ESP32
void sendRfidToDatabase(const char* event, const char* idCode, const char* action, const char* servoType) {
  if (databaseMode) {
    // Send structured data for ESP32 to forward to database
    Serial.print(F("RFID_DATABASE:"));
    Serial.print(event);
    Serial.print(F(","));
    Serial.print(idCode);
    Serial.print(F(","));
    Serial.print(action);
    Serial.print(F(","));
    Serial.print(servoType);
    Serial.print(F(","));
    Serial.println(millis()); // timestamp
   
    lastDatabaseSync = millis();
   
    // Log for debugging
    Serial.print(F("Database sync: "));
    Serial.print(idCode);
    Serial.print(F(" "));
    Serial.println(action);
  }
}


// LEGACY: Keep original sendHistory function for compatibility
void sendHistory(const char* event, const char* idCode, const char* action) {
  Serial.print(F("HISTORY:"));
  Serial.print(event);
  Serial.print(F(","));
  Serial.print(idCode);
  Serial.print(F(","));
  Serial.print(action);
  Serial.print(F(","));
  Serial.println(entryGateOpen ? "ENTRY_GATE" : (exitGateOpen ? "EXIT_GATE" : "N/A"));
}


bool isAuthorizedCard(const char* cardID) {
  for (int i = 0; i < cardCount; i++) {
    if (strcmp(cardID, authorizedCards[i]) == 0) {
      return true;
    }
  }
  return false;
}


void sendDataToESP32() {
  StaticJsonDocument<300> doc;
  doc["available"] = availableSlots;
  doc["total"] = 4;
  JsonArray slots = doc.createNestedArray("slots");
  for (int i = 0; i < 4; i++) {
    slots.add(parkingSlots[i]);
  }
  doc["entryGateOpen"] = entryGateOpen;
  doc["exitGateOpen"] = exitGateOpen;
 
  // Gate sensor information
  doc["entryVehicleDetected"] = entryGateVehicleDetected;
  doc["exitVehicleDetected"] = exitGateVehicleDetected;
 
  // NEW: Database integration info
  doc["databaseMode"] = databaseMode;
  doc["lastDatabaseSync"] = lastDatabaseSync;
  doc["activeVehicles"] = 0;
 
  // Count active vehicles
  for (int i = 0; i < 4; i++) {
    if (parkedVehicles[i].isActive) {
      doc["activeVehicles"] = doc["activeVehicles"].as<int>() + 1;
    }
  }


  String jsonString;
  serializeJson(doc, jsonString);
  Serial.println(jsonString);
}


void beep(int duration, int frequency) {
  tone(BUZZER_PIN, frequency, duration);
  delay(duration);
  noTone(BUZZER_PIN);
}


void loadAuthorizedData() {
  cardCount = EEPROM.read(0);
  if (cardCount > 10 || cardCount < 0) cardCount = 0;
 
  for (int i = 0; i < cardCount; i++) {
    for (int j = 0; j < 8; j++) {
      authorizedCards[i][j] = EEPROM.read(10 + i * 8 + j);
    }
    authorizedCards[i][8] = '\0';
  }
 
  Serial.print(F("Loaded "));
  Serial.print(cardCount);
  Serial.println(F(" cards from EEPROM"));
}


void saveAuthorizedData() {
  EEPROM.update(0, cardCount);
 
  for (int i = 0; i < cardCount; i++) {
    for (int j = 0; j < 8; j++) {
      EEPROM.update(10 + i * 8 + j, authorizedCards[i][j]);
    }
  }
}


void addAuthorizedCard(const char* cardID) {
  if (cardCount < 10) {
    if (isAuthorizedCard(cardID)) {
      Serial.print(F("Card already exists: "));
      Serial.println(cardID);
      return;
    }
   
    strncpy(authorizedCards[cardCount], cardID, 8);
    authorizedCards[cardCount][8] = '\0';
   
    for (int i = 0; i < 8; i++) {
      EEPROM.update(10 + cardCount * 8 + i, authorizedCards[cardCount][i]);
    }
   
    cardCount++;
    EEPROM.update(0, cardCount);
   
    Serial.print(F("Added card: "));
    Serial.println(cardID);
  } else {
    Serial.println(F("Card list full"));
  }
}


void removeAuthorizedCard(const char* cardID) {
  for (int i = 0; i < cardCount; i++) {
    if (strcmp(authorizedCards[i], cardID) == 0) {
      for (int j = i; j < cardCount - 1; j++) {
        strcpy(authorizedCards[j], authorizedCards[j + 1]);
        for (int k = 0; k < 8; k++) {
          EEPROM.update(10 + j * 8 + k, authorizedCards[j][k]);
        }
      }
      cardCount--;
      EEPROM.update(0, cardCount);
     
      Serial.print(F("Removed card: "));
      Serial.println(cardID);
      return;
    }
  }
  Serial.println(F("Card not found"));
}


void processSerialCommand(String command) {
  if (command.startsWith("MODE_CHANGE:")) {
    // Acknowledge mode change but always stay in RFID mode
    Serial.println("MODE_CHANGED:RFID");
  } else if (command.startsWith("ADD_CARD:")) {
    String cardID = command.substring(9);
    addAuthorizedCard(cardID.c_str());
  } else if (command.startsWith("REMOVE_CARD:")) {
    String cardID = command.substring(12);
    removeAuthorizedCard(cardID.c_str());
  } else if (command == "OPEN_ENTRY_GATE") {
    openEntryGate();
  } else if (command == "OPEN_EXIT_GATE") {
    openExitGate();
  } else if (command == "CLOSE_GATES") {
    closeAllGates();
  } else if (command.startsWith("BEEP:")) {
    int comma = command.indexOf(',');
    if (comma != -1) {
      int duration = command.substring(5, comma).toInt();
      int frequency = command.substring(comma + 1).toInt();
      beep(duration, frequency);
    }
  } else if (command == "LIST_CARDS") {
    Serial.print(F("Authorized Cards ("));
    Serial.print(cardCount);
    Serial.println(F("):"));
    for (int i = 0; i < cardCount; i++) {
      Serial.print(F("  "));
      Serial.print(i + 1);
      Serial.print(F(": "));
      Serial.println(authorizedCards[i]);
    }
  } else if (command == "LIST_VEHICLES") {
    Serial.println(F("Parked Vehicles:"));
    for (int i = 0; i < 4; i++) {
      if (parkedVehicles[i].isActive) {
        Serial.print(F("  Slot "));
        Serial.print(i + 1);
        Serial.print(F(": "));
        Serial.print(parkedVehicles[i].identifier);
        Serial.println(F(" (RFID)"));
      }
    }
  } else if (command == "DEBUG_CARDS") {
    Serial.println(F("=== CARD DEBUG INFO ==="));
    Serial.print(F("cardCount: "));
    Serial.println(cardCount);
    for (int i = 0; i < cardCount; i++) {
      Serial.print(F("Card "));
      Serial.print(i);
      Serial.print(F(": '"));
      Serial.print(authorizedCards[i]);
      Serial.print(F("' Length: "));
      Serial.print(strlen(authorizedCards[i]));
      Serial.print(F(" Bytes: "));
      for (int j = 0; j < 8; j++) {
        Serial.print((int)authorizedCards[i][j]);
        Serial.print(F(" "));
      }
      Serial.println();
    }
  } else if (command == "CLEAR_EEPROM") {
    Serial.println(F("Clearing EEPROM and resetting..."));
    cardCount = 0;
    EEPROM.update(0, 0);
    Serial.println(F("EEPROM cleared. Restart to reload defaults."));
  } else if (command == "DEBUG_GATE_SENSORS") {
    Serial.println(F("=== GATE SENSORS DEBUG ==="));
    Serial.print(F("Entry Gate Sensor: "));
    Serial.println(digitalRead(IR_ENTRY_GATE) == LOW ? F("DETECTED") : F("CLEAR"));
    Serial.print(F("Exit Gate Sensor: "));
    Serial.println(digitalRead(IR_EXIT_GATE) == LOW ? F("DETECTED") : F("CLEAR"));
    Serial.print(F("Entry Gate Open: "));
    Serial.println(entryGateOpen ? F("YES") : F("NO"));
    Serial.print(F("Exit Gate Open: "));
    Serial.println(exitGateOpen ? F("YES") : F("NO"));
    Serial.print(F("Entry Vehicle Detected: "));
    Serial.println(entryGateVehicleDetected ? F("YES") : F("NO"));
    Serial.print(F("Exit Vehicle Detected: "));
    Serial.println(exitGateVehicleDetected ? F("YES") : F("NO"));
    Serial.println(F("=== END DEBUG ==="));
  } else if (command == "DATABASE_STATUS") {
    // NEW: Check database integration status
    Serial.println(F("=== DATABASE STATUS ==="));
    Serial.print(F("Database Mode: "));
    Serial.println(databaseMode ? F("ENABLED") : F("DISABLED"));
    Serial.print(F("Last Sync: "));
    Serial.println(lastDatabaseSync);
    Serial.print(F("Sync Interval: "));
    Serial.println(DATABASE_SYNC_INTERVAL);
    Serial.println(F("=== END STATUS ==="));
  } else if (command.startsWith("DATABASE_RESPONSE:")) {
    // NEW: Handle database response from ESP32
    String response = command.substring(18);
    Serial.print(F("Database response: "));
    Serial.println(response);
   
    if (response == "SUCCESS") {
      Serial.println(F("Database sync successful"));
      beep(100, 1800); // Success beep
    } else if (response == "ERROR") {
      Serial.println(F("Database sync failed"));
      beep(200, 400); // Error beep
    }
  } else if (command == "ENABLE_DATABASE") {
    databaseMode = true;
    Serial.println(F("Database mode enabled"));
  } else if (command == "DISABLE_DATABASE") {
    databaseMode = false;
    Serial.println(F("Database mode disabled"));
  }
}


int findVehicleByID(const char* identifier) {
  for (int i = 0; i < 4; i++) {
    if (parkedVehicles[i].isActive &&
        strcmp(parkedVehicles[i].identifier, identifier) == 0) {
      return i;
    }
  }
  return -1;
}


int findEmptySlot() {
  for (int i = 0; i < 4; i++) {
    if (!parkedVehicles[i].isActive) {
      return i;
    }
  }
  return -1;
}


void addVehicle(const char* identifier) {
  int slotIndex = findEmptySlot();
  if (slotIndex != -1) {
    parkedVehicles[slotIndex].isActive = true;
    parkedVehicles[slotIndex].slotNumber = slotIndex + 1;
    parkedVehicles[slotIndex].entryTime = millis();
    strncpy(parkedVehicles[slotIndex].identifier, identifier, 8);
    parkedVehicles[slotIndex].identifier[8] = '\0';

    activeVehicles++;  // 🔹 tăng số xe trong bãi
   
    Serial.print(F("Vehicle added to slot "));
    Serial.print(slotIndex + 1);
    Serial.print(F(": "));
    Serial.print(identifier);
    Serial.println(F(" (RFID)"));
   
    // NEW: Log vehicle entry for database
    Serial.print(F("VEHICLE_ENTRY:"));
    Serial.print(identifier);
    Serial.print(F(","));
    Serial.print(slotIndex + 1);
    Serial.print(F(","));
    Serial.println(millis());
  }
}


void removeVehicle(int vehicleIndex) {
  Serial.print(F("Vehicle removed from slot "));
  Serial.print(vehicleIndex + 1);
  Serial.print(F(": "));
  Serial.print(parkedVehicles[vehicleIndex].identifier);
  Serial.println(F(" (RFID)"));
 
  // NEW: Log vehicle exit for database before clearing data
  Serial.print(F("VEHICLE_EXIT:"));
  Serial.print(parkedVehicles[vehicleIndex].identifier);
  Serial.print(F(","));
  Serial.print(vehicleIndex + 1);
  Serial.print(F(","));
  Serial.print(parkedVehicles[vehicleIndex].entryTime);
  Serial.print(F(","));
  Serial.println(millis());
 
  if (activeVehicles > 0) activeVehicles--;

  parkedVehicles[vehicleIndex].isActive = false;
  parkedVehicles[vehicleIndex].slotNumber = 0;
  parkedVehicles[vehicleIndex].entryTime = 0;
  memset(parkedVehicles[vehicleIndex].identifier, 0, 9);
}

