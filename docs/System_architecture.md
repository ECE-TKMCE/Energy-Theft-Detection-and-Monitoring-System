# System Architecture

The system consists of three layers:

Sensing Layer:
- PZEM Supply Sensor
- PZEM Load Sensor

Processing Layer:
- ESP32
- Edge Detection Algorithm

Cloud Layer:
- Firebase Database
- Web Dashboard

Data Flow:

Supply → PZEM1 → ESP32
Load → PZEM2 → ESP32

ESP32:
Compute difference
Check threshold
Upload to cloud
Display dashboard
