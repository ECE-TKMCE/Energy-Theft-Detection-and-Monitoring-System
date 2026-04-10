#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <PZEM004Tv30.h>
#include <ESP_Mail_Client.h>

// Required for the Firebase library
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ==========================================
// 1. WI-FI & FIREBASE CREDENTIALS
// ==========================================
#define WIFI_SSID "INSERT WIFI USER"
#define WIFI_PASSWORD "INSERT WIFI PASS"

#define API_KEY "INSERT API KEY"
#define DATABASE_URL "https://theftguard-iot-default-rtdb.asia-southeast1.firebasedatabase.app"

// ==========================================
// 2. EMAIL (SMTP) CREDENTIALS
// ==========================================
#define SMTP_HOST "smtp.gmail.com"
#define SMTP_PORT 465

// The email sending the alert (Must use a 16-digit Google App Password)
#define AUTHOR_EMAIL "INSERT AUTHOR EMAIL"
#define AUTHOR_PASSWORD "INSERT AUTHOR PASS" 

// The email receiving the alert
#define RECIPIENT_EMAIL "RECIPIENT EMAIL"

// ==========================================
// 3. HARDWARE PINS (FINALIZED)
// ==========================================
#define RELAY_PIN 23  // Relay IN

// PZEM 1 (Grid Source / Pole)
#define PZEM1_RX_PIN 4
#define PZEM1_TX_PIN 5

// PZEM 2 (House Load)
#define PZEM2_RX_PIN 18
#define PZEM2_TX_PIN 19

// Initialize PZEMs on Hardware Serial 1 and 2
PZEM004Tv30 pzemSource(Serial1, PZEM1_RX_PIN, PZEM1_TX_PIN);
PZEM004Tv30 pzemLoad(Serial2, PZEM2_RX_PIN, PZEM2_TX_PIN);

// ==========================================
// 4. GLOBAL VARIABLES
// ==========================================
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

String deviceMac = "";
String dbPath = "";

unsigned long sendDataPrevMillis = 0;
// Lowered to 1 second (1000ms) for real-time responsiveness!
const long timerDelay = 1000; 

SMTPSession smtp;
bool theftEmailSent = false; // Anti-spam lock

// ==========================================
// SETUP FUNCTION
// ==========================================
void setup() {
  Serial.begin(115200);

  // 1. Setup Relay (Default to HIGH / Normally Closed / Power ON)
  pinMode(RELAY_PIN, OUTPUT_OPEN_DRAIN);
  digitalWrite(RELAY_PIN, HIGH);

  // 2. Connect to Wi-Fi
  Serial.print("Connecting to Wi-Fi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
  }
  Serial.println("\n✅ Wi-Fi Connected!");

  // Get MAC Address to use as the Firebase folder name
  deviceMac = WiFi.macAddress();
  dbPath = "live_grid/" + deviceMac;
  Serial.println("Device MAC: " + deviceMac);

  // 3. Setup Firebase
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println("✅ Firebase Authenticated");
  } else {
    Serial.printf("❌ Firebase Error: %s\n", config.signer.signupError.message.c_str());
  }
  config.token_status_callback = tokenStatusCallback;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // 4. Setup SMTP (Email)
  smtp.debug(0); 
}

