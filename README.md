# Energy Theft Detection System using ESP32

TheftGuard is an IoT-based real-time energy monitoring and theft detection system built using ESP32 and dual PZEM-004T energy measurement modules. The system performs edge-based anomaly detection by comparing supply-side and load-side current to identify unauthorized power consumption.

## 🚀 Features

- Dual-point current sensing
- Edge-based theft detection
- ESP32 real-time processing
- Firebase cloud integration
- Live monitoring dashboard (PWA)
- Sub-500 ms response time
- >98.5% detection accuracy
- Low-cost scalable architecture

---

## 🧠 System Architecture

The system is divided into three layers:

### 1. Sensing Layer
- PZEM-004T (Supply side)
- PZEM-004T (Load side)

### 2. Processing Layer
- ESP32 Microcontroller
- Edge-based comparison algorithm

### 3. Cloud Layer
- Firebase Realtime Database
- Web dashboard (PWA)

---

## ⚙️ Working Principle

The system continuously reads:

- Supply-side current (Is)
- Load-side current (Il)

Detection logic:
difference = |Is - Il|

if difference > threshold:
theft detected

Upon detection:
- Alert triggered
- Data uploaded to Firebase
- Dashboard updated

---

## 🔧 Hardware Components

- ESP32 Development Board
- 2 × PZEM-004T Energy Meter
- Hi-Link AC-DC SMPS (230V → 5V)
- AC Load
- Power Source
- WiFi Network

---

## 🔌 Communication Architecture

- ESP32 ↔ PZEM modules → UART
- ESP32 → Firebase → WiFi

---

## 📊 Performance

Detection Accuracy: >98.5%  
Response Latency: <500 ms  
Stable continuous operation  
Low false positive rate  

---

## 📁 Repository Structure
firmware/ ESP32 code
hardware/ circuit diagrams
docs/ architecture
dashboard/ web interface
---

## 🎯 Applications

- Smart Grid Monitoring
- Energy Theft Detection
- Industrial Power Monitoring
- Residential Energy Security
- Distribution Network Monitoring

---

## 👨‍💻 Author

Noel Varghese George  
ECE | Embedded Systems | IoT | VLSI (Learning)

LinkedIn: https://linkedin.com/in/noel-varghese-george-a44333328  
GitHub: https://github.com/Noel01042006
