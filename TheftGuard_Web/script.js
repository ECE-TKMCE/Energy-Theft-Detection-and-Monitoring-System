// ==========================================
// 1. FIREBASE SETUP & GLOBAL VARIABLES
// ==========================================

const firebaseConfig = {
    apiKey: "API KEY",
    authDomain: "Domain",
    databaseURL: "database url",
    projectId: "theftguard-iot",
    storageBucket: "theftguard-iot.firebasestorage.app",
    messagingSenderId: "466492128446",
    appId: "Insert app id"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const auth = firebase.auth();

let currentUserUid = null;
let currentDeviceRef = null;
let isLoginMode = true; 
// 1. Initialize messaging here in the global scope
const messaging = firebase.messaging();

// 2. Wrap the permission request inside a FUNCTION so it doesn't run instantly
function enableNotifications() {
    Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
            console.log('Notification permission granted.');
            
            // Generate Token
            messaging.getToken({ vapidKey: 'BP1gFNXwoiHsh-C1aQviKT4P_CV0xsbEUu0nrWBzQwKSzdxTeIHajwTnZ0Ggob91w3Olxgq2LiJC2MDVEQAcN6A' }).then((currentToken) => {
                if (currentToken) {
                    console.log('YOUR DEVICE TOKEN IS:', currentToken);
                    
                    // Optional: Save to database under the logged-in user
                    if (currentUserUid) {
                        firebase.database().ref('users/' + currentUserUid + '/fcm_token').set(currentToken);
                    }
                }
            });
        }
    });
}

// 3. Catch notifications while the app is open
messaging.onMessage((payload) => {
    alert("🚨 " + payload.notification.title + "\n" + payload.notification.body);
});

const relayToggle = document.getElementById('relayToggle');
const relayStatusText = document.getElementById('relayStatusText');

let liveHouseData = Array(60).fill(0);
let livePoleData = Array(60).fill(0);
let liveTimeLabels = Array(60).fill('');

let totalKWhConsumed = 0; 
let currentGraphType = 'amps'; // Added for dynamic graph

let liveLoadVoltData = Array(60).fill(0);
let liveLoadWattsData = Array(60).fill(0);

// ==========================================
// 2. DEVICE PAIRING & LIVE LISTENER
// ==========================================

function loadPairedDevice() {
    document.getElementById('nav-pair').style.display = 'inline-block'; 
    database.ref('users/' + currentUserUid + '/paired_device').once('value').then((snapshot) => {
        const macAddress = snapshot.val();
        if (macAddress) {
            document.getElementById('pairedDeviceLabel').innerText = "✅ Connected to: " + macAddress;
            document.getElementById('macInput').value = macAddress;
            startListeningToDevice(macAddress);
        } else {
            document.getElementById('pairedDeviceLabel').innerText = "⚠️ No device paired yet. Please enter your hardware MAC.";
        }
    });
}

function pairDevice() {
    const mac = document.getElementById('macInput').value.trim().toUpperCase();
    if (!mac) return alert("Please enter a valid MAC address.");
    database.ref('users/' + currentUserUid + '/paired_device').set(mac).then(() => {
        alert("Device paired successfully!");
        document.getElementById('pairedDeviceLabel').innerText = "✅ Connected to: " + mac;
        startListeningToDevice(mac); 
        bootstrap.Modal.getInstance(document.getElementById('pairingModal')).hide();
    });
}

relayToggle.addEventListener('change', (e) => {
    const isCutoff = e.target.checked;
    if (currentDeviceRef) {
        currentDeviceRef.child('relay_cutoff').set(isCutoff);
    } else {
        if (isCutoff) {
            relayStatusText.innerText = "⚠️ POWER CUT (Not Paired)";
            relayStatusText.style.color = "#ff3b30";
        } else {
            relayStatusText.innerText = "Power is ON (Not Paired)";
            relayStatusText.style.color = "#4CAF50";
        }
    }
});

function formatUnit(value, unit) {
    if (unit === 'W' && value >= 1000) return (value / 1000).toFixed(2) + " kW";
    if (unit === 'A' && value < 1 && value > 0) return (value * 1000).toFixed(0) + " mA";
    return value.toFixed(unit === 'V' ? 1 : 2) + " " + unit;
}

