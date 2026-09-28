document.addEventListener("DOMContentLoaded", () => {
    const tempElement = document.getElementById("temp-value"), humElement = document.getElementById("hum-value");
    const statusElement = document.getElementById("status-badge"), timeElement = document.getElementById("last-update");
    const tMaxEl = document.getElementById("temp-max"), tMinEl = document.getElementById("temp-min"), tAvgEl = document.getElementById("temp-avg");
    const hMaxEl = document.getElementById("hum-max"), hMinEl = document.getElementById("hum-min"), hAvgEl = document.getElementById("hum-avg");
    const heatIndexEl = document.getElementById("heat-index"), cardTemp = document.getElementById("card-temp"), statusTemp = document.getElementById("status-temp");
    const btnReset = document.getElementById("btn-reset");

    // Variabel Penyimpanan Data
    let currentTemp = 0, currentHum = 0;
    let minT = 999, maxT = -999, sumT = 0, countT = 0;
    let minH = 999, maxH = -999, sumH = 0, countH = 0;

    // Fungsi Reset Data Min/Max/Avg
    btnReset.addEventListener("click", () => {
        minT = 999; maxT = -999; sumT = 0; countT = 0;
        minH = 999; maxH = -999; sumH = 0; countH = 0;
        tMaxEl.innerText = "--"; tMinEl.innerText = "--"; tAvgEl.innerText = "--";
        hMaxEl.innerText = "--"; hMinEl.innerText = "--"; hAvgEl.innerText = "--";
        alert("Statistik Min/Max/Avg berhasil di-reset!");
    });

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
        statusElement.innerText = "Offline (Mencoba ulang...)"; statusElement.className = "status offline";
        setTimeout(connectMQTT, 5000);
    };

    client.onMessageArrived = (message) => {
        try {
            const data = JSON.parse(message.payloadString); 
            const newTemp = parseFloat(data.temp), newHum = parseFloat(data.hum);
            
            const timeString = new Date().toLocaleTimeString('id-ID');
            timeElement.innerText = timeString;

            // Update Statistik Suhu
            if(newTemp > maxT) maxT = newTemp; 
            if(newTemp < minT) minT = newTemp; 
            sumT += newTemp; countT++;
            tMaxEl.innerText = maxT.toFixed(1); tMinEl.innerText = minT.toFixed(1); tAvgEl.innerText = (sumT/countT).toFixed(1);

            // Update Statistik Kelembapan
            if(newHum > maxH) maxH = newHum; 
            if(newHum < minH) minH = newHum; 
            sumH += newHum; countH++;
            hMaxEl.innerText = Math.floor(maxH); hMinEl.innerText = Math.floor(minH); hAvgEl.innerText = Math.floor(sumH/countH);

            heatIndexEl.innerText = calculateHeatIndex(newTemp, newHum);
            
            // LOGIKA PERINGATAN WARNA
            cardTemp.className = "card"; 
            if (newTemp < 30) { 
                cardTemp.classList.add("normal"); statusTemp.innerText = "Kondisi Sejuk"; 
            } else if (newTemp >= 30 && newTemp < 34) { 
                cardTemp.classList.add("warning"); statusTemp.innerText = "Sedikit Panas"; 
            } else { 
                cardTemp.classList.add("danger"); statusTemp.innerText = "AWAS: Sangat Panas!"; 
            }

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
                statusElement.innerText = "Online (Live)"; statusElement.className = "status online";
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