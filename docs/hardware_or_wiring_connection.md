# Detection Algorithm

Step 1: Read supply current (Is)

Step 2: Read load current (Il)

Step 3: Compute difference

difference = |Is - Il|

Step 4: Compare with threshold

if difference > threshold:
    theft detected
else:
    normal operation

Step 5: Upload to Firebase

Step 6: Update dashboard