function startListeningToDevice(macAddress) {
    if (currentDeviceRef) currentDeviceRef.off(); 
    currentDeviceRef = database.ref('live_grid/' + macAddress);
    console.log('Listening to device at path: live_grid/' + macAddress);
    
    currentDeviceRef.on('value', (snapshot) => {
        const data = snapshot.val();
        console.log('Received data from Firebase:', data);
        
        // Check offline status
        const lastSeen = data ? (data.last_seen || 0) : 0;
        const now = Date.now();
        const warningBanner = document.getElementById('offlineWarning');
        warningBanner.style.display = (!data || now - lastSeen > 30000) ? "block" : "none";
        
        if (data) {

            // -- 2. SENSOR LOGIC (DUAL VOLTAGE & WATTS) --
            const sourceVolt = data.source_voltage || 0;
            const loadVolt = data.load_voltage || 0;
            let poleValRaw = data.source_current !== undefined ? parseFloat(data.source_current) : 0.00;
            let houseValRaw = data.load_current !== undefined ? parseFloat(data.load_current) : 0.00;
            
            if (poleValRaw < 0.10) poleValRaw = 0.00; 
            if (houseValRaw < 0.10) houseValRaw = 0.00; 

            const sourceWatts = sourceVolt * poleValRaw;
            const loadWatts = loadVolt * houseValRaw;
            
            document.getElementById('sourceVoltageDisplay').innerText = formatUnit(sourceVolt, 'V');
            document.getElementById('loadVoltageDisplay').innerText = formatUnit(loadVolt, 'V');
            document.getElementById('poleCurrent').innerText = formatUnit(poleValRaw, 'A');
            document.getElementById('houseCurrent').innerText = formatUnit(houseValRaw, 'A');
            document.getElementById('sourceWattsDisplay').innerText = formatUnit(sourceWatts, 'W');
            document.getElementById('loadWattsDisplay').innerText = formatUnit(loadWatts, 'W');
            
            updateLiveCharts(houseValRaw, poleValRaw, loadVolt, loadWatts);
            
            // -- 3. ALERT LOGIC --
            const banner = document.getElementById('theftAlertBanner');
            let currentDiff = Math.abs(poleValRaw - houseValRaw);
            if (currentDiff > 0.15) {
                document.querySelectorAll('.card-custom')[1].classList.add('theft-active');
                document.querySelectorAll('.card-custom')[3].classList.add('theft-active'); 
                banner.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-2"></i> CRITICAL ALERT: THEFT DETECTED (${currentDiff.toFixed(2)}A LOSS)`;
                banner.style.display = "block"; 
            } else {
                document.querySelectorAll('.card-custom').forEach(el => el.classList.remove('theft-active'));
                banner.style.display = "none"; 
            }

            // -- 4. DYNAMIC COST CALCULATION --
            const ratePerUnit = parseFloat(document.getElementById('unitRate').value) || 7.5;
            const kwhThisTick = (loadWatts * (2 / 3600)) / 1000;
            totalKWhConsumed += kwhThisTick;

            const totalCost = (totalKWhConsumed * ratePerUnit).toFixed(2);
            document.getElementById('calculatedTotal').innerText = "₹ " + totalCost;
            document.getElementById('costPageTotal').innerText = "₹ " + totalCost;
            document.getElementById('totalUnitsText').innerText = totalKWhConsumed.toFixed(4);
            document.getElementById('consumedKwhDisplay').innerText = `Consumed: ${totalKWhConsumed.toFixed(4)} kWh`;

            // -- 5. RELAY CUTOFF SYNC --
            const isCutoff = data.relay_cutoff === true;
            if (relayToggle.checked !== isCutoff) {
                relayToggle.checked = isCutoff;
            }
            if (isCutoff) {
                relayStatusText.innerText = "⚠️ POWER CUT";
                relayStatusText.style.color = "#ff3b30"; 
            } else {
                relayStatusText.innerText = "Power is ON";
                relayStatusText.style.color = "#4CAF50"; 
            }
        }
    });
}

function changeGraphMeasurement() {
    currentGraphType = document.getElementById('measurementSelect').value;
    updateGraphDisplay();
}

