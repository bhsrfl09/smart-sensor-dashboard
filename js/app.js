document.addEventListener("DOMContentLoaded", () => {
    const tempElement = document.getElementById("temp-value"), humElement = document.getElementById("hum-value");
    const statusElement = document.getElementById("status-badge"), timeElement = document.getElementById("last-update");
    const deviceStatusEl = document.getElementById("device-status");
    
    const tMaxEl = document.getElementById("temp-max"), tMinEl = document.getElementById("temp-min"), tAvgEl = document.getElementById("temp-avg");
    const hMaxEl = document.getElementById("hum-max"), hMinEl = document.getElementById("hum-min"), hAvgEl = document.getElementById("hum-avg");
    const heatIndexEl = document.getElementById("heat-index"), cardTemp = document.getElementById("card-temp"), statusTemp = document.getElementById("status-temp");
    const btnReset = document.getElementById("btn-reset");

    let currentTemp = 0, currentHum = 0;
    let deviceWatchdogTimer; // Timer untuk mendeteksi apakah ESP32 offline

    // === MENGAMBIL DATA TERSIMPAN DARI LOCAL STORAGE ===
    // Jika belum ada data, gunakan nilai default (999 untuk min, -999 untuk max, 0 untuk sum/count)
    let minT = parseFloat(localStorage.getItem("minT")) || 999;
    let maxT = parseFloat(localStorage.getItem("maxT")) || -999;
    let sumT = parseFloat(localStorage.getItem("sumT")) || 0;
    let countT = parseInt(localStorage.getItem("countT")) || 0;
    
    let minH = parseFloat(localStorage.getItem("minH")) || 999;
    let maxH = parseFloat(localStorage.getItem("maxH")) || -999;
    let sumH = parseFloat(localStorage.getItem("sumH")) || 0;
    let countH = parseInt(localStorage.getItem("countH")) || 0;

    // Tampilkan data tersimpan ke UI saat pertama kali web dibuka
    if (countT > 0) {
        tMaxEl.innerText = maxT.toFixed(1);
        tMinEl.innerText = minT.toFixed(1);
        tAvgEl.innerText = (sumT/countT).toFixed(1);
    }
    if (countH > 0) {
        hMaxEl.innerText = Math.floor(maxH);
        hMinEl.innerText = Math.floor(minH);
        hAvgEl.innerText = Math.floor(sumH/countH);
    }

    // === FUNGSI RESET DATA MIN/MAX/AVG ===
    btnReset.addEventListener("click", () => {
        // Hapus dari memori permanen
        localStorage.clear();
        
        // Reset Variabel
        minT = 999; maxT = -999; sumT = 0; countT = 0;
        minH = 999; maxH = -999; sumH = 0; countH = 0;
        
        // Reset Tampilan
        tMaxEl.innerText = "--"; tMinEl.innerText = "--"; tAvgEl.innerText = "--";
        hMaxEl.innerText = "--"; hMinEl.innerText = "--"; hAvgEl.innerText = "--";
        alert("Statistik Min/Max/Avg berhasil dihapus!");
    });

    // === SETUP GRAFIK CHART.JS ===
    const ctx = document.getElementById('sensorChart').getContext('2d');
    const sensorChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Suhu (°C)', borderColor: '#00ffcc', backgroundColor: 'rgba(0, 255, 204, 0.1)', data: [], tension: 0.4, fill: true }, { label: 'Kelembapan (%)', borderColor: '#ff00ff', backgroundColor: 'rgba(255, 0, 255, 0.1)', data: [], tension: 0.4, fill: true }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: '#888' }, grid: { color: '#333' } }, y: { ticks: { color: '#888' }, grid: { color: '#333' } } }, plugins: { legend: { labels: { color: '#fff' } } } }
    });

    function animateValue(obj, start, end, duration, isFloat = false) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            let value = progress * (end - start) + start;
            obj.innerHTML = isFloat ? value.toFixed(1) : Math.floor(value);
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }

    function calculateHeatIndex(T, R) {
        if (T < 26) return T; 
        let HI = -8.784 + (1.611*T) + (2.338*R) + (-0.146*T*R) + (-0.012*T*T) + (-0.016*R*R) + (0.002*T*T*R) + (0.0007*T*R*R) + (-0.000003*T*T*R*R);
        return HI.toFixed(1);
    }

    // === KONFIGURASI MQTT ===
    const broker = "broker.emqx.io";
    const port = 8084; 
    const topic_data = "smartsensor/kamar/data123"; 
    const topic_control = "smartsensor/kamar/control"; 
    const clientId = "web_" + Math.random().toString(16).substr(2, 8);
    const client = new Paho.MQTT.Client(broker, port, "/mqtt", clientId);

    client.onConnectionLost = (res) => {
        statusElement.innerText = "Offline (Mencoba ulang...)"; 
        statusElement.className = "status offline";
        deviceStatusEl.innerText = "Terputus (Web Offline)";
        deviceStatusEl.className = "status offline";
        setTimeout(connectMQTT, 5000);
    };

    client.onMessageArrived = (message) => {
        try {
            const data = JSON.parse(message.payloadString); 
            const newTemp = parseFloat(data.temp), newHum = parseFloat(data.hum);
            
            // 1. UPDATE WAKTU & STATUS ALAT (WATCHDOG)
            const timeString = new Date().toLocaleTimeString('id-ID');
            timeElement.innerText = timeString;
            
            deviceStatusEl.innerText = "Aktif (Mengirim Data)";
            deviceStatusEl.className = "status online";
            
            // Reset Timer Watchdog. Jika 10 detik kedepan tidak ada data, alat dianggap mati.
            clearTimeout(deviceWatchdogTimer);
            deviceWatchdogTimer = setTimeout(() => {
                deviceStatusEl.innerText = "Terputus (ESP32 Offline/Mati)";
                deviceStatusEl.className = "status offline";
            }, 10000); 

            // 2. UPDATE STATISTIK SUHU & SIMPAN PERMANEN
            if(newTemp > maxT) maxT = newTemp; 
            if(newTemp < minT) minT = newTemp; 
            sumT += newTemp; countT++;
            tMaxEl.innerText = maxT.toFixed(1); tMinEl.innerText = minT.toFixed(1); tAvgEl.innerText = (sumT/countT).toFixed(1);
            
            localStorage.setItem("maxT", maxT); localStorage.setItem("minT", minT); 
            localStorage.setItem("sumT", sumT); localStorage.setItem("countT", countT);

            // 3. UPDATE STATISTIK KELEMBAPAN & SIMPAN PERMANEN
            if(newHum > maxH) maxH = newHum; 
            if(newHum < minH) minH = newHum; 
            sumH += newHum; countH++;
            hMaxEl.innerText = Math.floor(maxH); hMinEl.innerText = Math.floor(minH); hAvgEl.innerText = Math.floor(sumH/countH);
            
            localStorage.setItem("maxH", maxH); localStorage.setItem("minH", minH); 
            localStorage.setItem("sumH", sumH); localStorage.setItem("countH", countH);

            // 4. PERINGATAN WARNA UI
            heatIndexEl.innerText = calculateHeatIndex(newTemp, newHum);
            cardTemp.className = "card"; 
            if (newTemp < 30) { 
                cardTemp.classList.add("normal"); statusTemp.innerText = "Kondisi Sejuk"; 
            } else if (newTemp >= 30 && newTemp < 34) { 
                cardTemp.classList.add("warning"); statusTemp.innerText = "Sedikit Panas"; 
            } else { 
                cardTemp.classList.add("danger"); statusTemp.innerText = "AWAS: Sangat Panas!"; 
            }

            // 5. ANIMASI ANGKA & UPDATE GRAFIK
            animateValue(tempElement, currentTemp, newTemp, 1000, true); animateValue(humElement, currentHum, newHum, 1000, false);
            currentTemp = newTemp; currentHum = newHum;

            sensorChart.data.labels.push(timeString); sensorChart.data.datasets[0].data.push(newTemp); sensorChart.data.datasets[1].data.push(newHum);
            if (sensorChart.data.labels.length > 15) { sensorChart.data.labels.shift(); sensorChart.data.datasets[0].data.shift(); sensorChart.data.datasets[1].data.shift(); }
            sensorChart.update();
        } catch (error) { console.log("Error Parsing Data"); }
    };

    function connectMQTT() {
        statusElement.innerText = "Menghubungkan...";
        client.connect({
            useSSL: true,
            onSuccess: () => {
                statusElement.innerText = "Terhubung (Web OK)"; statusElement.className = "status online";
                client.subscribe(topic_data); 
            },
            onFailure: () => { setTimeout(connectMQTT, 5000); }
        });
    }

    // === EVENT LISTENER TOMBOL KONTROL ===
    const btnAnims = document.querySelectorAll('.btn-anim');
    const controlStatus = document.getElementById('control-status');

    btnAnims.forEach(btn => {
        btn.addEventListener('click', () => {
            if(!client.isConnected()) { alert("Web sedang offline."); return; }

            const mode = btn.getAttribute('data-mode');
            const modeName = btn.innerText;

            const message = new Paho.MQTT.Message(mode);
            message.destinationName = topic_control; 
            client.send(message);

            btnAnims.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            controlStatus.innerText = `✅ OLED berubah ke mode: ${modeName}`;
            controlStatus.style.color = "#00ffcc";
            setTimeout(() => { controlStatus.style.color = "#888"; }, 3000);
        });
    });

    connectMQTT();
});