// ==========================================
// LOOP FUNCTION
// ==========================================
void loop() {
  if (Firebase.ready() && (millis() - sendDataPrevMillis > timerDelay || sendDataPrevMillis == 0)) {
    sendDataPrevMillis = millis();

    // Make these static so they remember their value between loops
    static float prevSourceI = 0.00;
    static float prevLoadI = 0.00;

    // 1. Read Sensors
    float sourceVoltage = pzemSource.voltage();
    float loadVoltage = pzemLoad.voltage();
    float sourceCurrentRaw = pzemSource.current();
    float loadCurrentRaw = pzemLoad.current();

    if (isnan(sourceVoltage)) sourceVoltage = 0.00;
    if (isnan(loadVoltage)) loadVoltage = 0.00;
    if (isnan(sourceCurrentRaw)) sourceCurrentRaw = 0.00;
    if (isnan(loadCurrentRaw)) loadCurrentRaw = 0.00;

    // 🛑 2. SNAP-TO-ZERO & DEADBAND FILTER
    
    // If the value drops by more than 0.20A instantly AND is under 0.50A, force it to 0
    if ((prevSourceI - sourceCurrentRaw) > 0.20 && sourceCurrentRaw < 0.50) {
      sourceCurrentRaw = 0.00;
    }
    if ((prevLoadI - loadCurrentRaw) > 0.20 && loadCurrentRaw < 0.50) {
      loadCurrentRaw = 0.00;
    }

    // Standard Deadband (Ignore vampire power under 0.10A)
    float sourceCurrent = (sourceCurrentRaw < 0.10) ? 0.00 : sourceCurrentRaw;
    float loadCurrent = (loadCurrentRaw < 0.10) ? 0.00 : loadCurrentRaw;

    // Save current readings for the next loop's comparison
    prevSourceI = sourceCurrent;
    prevLoadI = loadCurrent;

    // Print to Serial Monitor
    Serial.printf("Source V: %.1fV | Load V: %.1fV | Source A: %.2f A | Load A: %.2f A\n", sourceVoltage, loadVoltage, sourceCurrent, loadCurrent);

    // 3. FAST BATCH PUSH TO FIREBASE (Eliminates Lag)
    FirebaseJson json;
    json.set("voltage_source", sourceVoltage);
    json.set("voltage_load", loadVoltage);
    json.set("pole", sourceCurrent);
    json.set("house", loadCurrent);
    
    // Push the JSON package in a single network request
    Firebase.RTDB.updateNode(&fbdo, dbPath, &json);
    
    // Push heartbeat timestamp
    Firebase.RTDB.setTimestamp(&fbdo, dbPath + "/last_seen");

    // 4. Listen for Relay Command from Dashboard
    if (Firebase.RTDB.getBool(&fbdo, dbPath + "/relay_cutoff")) {
      bool isCutoff = fbdo.boolData();
      if (isCutoff) {
        digitalWrite(RELAY_PIN, LOW); // Trigger Relay (Cut Power)
      } else {
        digitalWrite(RELAY_PIN, HIGH); // Relax Relay (Restore Power)
      }
    }

    // 5. THEFT DETECTION & EMAIL LOGIC (0.15A Threshold)
    float difference = abs(sourceCurrent - loadCurrent);

    if (difference > 0.15 && !theftEmailSent) {
      Serial.println("🚨 THEFT DETECTED! Difference: " + String(difference) + "A");
      sendTheftEmail(difference);
      theftEmailSent = true; // Lock the email so it doesn't spam
    } 
    else if (difference <= 0.15 && theftEmailSent) {
      Serial.println("✅ System Normal. Resetting email lock.");
      theftEmailSent = false; // Unlock so it can trigger again if a new theft occurs
    }
  }
}

// ==========================================
// HELPER: SEND EMAIL FUNCTION
// ==========================================
void sendTheftEmail(float lostAmps) {
  Session_Config smtpConfig;
  smtpConfig.server.host_name = SMTP_HOST;
  smtpConfig.server.port = SMTP_PORT;
  smtpConfig.login.email = AUTHOR_EMAIL;
  smtpConfig.login.password = AUTHOR_PASSWORD;
  smtpConfig.login.user_domain = "";

  SMTP_Message message;
  message.sender.name = "TheftGuard ESP32";
  message.sender.email = AUTHOR_EMAIL;
  message.subject = "🚨 CRITICAL: Power Theft Detected!";
  message.addRecipient("Admin", RECIPIENT_EMAIL);

  // Email Body
  String htmlMsg = "<h2 style='color:red;'>TheftGuard Alert</h2>";
  htmlMsg += "<p>A critical discrepancy has been detected on your power grid.</p>";
  htmlMsg += "<h3>Current Bypass: <b>" + String(lostAmps) + " Amps</b></h3>";
  htmlMsg += "<p>Please check the web dashboard immediately to execute an emergency cutoff.</p>";
  
  message.html.content = htmlMsg.c_str();
  message.text.content = "Theft Detected! Bypass: " + String(lostAmps) + " Amps.";

  if (!smtp.connect(&smtpConfig)) {
    Serial.println("Email connection failed.");
    return;
  }
  
  if (!MailClient.sendMail(&smtp, &message)) {
    Serial.println("Error sending Email: " + smtp.errorReason());
  } else {
    Serial.println("✅ Email sent successfully!");
  }
}