function updateGraphDisplay() {
    let dataSet = [];
    let color = '#0a84ff';
    let unit = 'A';
    
    if (currentGraphType === 'amps') {
        dataSet = liveHouseData;
        color = '#0a84ff';
        unit = 'A';
    } else if (currentGraphType === 'volts') {
        dataSet = liveLoadVoltData;
        color = '#30d158';
        unit = 'V';
    } else if (currentGraphType === 'watts') {
        dataSet = liveLoadWattsData;
        color = '#ffcc00';
        unit = 'W';
    }

    usageChart.data.datasets[0].data = dataSet;
    usageChart.data.datasets[0].borderColor = color;
    usageChart.data.datasets[0].backgroundColor = color + '1A';
    document.getElementById('totalUsageDisplay').innerText = formatUnit(dataSet[59], unit);
    usageChart.update('none');
}

function updateLiveCharts(newHouseVal, newPoleVal, loadVolt, loadWatts) {
    const now = new Date();
    const timeString = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    liveHouseData.shift(); liveHouseData.push(newHouseVal);
    livePoleData.shift(); livePoleData.push(newPoleVal);
    liveLoadVoltData.shift(); liveLoadVoltData.push(loadVolt);
    liveLoadWattsData.shift(); liveLoadWattsData.push(loadWatts);
    liveTimeLabels.shift(); liveTimeLabels.push(timeString);
    
    if (document.querySelectorAll('.view-tab')[0].classList.contains('active') || document.querySelectorAll('.view-tab')[1].classList.contains('active')) {
        usageChart.data.labels = liveTimeLabels;
        updateGraphDisplay();
    }
    
    if (document.querySelectorAll('.source-tab')[0].classList.contains('active') || document.querySelectorAll('.source-tab')[1].classList.contains('active')) {
        sourceChart.data.labels = liveTimeLabels;
        sourceChart.data.datasets[0].data = livePoleData;
        sourceChart.update('none');
        document.getElementById('sourceTotalDisplay').innerText = newPoleVal.toFixed(2) + " A";
    }
}

document.getElementById('unitRate').addEventListener('input', () => {
    const ratePerUnit = parseFloat(document.getElementById('unitRate').value) || 7.5;
    const totalCost = (totalKWhConsumed * ratePerUnit).toFixed(2);
    document.getElementById('calculatedTotal').innerText = "₹ " + totalCost;
    document.getElementById('costPageTotal').innerText = "₹ " + totalCost;
});

// ==========================================
// 3. FIREBASE AUTHENTICATION & UI FLOW
// ==========================================

auth.onAuthStateChanged((user) => {
    if (user && user.emailVerified) {
        currentUserUid = user.uid; 
        
        // Hide Landing, Show Dashboard App
        document.getElementById('landingPage').style.display = 'none';
        document.getElementById('mainNavbar').style.display = 'flex';
        document.getElementById('dashboardPage').style.display = 'block';
        
        document.getElementById('userProfile').style.display = 'flex';
        const username = user.displayName ? user.displayName.toUpperCase() : user.email.split('@')[0].toUpperCase();
        document.getElementById('userNameDisplay').innerText = username;
        loadPairedDevice(); 
        enableNotifications(); // Enable notifications after login 
        
        // Close modal if open
        const modalEl = document.getElementById('authModal');
        if(modalEl.classList.contains('show')){
            bootstrap.Modal.getInstance(modalEl).hide();
        }
        
    } else if (user && !user.emailVerified) {
        auth.signOut();
    } else {
        // Logged out state: Show Landing, Hide App
        document.getElementById('landingPage').style.display = 'flex';
        document.getElementById('mainNavbar').style.display = 'none';
        document.getElementById('dashboardPage').style.display = 'none';
    }
});

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Toggle between Login and Register in the Modal
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('authTitle');
    const subtitle = document.getElementById('authSubtitle');
    const btn = document.getElementById('authSubmitBtn');
    const toggleText = document.getElementById('authToggleText');
    const toggleLink = document.querySelector('.auth-toggle-link');
    const forgotPw = document.getElementById('forgotPasswordContainer');

    if(isLoginMode) {
        title.innerText = "Welcome Back";
        subtitle.innerText = "Please enter your details to sign in.";
        btn.innerText = "Sign In";
        toggleText.innerText = "Don't have an account?";
        toggleLink.innerText = "Sign up";
        forgotPw.style.display = "block";
    } else {
        title.innerText = "Create Account";
        subtitle.innerText = "Register to monitor your energy grid.";
        btn.innerText = "Register";
        toggleText.innerText = "Already have an account?";
        toggleLink.innerText = "Sign in";
        forgotPw.style.display = "none";
    }
}

function submitAuth(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const btn = document.getElementById('authSubmitBtn');

    if (!isValidEmail(email)) return alert("Please enter a valid email address.");
    
    if (!isLoginMode && password.length < 6) {
        return alert("Firebase requires passwords to be at least 6 characters long.");
    }

    btn.innerText = "Processing..."; btn.disabled = true;

    if (isLoginMode) {
        auth.signInWithEmailAndPassword(email, password).then((userCredential) => {
            if (!userCredential.user.emailVerified) {
                alert("Access Denied: Please verify your email address first.");
                auth.signOut(); 
                btn.innerText = "Sign In"; btn.disabled = false; 
                return;
            }
            btn.innerText = "Sign In"; btn.disabled = false;
        }).catch((error) => {
            alert("Login Failed: " + error.message);
            btn.innerText = "Sign In"; btn.disabled = false;
        });
    } else {
        auth.createUserWithEmailAndPassword(email, password).then((userCredential) => {
            userCredential.user.sendEmailVerification().then(() => {
                alert("Account created! A verification link has been sent. Please verify before logging in.");
                auth.signOut();
                toggleAuthMode(); // Switch back to login view
                btn.innerText = "Sign In"; btn.disabled = false;
                document.getElementById('authEmail').value = ""; document.getElementById('authPassword').value = "";
            });
        }).catch((error) => {
            alert("Registration Failed: " + error.message);
            btn.innerText = "Register"; btn.disabled = false;
        });
    }
}

function handleForgotPassword() {
    let email = document.getElementById('authEmail').value.trim();
    if (!email) email = prompt("Please enter your registered email address:");
    if (!email) return; 
    if (!isValidEmail(email)) return alert("Please enter a valid email address.");
    auth.sendPasswordResetEmail(email).then(() => {
        alert("A password reset link has been sent to " + email);
    }).catch((error) => alert("Error sending reset email: " + error.message));
}

function handleLogout() {
    showPage('dashboard'); 
    auth.signOut().then(() => {
        currentUserUid = null;
        if (currentDeviceRef) currentDeviceRef.off(); 
        document.getElementById('userProfile').style.display = 'none';
        document.getElementById('nav-pair').style.display = 'none'; 
        
        document.getElementById('sourceVoltageDisplay').innerText = "0.0 V";
        document.getElementById('loadVoltageDisplay').innerText = "0.0 V";
        document.getElementById('poleCurrent').innerText = "0.00 A";
        document.getElementById('houseCurrent').innerText = "0.00 A";
        document.getElementById('sourceWattsDisplay').innerText = "0.0 W";
        document.getElementById('loadWattsDisplay').innerText = "0.0 W";
        
        document.querySelectorAll('.card-custom').forEach(el => el.classList.remove('theft-active'));
        document.getElementById('theftAlertBanner').style.display = "none";
        document.getElementById('offlineWarning').style.display = "none";
        
        relayToggle.checked = false;
        relayStatusText.innerText = "Power is ON";
        relayStatusText.style.color = "#4CAF50";
        
        document.getElementById('authEmail').value = ""; document.getElementById('authPassword').value = "";
        document.getElementById('macInput').value = ""; document.getElementById('pairedDeviceLabel').innerText = "No device paired yet.";
        
        liveHouseData.fill(0); livePoleData.fill(0); liveLoadVoltData.fill(0); liveLoadWattsData.fill(0); liveTimeLabels.fill('');
        usageChart.update(); sourceChart.update();
        totalKWhConsumed = 0;
    });
}

// ==========================================
// 4. ACCOUNT SETTINGS & NAVIGATION
// ==========================================

function changeUsername() {
    const newName = document.getElementById('newUsernameInput').value.trim();
    if (!newName) return alert("Please enter a valid username.");
    const user = auth.currentUser;
    if (user) {
        user.updateProfile({ displayName: newName }).then(() => {
            alert("Username updated!");
            document.getElementById('userNameDisplay').innerText = newName.toUpperCase();
            document.getElementById('newUsernameInput').value = ""; 
        }).catch((error) => alert("Error: " + error.message));
    }
}

function sendPasswordReset() {
    const user = auth.currentUser;
    if (user) {
        auth.sendPasswordResetEmail(user.email).then(() => alert("Reset email sent!"))
        .catch((error) => alert("Error: " + error.message));
    }
}

function showPage(pageId) {
    document.getElementById('dashboardPage').style.display = 'none';
    document.getElementById('controlPage').style.display = 'none';
    document.getElementById('costPage').style.display = 'none';
    document.getElementById('settingsPage').style.display = 'none';
    
    document.getElementById(pageId + 'Page').style.display = 'block';

    document.getElementById('nav-dash').classList.remove('active');
    document.getElementById('nav-control').classList.remove('active');
    document.getElementById('nav-cost').classList.remove('active');
    
    if(pageId === 'dashboard') {
        document.getElementById('nav-dash').classList.add('active');
        usageChart.update(); sourceChart.update();
    }
    if(pageId === 'control') document.getElementById('nav-control').classList.add('active');
    if(pageId === 'cost') {
        document.getElementById('nav-cost').classList.add('active');
        renderCostChart();
    }
}

function renderCostChart() {
    const ctxCost = document.getElementById('costChart').getContext('2d');
    if (window.costChartInstance) { window.costChartInstance.destroy(); }
    window.costChartInstance = new Chart(ctxCost, {
        type: 'bar',
        data: { labels: ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'], datasets: [{ label: 'Bill (₹)', data: [1100, 1250, 1180, 1340, 1290, 1425], backgroundColor: '#30d158', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { position: 'right', grid: { color: '#333' }, ticks: { color: '#8e8e93' } }, x: { grid: { display: false }, ticks: { color: '#8e8e93' } } } }
    });
}

// ==========================================
// 5. CHARTS INITIALIZATION & ONLOAD
// ==========================================

const chartOptions = {
    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
    animation: { duration: 0 }, 
    scales: { 
        y: { position: 'right', grid: { color: '#333' }, ticks: { color: '#8e8e93', font: {size: 10} } }, 
        x: { 
            grid: { display: false }, 
            ticks: { 
                color: '#8e8e93', 
                font: { size: 9 }, 
                autoSkip: true, 
                maxRotation: 0, 
                minRotation: 0,
                maxTicksLimit: 12 
            } 
        } 
    }
};

const usageCtx = document.getElementById('usageChart').getContext('2d');
let usageChart = new Chart(usageCtx, { type: 'line', data: { labels: liveTimeLabels, datasets: [{ data: liveHouseData, borderColor: '#0a84ff', backgroundColor: 'rgba(10, 132, 255, 0.1)', borderWidth: 2, fill: true, pointRadius: 0 }] }, options: JSON.parse(JSON.stringify(chartOptions)) });

const sourceCtx = document.getElementById('sourceChart').getContext('2d');
let sourceChart = new Chart(sourceCtx, { type: 'line', data: { labels: liveTimeLabels, datasets: [{ data: livePoleData, borderColor: '#ffcc00', backgroundColor: 'rgba(255, 204, 0, 0.1)', borderWidth: 2, fill: true, pointRadius: 0 }] }, options: JSON.parse(JSON.stringify(chartOptions)) });

window.onload = function() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    
    document.getElementById('daySelect').value = todayStr;
    document.getElementById('sourceDaySelect').value = todayStr;
    
    setView('minute', document.querySelectorAll('.view-tab')[0]); 
    setSourceView('minute', document.querySelectorAll('.source-tab')[0]); 
};

// ==========================================
// 6. TABS LOGIC (LIVE DATA vs FAKE UI DATA)
// ==========================================

function setView(mode, element) {
    document.querySelectorAll('.view-tabs:first-of-type .view-tab').forEach(el => el.classList.remove('active'));
    if(element) element.classList.add('active');
    
    document.getElementById('weekSubSelector').style.display = 'none';
    document.getElementById('monthSelectorWrapper').style.display = 'none';
    document.getElementById('daySelectorWrapper').style.display = 'none';
    
    usageChart.options.scales.x.grid.display = false;
    usageChart.config.type = (mode === 'minute' || mode === 'hour') ? 'line' : 'bar'; 

    if (mode === 'minute') { 
        document.getElementById('timeLabel').innerText = "Live Real-Time Usage"; 
        document.getElementById('avgLabel').innerText = "Streaming from hardware...";
        updateGraphDisplay();
    } else if (mode === 'hour') {
        document.getElementById('timeLabel').innerText = "Current Session (Last 60 ticks)"; 
        document.getElementById('avgLabel').innerText = "Active Database Feed";
        updateGraphDisplay();
    } else if (mode === 'day') { 
        document.getElementById('daySelectorWrapper').style.display = 'block'; 
        updateDayData(); 
    } else if (mode === 'week') { 
        document.getElementById('weekSubSelector').style.display = 'flex'; 
        setSubWeek(7, document.querySelectorAll('.sub-pill')[3]); 
    } else if (mode === 'month') { 
        document.getElementById('monthSelectorWrapper').style.display = 'block'; 
        updateMonthData(); 
    } else if (mode === 'year') {
        let labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        let data = Array.from({length: 12}, () => Math.random() * 50 + 100);
        let total = data.reduce((a, b) => a + b, 0);
        document.getElementById('timeLabel').innerText = "Year Data (Demo)";
        document.getElementById('totalUsageDisplay').innerText = total.toFixed(1) + " kWh";
        document.getElementById('avgLabel').innerText = "Total: 1.2 MWh";
        usageChart.data.labels = labels; usageChart.data.datasets[0].data = data; usageChart.update();
    }
}

function setSubWeek(weekNum, element) {
    document.querySelectorAll('.sub-pill:not(.source-pill)').forEach(el => el.classList.remove('active'));
    if(element) element.classList.add('active');
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let data = Array.from({length: 7}, () => Math.random() * 10 + weekNum);
    let total = data.reduce((a, b) => a + b, 0);
    document.getElementById('timeLabel').innerText = weekNum === 7 ? "Week 7 (Demo Data)" : `Week ${weekNum} (Demo Data)`;
    document.getElementById('totalUsageDisplay').innerText = total.toFixed(1) + " kWh";
    document.getElementById('avgLabel').innerText = "Daily Avg: " + (total/7).toFixed(1) + " kWh";
    usageChart.data.labels = days; usageChart.data.datasets[0].data = data; usageChart.update();
}

function updateDayData() {
    const dateStr = new Date(document.getElementById('daySelect').value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let labels = Array.from({length: 24}, (_, i) => i.toString());
    let data = Array.from({length: 24}, () => Math.random() * 2.5);
    let total = data.reduce((a, b) => a + b, 0);
    document.getElementById('timeLabel').innerText = `Usage on ${dateStr} (Demo Data)`;
    document.getElementById('totalUsageDisplay').innerText = total.toFixed(1) + " kWh";
    document.getElementById('avgLabel').innerText = "Peak: 8 PM";
    usageChart.data.labels = labels; usageChart.data.datasets[0].data = data; usageChart.update();
}

function updateMonthData() {
    const select = document.getElementById('monthSelect');
    let labels = Array.from({length: 30}, (_, i) => (i+1).toString());
    let data = Array.from({length: 30}, () => Math.random() * 10 + 2);
    let total = data.reduce((a, b) => a + b, 0);
    document.getElementById('timeLabel').innerText = `Usage for ${select.options[select.selectedIndex].text} (Demo Data)`;
    document.getElementById('totalUsageDisplay').innerText = total.toFixed(1) + " kWh";
    document.getElementById('avgLabel').innerText = "Daily Avg: " + (total/30).toFixed(1) + " kWh";
    usageChart.data.labels = labels; usageChart.data.datasets[0].data = data; usageChart.update();
}

// ==========================================
// 7. SOURCE POWER CHART LOGIC (YELLOW)
// ==========================================

function setSourceView(mode, element) {
    document.querySelectorAll('.source-tab').forEach(el => el.classList.remove('active'));
    if(element) element.classList.add('active');
    
    document.getElementById('sourceWeekSubSelector').style.display = 'none';
    document.getElementById('sourceMonthSelectorWrapper').style.display = 'none';
    document.getElementById('sourceDaySelectorWrapper').style.display = 'none';
    
    sourceChart.options.scales.x.grid.display = false;
    sourceChart.config.type = (mode === 'minute' || mode === 'hour') ? 'line' : 'bar';

    if (mode === 'minute') { 
        document.getElementById('sourceTimeLabel').innerText = "Live Real-Time Source"; 
        document.getElementById('sourceAvgLabel').innerText = "Streaming from hardware...";
        document.getElementById('sourceTotalDisplay').innerText = Number(livePoleData[59]).toFixed(2) + " A";
        
        sourceChart.data.labels = liveTimeLabels;
        sourceChart.data.datasets[0].data = livePoleData;
        sourceChart.update();
    } else if (mode === 'hour') {
        document.getElementById('sourceTimeLabel').innerText = "Current Session (Last 60 ticks)"; 
        document.getElementById('sourceAvgLabel').innerText = "Active Database Feed";
        document.getElementById('sourceTotalDisplay').innerText = Number(livePoleData[59]).toFixed(2) + " A";
        
        sourceChart.data.labels = liveTimeLabels;
        sourceChart.data.datasets[0].data = livePoleData;
        sourceChart.update();
    } else if (mode === 'day') { 
        document.getElementById('sourceDaySelectorWrapper').style.display = 'block'; 
        updateSourceDayData(); 
    } else if (mode === 'week') { 
        document.getElementById('sourceWeekSubSelector').style.display = 'flex'; 
        setSourceSubWeek(7, document.querySelectorAll('.source-pill')[3]); 
    } else if (mode === 'month') { 
        document.getElementById('sourceMonthSelectorWrapper').style.display = 'block'; 
        updateSourceMonthData(); 
    } else if (mode === 'year') {
        let labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        let data = Array.from({length: 12}, () => Math.random() * 55 + 100); 
        let total = data.reduce((a, b) => a + b, 0);
        document.getElementById('sourceTimeLabel').innerText = "Year Data (Demo)";
        document.getElementById('sourceTotalDisplay').innerText = total.toFixed(1) + " kWh";
        document.getElementById('sourceAvgLabel').innerText = "Total: 1.3 MWh";
        sourceChart.data.labels = labels; sourceChart.data.datasets[0].data = data; sourceChart.update();
    }
}

function setSourceSubWeek(weekNum, element) {
    document.querySelectorAll('.source-pill').forEach(el => el.classList.remove('active'));
    if(element) element.classList.add('active');
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let data = Array.from({length: 7}, () => Math.random() * 11 + weekNum);
    let total = data.reduce((a, b) => a + b, 0);
    document.getElementById('sourceTimeLabel').innerText = weekNum === 7 ? "Week 7 (Demo Data)" : `Week ${weekNum} (Demo Data)`;
    document.getElementById('sourceTotalDisplay').innerText = total.toFixed(1) + " kWh";
    document.getElementById('sourceAvgLabel').innerText = "Daily Avg: " + (total/7).toFixed(1) + " kWh";
    sourceChart.data.labels = days; sourceChart.data.datasets[0].data = data; sourceChart.update();
}

function updateSourceDayData() {
    const dateStr = new Date(document.getElementById('sourceDaySelect').value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let labels = Array.from({length: 24}, (_, i) => i.toString());
    let data = Array.from({length: 24}, () => Math.random() * 2.8);
    let total = data.reduce((a, b) => a + b, 0);
    document.getElementById('sourceTimeLabel').innerText = `Source on ${dateStr} (Demo Data)`;
    document.getElementById('sourceTotalDisplay').innerText = total.toFixed(1) + " kWh";
    document.getElementById('sourceAvgLabel').innerText = "Peak: 8 PM";
    sourceChart.data.labels = labels; sourceChart.data.datasets[0].data = data; sourceChart.update();
}

function updateSourceMonthData() {
    const select = document.getElementById('sourceMonthSelect');
    let labels = Array.from({length: 30}, (_, i) => (i+1).toString());
    let data = Array.from({length: 30}, () => Math.random() * 11 + 2);
    let total = data.reduce((a, b) => a + b, 0);
    document.getElementById('sourceTimeLabel').innerText = `Source for ${select.options[select.selectedIndex].text} (Demo Data)`;
    document.getElementById('sourceTotalDisplay').innerText = total.toFixed(1) + " kWh";
    document.getElementById('sourceAvgLabel').innerText = "Daily Avg: " + (total/30).toFixed(1) + " kWh";
    sourceChart.data.labels = labels; sourceChart.data.datasets[0].data = data; sourceChart.update();
}