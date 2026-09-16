import { useState, useEffect, useRef, useCallback, ChangeEvent } from "react";
import { 
  Activity, 
  Bluetooth, 
  AlertTriangle, 
  Cpu, 
  CheckCircle2, 
  Gauge, 
  Thermometer, 
  Zap, 
  Car, 
  Settings, 
  Terminal, 
  RotateCcw, 
  Play, 
  Pause, 
  HelpCircle, 
  RefreshCw, 
  Sliders, 
  XCircle, 
  Info,
  ChevronRight,
  ShieldAlert,
  SlidersHorizontal,
  Key,
  CheckCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Standard OBD-II PIDs and BLE Constants
const NORDIC_UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NORDIC_RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // write
const NORDIC_TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify

const VGATE_SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
const VGATE_CHAR_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"; // write & notify

// DTC Common Explanations in Turkish
const DTC_DICTIONARY: Record<string, string> = {
  "P0102": "Kütle Hava Akış (MAF) Sensörü Devresi Düşük Giriş - Hava akış ölçümü hatalı.",
  "P0113": "Emme Havası Sıcaklık (IAT) Sensörü 1 Devresi Yüksek Giriş - Motor soğuk hava emiş ölçümü arızalı.",
  "P0115": "Motor Soğutma Suyu Sıcaklık (ECT) Sensörü Arızası - Motor sıcaklık ölçümünde hata saptandı.",
  "P0171": "Sistem Çok Fakir (Sıra 1) - Silindirlere aşırı hava veya yetersiz yakıt gidiyor.",
  "P0300": "Rastgele/Çoklu Silindir Ateşleme Kaçırma Saptandı - Motor sarsıntılı çalışıyor olabilir.",
  "P0302": "Silindir 2 Ateşleme Kaçırma Saptandı - Silindir 2'de buji veya bobin kaynaklı ateşleme kaybı.",
  "P0420": "Katalizör Sistemi Etkinliği Eşik Altında (Sıra 1) - Egzoz emisyonu ve katalitik konvertör uyarısı.",
  "P0500": "Araç Hız Sensörü (VSS) Arızası - Hız göstergesi veya şanzıman hız okuyucusu hatası."
};

interface LogEntry {
  timestamp: string;
  type: "tx" | "rx" | "info" | "error";
  message: string;
}

export default function App() {
  // Connection states
  const [isSimulator, setIsSimulator] = useState<boolean>(true);
  const [btState, setBtState] = useState<"disconnected" | "scanning" | "connecting" | "initializing" | "connected">("disconnected");
  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  
  // Custom API key & Vehicle Info
  const [carModel, setCarModel] = useState<string>("Ford Focus 1.6 TDCi (2015)");
  const [userApiKey, setUserApiKey] = useState<string>("");
  const [showSettings, setShowSettings] = useState<boolean>(false);
  
  // Telemetry Metrics
  const [rpm, setRpm] = useState<number>(850); // Rölanti devri varsayılan
  const [coolantTemp, setCoolantTemp] = useState<number>(85); // Çalışma sıcaklığı varsayılan
  const [speed, setSpeed] = useState<number>(0);
  const [voltage, setVoltage] = useState<number>(14.1); // Akü voltajı
  const [dtcCodes, setDtcCodes] = useState<string[]>([]);
  const [customDtc, setCustomDtc] = useState<string>("");

  // Scanner State
  const [isScanningDtc, setIsScanningDtc] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [scanMessage, setScanMessage] = useState<string>("");

  // Simulator Settings
  const [simThrottle, setSimThrottle] = useState<number>(0);
  const [simTemp, setSimTemp] = useState<number>(85);
  const [simErrorType, setSimErrorType] = useState<string>("NONE");

  // Terminal Logs
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: new Date().toLocaleTimeString(), type: "info", message: "OBD-II Dashboard başlatıldı. Bağlanmak için cihaz seçin veya simülatör modunu kullanın." }
  ]);

  // AI Diagnostic states
  const [diagnosis, setDiagnosis] = useState<string>("");
  const [isDiagnosing, setIsDiagnosing] = useState<boolean>(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);

  // Web Bluetooth Refs
  const gattServerRef = useRef<any>(null);
  const writeCharRef = useRef<any>(null);
  const notifyCharRef = useRef<any>(null);
  const responseBufferRef = useRef<string>("");
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentCommandIdxRef = useRef<number>(0);

  // Logs helper
  const addLog = useCallback((type: "tx" | "rx" | "info" | "error", message: string) => {
    setLogs(prev => [
      {
        timestamp: new Date().toLocaleTimeString(),
        type,
        message
      },
      ...prev.slice(0, 49) // Keep last 50 logs
    ]);
  }, []);

  // Simulator loop
  useEffect(() => {
    if (!isSimulator) return;

    const interval = setInterval(() => {
      // Calculate RPM based on throttle with slight noise fluctuation
      const targetRpm = simThrottle > 0 
        ? Math.round(850 + (simThrottle / 100) * 5800) 
        : Math.round(820 + Math.random() * 30);
      
      // RPM fluctuation if cylinder misfire is active (P0302)
      const isMisfiring = simErrorType === "P0302";
      const finalRpm = isMisfiring 
        ? Math.round(targetRpm * (0.88 + Math.random() * 0.12))
        : targetRpm;

      setRpm(finalRpm);

      // Speed is throttle dependent with inertia
      const targetSpeed = Math.round((simThrottle / 100) * 190);
      setSpeed(prev => {
        if (prev < targetSpeed) return Math.min(prev + 3, targetSpeed);
        if (prev > targetSpeed) return Math.max(prev - 4, targetSpeed);
        return prev;
      });

      // Coolant temperature
      setCoolantTemp(simTemp);

      // Volts slight noise
      setVoltage(prev => {
        const val = 13.9 + Math.random() * 0.4;
        return parseFloat(val.toFixed(1));
      });
    }, 150);

    return () => clearInterval(interval);
  }, [isSimulator, simThrottle, simTemp, simErrorType]);

  // Inject malfunction / error
  const handleMalfunctionChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const errorValue = e.target.value;
    setSimErrorType(errorValue);

    if (errorValue === "NONE") {
      setDtcCodes([]);
      addLog("info", "Arıza simülasyonu kapatıldı, sistem normale dönüyor.");
    } else {
      setDtcCodes([errorValue]);
      addLog("error", `Araç Motor Arıza Işığı (MIL) Aktif! Arıza Kodu Enjekte Edildi: ${errorValue} - ${DTC_DICTIONARY[errorValue] || ""}`);
    }
  };

  // Helper: write BLE command
  const sendBLECommand = async (cmd: string) => {
    if (!writeCharRef.current) return;
    try {
      addLog("tx", cmd);
      const encoder = new TextEncoder();
      const data = encoder.encode(cmd + "\r");
      await writeCharRef.current.writeValue(data);
    } catch (err: any) {
      addLog("error", `Komut gönderme başarısız: ${err.message}`);
    }
  };

  // Web Bluetooth: Notification handler
  const handleBluetoothNotification = useCallback((event: any) => {
    const value = event.target.value;
    const decoder = new TextDecoder("utf-8");
    const chunk = decoder.decode(value);
    
    responseBufferRef.current += chunk;

    // ELM327 outputs are typically terminated with a '>' prompt when finished
    if (responseBufferRef.current.includes(">")) {
      const fullResponse = responseBufferRef.current.replace(">", "").trim();
      addLog("rx", fullResponse);
      
      // Parse response
      const commands = ["010C", "0105", "010D", "03"];
      const activeCommand = commands[currentCommandIdxRef.current];

      try {
        const parsed = parseOBDResponse(activeCommand, fullResponse);
        if (parsed) {
          if (parsed.rpm !== undefined) setRpm(parsed.rpm);
          if (parsed.coolantTemp !== undefined) setCoolantTemp(parsed.coolantTemp);
          if (parsed.speed !== undefined) setSpeed(parsed.speed);
          if (parsed.dtcCodes !== undefined) setDtcCodes(parsed.dtcCodes);
        }
      } catch (parseErr: any) {
        addLog("error", `Ayrıştırma hatası: ${parseErr.message}`);
      }

      // Reset buffer for next command
      responseBufferRef.current = "";
    }
  }, [addLog]);

  // Parser logic for OBD Responses
  const parseOBDResponse = (command: string, response: string) => {
    const cleanCmd = command.replace(/\s+/g, "").toUpperCase();
    const cleanRes = response.replace(/[\s\r\n>]+/g, "").toUpperCase();
    
    // Check if response is positive OBD response (typically command bytes + 0x40)
    if (cleanCmd === "010C") {
      const idx = cleanRes.indexOf("410C");
      if (idx !== -1 && cleanRes.length >= idx + 8) {
        const a = parseInt(cleanRes.substring(idx + 4, idx + 6), 16);
        const b = parseInt(cleanRes.substring(idx + 6, idx + 8), 16);
        if (!isNaN(a) && !isNaN(b)) {
          return { rpm: Math.round(((a * 256) + b) / 4) };
        }
      }
    } else if (cleanCmd === "0105") {
      const idx = cleanRes.indexOf("4105");
      if (idx !== -1 && cleanRes.length >= idx + 6) {
        const a = parseInt(cleanRes.substring(idx + 4, idx + 6), 16);
        if (!isNaN(a)) {
          return { coolantTemp: a - 40 };
        }
      }
    } else if (cleanCmd === "010D") {
      const idx = cleanRes.indexOf("410D");
      if (idx !== -1 && cleanRes.length >= idx + 6) {
        const a = parseInt(cleanRes.substring(idx + 4, idx + 6), 16);
        if (!isNaN(a)) {
          return { speed: a };
        }
      }
    } else if (cleanCmd === "03") {
      const idx = cleanRes.indexOf("43");
      if (idx !== -1) {
        const codes: string[] = [];
        const hexPayload = cleanRes.substring(idx + 2);
        for (let i = 0; i < hexPayload.length; i += 4) {
          if (i + 4 <= hexPayload.length) {
            const firstByte = hexPayload.substring(i, i + 2);
            const secondByte = hexPayload.substring(i + 2, i + 4);
            if (firstByte === "00" && secondByte === "00") continue;
            
            // Decipher OBD-II standard DTC type
            const d1Hex = firstByte.charAt(0);
            let d1 = "P";
            if (d1Hex === "0") d1 = "P0";
            else if (d1Hex === "1") d1 = "P1";
            else if (d1Hex === "2") d1 = "P2";
            else if (d1Hex === "3") d1 = "P3";
            else if (d1Hex === "4") d1 = "C0";
            else if (d1Hex === "5") d1 = "C1";
            else if (d1Hex === "6") d1 = "C2";
            else if (d1Hex === "7") d1 = "C3";
            else if (d1Hex === "8") d1 = "B0";
            else if (d1Hex === "9") d1 = "B1";
            else if (d1Hex === "A") d1 = "B2";
            else if (d1Hex === "B") d1 = "B3";
            else if (d1Hex === "C") d1 = "U0";
            else if (d1Hex === "D") d1 = "U1";
            else if (d1Hex === "E") d1 = "U2";
            else if (d1Hex === "F") d1 = "U3";
            
            const code = `${d1}${firstByte.charAt(1)}${secondByte}`;
            if (!codes.includes(code)) {
              codes.push(code);
            }
          }
        }
        return { dtcCodes: codes };
      }
    }
    return null;
  };

  // Web Bluetooth GATT Connection Workflow
  const connectWebBluetooth = async () => {
    const nav = navigator as any;
    if (!nav.bluetooth) {
      addLog("error", "Web Bluetooth API bu cihaz/tarayıcı üzerinde desteklenmiyor. iOS Safari için iOS 15+ ve HTTPS gereklidir.");
      alert("HATA: Tarayıcınız Web Bluetooth API desteklemiyor. Lütfen simülatör modunu kullanın veya uyumlu bir cihazda (Safari iOS/Chrome Desktop) HTTPS üzerinden çalıştırın.");
      return;
    }

    try {
      setBtState("scanning");
      addLog("info", "Bluetooth cihazları taranıyor (ELM327 / OBD-II BLE filtreleri aktif)...");
      
      const device = await nav.bluetooth.requestDevice({
        filters: [
          { namePrefix: "OBD" },
          { namePrefix: "ELM" },
          { namePrefix: "V-LINK" },
          { namePrefix: "VGATE" },
          { namePrefix: "CARISTA" },
          { namePrefix: "LELink" }
        ],
        optionalServices: [NORDIC_UART_SERVICE_UUID, VGATE_SERVICE_UUID]
      });

      setBtState("connecting");
      setActiveDevice((device as any).name || "İsimsiz OBD Adaptörü");
      addLog("info", `Cihaza bağlanılıyor: ${(device as any).name}...`);

      (device as any).addEventListener("gattserverdisconnected", handleGattDisconnect);

      const server = await (device as any).gatt?.connect();
      if (!server) throw new Error("GATT Sunucusuna bağlanılamadı.");
      gattServerRef.current = server;

      setBtState("initializing");
      addLog("info", "Hizmetler ve karakteristikler sorgulanıyor...");

      // Try discovering standard services in fallback sequence
      let service;
      let rxChar;
      let txChar;

      try {
        // Attempt Vgate / LELink Service
        service = await server.getPrimaryService(VGATE_SERVICE_UUID);
        rxChar = await service.getCharacteristic(VGATE_CHAR_UUID);
        txChar = rxChar; // Vgate combines write/notify on same characteristic
        addLog("info", "Vgate / LELink standart BLE OBD servisi başarıyla kuruldu.");
      } catch (e) {
        addLog("info", "Vgate servisi bulunamadı. Nordic UART (NUS) servisi deneniyor...");
        try {
          // Attempt Nordic UART Service
          service = await server.getPrimaryService(NORDIC_UART_SERVICE_UUID);
          rxChar = await service.getCharacteristic(NORDIC_RX_CHAR_UUID);
          txChar = await service.getCharacteristic(NORDIC_TX_CHAR_UUID);
          addLog("info", "Nordic UART (NUS) BLE OBD servisi başarıyla kuruldu.");
        } catch (e2) {
          throw new Error("Uyumlu bir ELM327 OBD BLE servisi bulunamadı.");
        }
      }

      writeCharRef.current = rxChar;
      notifyCharRef.current = txChar;

      // Start listening to notifications
      await txChar.startNotifications();
      txChar.addEventListener("characteristicvaluechanged", handleBluetoothNotification);

      setBtState("connected");
      setIsSimulator(false); // Disable simulator on successful BLE hook
      addLog("info", "Bluetooth Bağlantısı Aktif! ELM327 adaptörü başlatılıyor...");

      // Send AT initialization sequence
      await new Promise(r => setTimeout(r, 600));
      await sendBLECommand("ATZ"); // Reset
      await new Promise(r => setTimeout(r, 1200));
      await sendBLECommand("ATE0"); // Echo off
      await new Promise(r => setTimeout(r, 600));
      await sendBLECommand("ATSP0"); // Set automatic protocol
      await new Promise(r => setTimeout(r, 600));

      // Start OBD Polling loop
      startPollingLoop();

    } catch (err: any) {
      addLog("error", `Bağlantı hatası: ${err.message}`);
      setBtState("disconnected");
      setActiveDevice(null);
    }
  };

  const handleGattDisconnect = useCallback(() => {
    addLog("error", "Bluetooth bağlantısı koptu.");
    setBtState("disconnected");
    setActiveDevice(null);
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
  }, [addLog]);

  // Start polling OBD PIDs sequentially
  const startPollingLoop = () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

    const commands = ["010C", "0105", "010D", "03"];
    pollingIntervalRef.current = setInterval(async () => {
      if (btState !== "connected" || !writeCharRef.current) return;

      const currentCmd = commands[currentCommandIdxRef.current];
      await sendBLECommand(currentCmd);

      // Cycle commands
      currentCommandIdxRef.current = (currentCommandIdxRef.current + 1) % commands.length;
    }, 1000); // Poll once per second to stay safe with BLE bandwidth
  };

  // Disconnect Bluetooth
  const disconnectBluetooth = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    if (gattServerRef.current?.connected) {
      gattServerRef.current.disconnect();
    }
    setBtState("disconnected");
    setActiveDevice(null);
    addLog("info", "Bluetooth bağlantısı kullanıcı tarafından sonlandırıldı.");
  };

  // Simulate scanning progress UI
  const handleScanDtc = () => {
    setIsScanningDtc(true);
    setScanProgress(0);
    setScanMessage("OBD-II alt sistemleri sorgulanıyor...");

    const steps = [
      "SAE J1850 / ISO 9141 protokol kontrolü...",
      "Motor Kontrol Ünitesi (ECU) bağlantısı kuruldu.",
      "Aktif arıza kayıt defteri okunuyor (DTC)...",
      "Kalıcı ve geçici hata kodları çözülüyor...",
      "Tarama tamamlandı."
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      setScanProgress(prev => Math.min(prev + 20, 100));
      
      if (currentStep < steps.length) {
        setScanMessage(steps[currentStep]);
      } else {
        clearInterval(interval);
        setIsScanningDtc(false);
        addLog("info", `Arıza kodları başarıyla tarandı. Saptanan DTC Sayısı: ${dtcCodes.length}`);
      }
    }, 800);
  };

  // Gemini API analysis via Server-Side API
  const handleAIAnalysis = async () => {
    setIsDiagnosing(true);
    setDiagnosis("");
    setDiagnosticError(null);
    addLog("info", "Teşhis verileri toplanıyor ve Gemini AI'a analiz için gönderiliyor...");

    try {
      const response = await fetch("/api/diagnose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          rpm,
          coolantTemp,
          speed,
          dtcCodes,
          carModel,
          customDtcInput: customDtc,
          userApiKey: userApiKey
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Sunucu teşhis talebini işleyemedi.");
      }

      setDiagnosis(data.diagnosis);
      addLog("info", "Gemini Teşhisi başarıyla tamamlandı.");
    } catch (err: any) {
      setDiagnosticError(err.message || "Yapay zeka analizi sırasında bir bağlantı sorunu oluştu.");
      addLog("error", `AI Analiz hatası: ${err.message}`);
    } finally {
      setIsDiagnosing(false);
    }
  };

  // Minimal markdown renderer for a highly custom terminal visual look
  const renderMarkdownText = (text: string) => {
    if (!text) return null;
    const lines = text.split("\n");
    return lines.map((line, index) => {
      let cleanLine = line.trim();
      if (cleanLine.startsWith("## ")) {
        return (
          <h2 key={index} className="text-lg font-bold text-cyan-400 mt-5 mb-2 border-b border-cyan-950/40 pb-1 flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400 animate-pulse" />
            {cleanLine.replace("## ", "")}
          </h2>
        );
      }
      if (cleanLine.startsWith("### ")) {
        return (
          <h3 key={index} className="text-md font-semibold text-amber-400 mt-4 mb-1">
            {cleanLine.replace("### ", "")}
          </h3>
        );
      }
      if (cleanLine.startsWith("- ") || cleanLine.startsWith("* ")) {
        const parts = cleanLine.substring(2).split("**");
        return (
          <li key={index} className="ml-5 list-disc text-gray-300 my-1 text-sm">
            {parts.map((part, pIdx) => pIdx % 2 === 1 ? <strong key={pIdx} className="text-cyan-300 font-semibold">{part}</strong> : part)}
          </li>
        );
      }
      if (cleanLine === "") {
        return <div key={index} className="h-2" />;
      }
      // Bold parsing
      const parts = cleanLine.split("**");
      return (
        <p key={index} className="text-gray-300 leading-relaxed my-1.5 text-sm">
          {parts.map((part, pIdx) => pIdx % 2 === 1 ? <strong key={pIdx} className="text-cyan-300 font-semibold">{part}</strong> : part)}
        </p>
      );
    });
  };

  // Radial Dial Maths
  const calculateStrokeDashOffset = (value: number, max: number, radius: number) => {
    const circumference = 2 * Math.PI * radius;
    const boundedValue = Math.max(0, Math.min(value, max));
    const percentage = boundedValue / max;
    // We only use 270 degrees of the circle for the dial (3/4 of the circle)
    const arcLength = circumference * 0.75;
    return circumference - (percentage * arcLength);
  };

  const isHighTemp = coolantTemp > 102;
  const isOverheating = coolantTemp > 115;
  const isRedline = rpm > 6200;

  return (
    <div className="min-h-screen bg-[#070B13] text-white font-sans antialiased selection:bg-cyan-500/30 overflow-x-hidden" id="app_root">
      
      {/* Dynamic Background Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#141B2D_1px,transparent_1px),linear-gradient(to_bottom,#141B2D_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-25" />

      {/* Main Header / Status Panel */}
      <header className="relative border-b border-[#141B2D] bg-[#0A101D]/90 backdrop-blur-md sticky top-0 z-40 px-4 py-3" id="app_header">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          
          {/* Logo Brand */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 opacity-75 blur-xs animate-pulse" />
              <div className="relative bg-[#0E1726] p-2 rounded-lg border border-cyan-500/20">
                <Car className="w-6 h-6 text-cyan-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-md font-bold tracking-tight bg-gradient-to-r from-white via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  ALPAT OBD2 COCKPIT
                </h1>
                <span className="text-[10px] uppercase tracking-widest bg-cyan-950 text-cyan-400 border border-cyan-800/50 px-1.5 py-0.5 rounded-sm font-semibold">
                  v1.5-BLE
                </span>
              </div>
              <p className="text-[11px] text-gray-400 truncate max-w-[200px] sm:max-w-none">
                {isSimulator ? "🤖 Simülasyon Aktif" : `🔌 Bağlı: ${activeDevice}`}
              </p>
            </div>
          </div>

          {/* Action Center */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            
            {/* Mode Switcher */}
            <button
              onClick={() => {
                setIsSimulator(!isSimulator);
                if (!isSimulator) {
                  disconnectBluetooth();
                } else {
                  addLog("info", "Simülatör moduna geçildi. Donanım bağlantısı devredışı.");
                }
              }}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all duration-200 flex items-center gap-1.5 ${
                isSimulator 
                  ? "bg-amber-950/30 text-amber-400 border-amber-800/40" 
                  : "bg-[#0E1726] text-gray-400 border-gray-800 hover:text-white"
              }`}
              id="btn_mode_toggle"
              title="Donanım veya Simülasyon modları arasında geçiş yapın"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {isSimulator ? "Simülatör Açık" : "Simülatöre Geç"}
            </button>

            {/* Hardware Connect button */}
            {btState === "connected" ? (
              <button
                onClick={disconnectBluetooth}
                className="bg-red-950/40 text-red-400 border border-red-900/50 hover:bg-red-900/30 text-xs px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all"
                id="btn_ble_disconnect"
              >
                <XCircle className="w-3.5 h-3.5" />
                Bağlantıyı Kes
              </button>
            ) : (
              <button
                onClick={connectWebBluetooth}
                disabled={btState === "scanning" || btState === "connecting" || btState === "initializing"}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all relative overflow-hidden group ${
                  btState !== "disconnected"
                    ? "bg-cyan-950 text-cyan-400 border border-cyan-800 animate-pulse"
                    : "bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:shadow-lg hover:shadow-cyan-500/20 active:scale-95"
                }`}
                id="btn_ble_connect"
              >
                <Bluetooth className={`w-3.5 h-3.5 ${btState !== "disconnected" ? "animate-spin" : ""}`} />
                {btState === "scanning" && "Taranıyor..."}
                {btState === "connecting" && "Bağlanıyor..."}
                {btState === "initializing" && "Eşleşiyor..."}
                {btState === "disconnected" && "Cihaza Bağlan"}
              </button>
            )}

            {/* Settings Toggle */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1.5 rounded-lg border transition-all ${
                showSettings 
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" 
                  : "bg-[#0A101D] border-gray-800 hover:border-gray-700 text-gray-400 hover:text-white"
              }`}
              id="btn_settings_toggle"
              aria-label="Ayarlar Panelini Aç/Kapat"
            >
              <Settings className="w-4 h-4" />
            </button>

          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto p-4 space-y-6" id="app_main_content">
        
        {/* Settings Panel (Expandable) */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
              id="settings_panel"
            >
              <div className="bg-[#0E1726]/80 border border-[#1F2C47] rounded-xl p-4 mb-4 backdrop-blur-sm space-y-4">
                <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                  <h3 className="text-sm font-bold text-cyan-400 flex items-center gap-1.5">
                    <Settings className="w-4 h-4" />
                    Sistem ve Yapay Zeka Ayarları
                  </h3>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="text-gray-400 hover:text-white text-xs"
                  >
                    Kapat
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left Column: Car Info & Gemini Key */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
                        Araç Marka / Model / Yıl
                      </label>
                      <input
                        type="text"
                        value={carModel}
                        onChange={(e) => setCarModel(e.target.value)}
                        placeholder="Örn: Ford Focus 1.6 TDCi (2015)"
                        className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                          Google Gemini API Anahtarı
                        </label>
                        <span className="text-[10px] text-gray-500 italic">Opsiyonel</span>
                      </div>
                      <div className="relative">
                        <input
                          type="password"
                          value={userApiKey}
                          onChange={(e) => setUserApiKey(e.target.value)}
                          placeholder="Boş bırakılırsa sistem sunucu anahtarını kullanır"
                          className="w-full bg-[#070B13] border border-gray-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                        />
                        <Key className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2.5" />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">
                        API anahtarınızı girdiğiniz takdirde doğrudan kendi kotanızdan çalışır. Güvenle yerel tarayıcı belleğinde tutulur.
                      </p>
                    </div>
                  </div>

                  {/* Right Column: API Information & Instruction */}
                  <div className="bg-[#070B13]/60 p-3 rounded-lg border border-gray-800 space-y-2">
                    <h4 className="text-xs font-semibold text-cyan-400 flex items-center gap-1">
                      <Info className="w-3.5 h-3.5" />
                      Web Bluetooth & OBD2 BLE Rehberi
                    </h4>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Gerçek bir OBD2 BLE cihazı bağlarken telefonunuzun Bluetooth'unun açık olduğundan emin olun. 
                      Bu uygulama standart <strong className="text-cyan-300">ELM327 Bluetooth v4.0 / Low Energy</strong> adaptörleriyle uyumludur. 
                      Desteklenen popüler cihazlar: Vgate iCar Pro BLE, LELink, Carista OBD2, Viecar BLE.
                    </p>
                    <div className="flex items-center gap-2 mt-2 bg-cyan-950/20 p-2 rounded border border-cyan-900/30">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      <span className="text-[10px] text-cyan-300">Sunucu Servis Entegrasyonu Aktif (Port: 3000)</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* MALFUNCTION INDICATOR (MIL / CHECK ENGINE) */}
        {dtcCodes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-r from-red-950/40 to-amber-950/20 border border-red-500/30 rounded-xl p-4 flex items-center justify-between shadow-lg shadow-red-950/10"
            id="mil_alert_banner"
          >
            <div className="flex items-center gap-3">
              <div className="p-3 bg-red-500/10 rounded-full border border-red-500/20 text-red-500 animate-pulse">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-red-400 flex items-center gap-1.5">
                  MOTOR ARIZA LAMBASI AKTİF (MIL)
                </h3>
                <p className="text-xs text-gray-300 mt-0.5">
                  Araç hafızasında <strong className="text-red-300">{dtcCodes.length} adet</strong> aktif arıza teşhis kodu saptandı.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {dtcCodes.map(code => (
                    <span key={code} className="bg-red-950 text-red-300 border border-red-800/60 px-2 py-0.5 rounded text-[11px] font-mono font-bold">
                      {code} : {DTC_DICTIONARY[code] || "Bilinmeyen Teşhis Kodu"}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                const element = document.getElementById("ai_diagnosis_section");
                if (element) element.scrollIntoView({ behavior: "smooth" });
              }}
              className="bg-red-900 hover:bg-red-800 text-white text-xs px-3 py-1.5 rounded-lg font-semibold hidden md:block transition-all"
            >
              Yapay Zeka Raporunu İncele
            </button>
          </motion.div>
        )}

        {/* INSTRUMENT PANEL - REVOLUTIONARY GAUGE CLUSTER */}
        <section className="bg-[#0B101D] border border-[#141B2D] rounded-2xl p-6 shadow-2xl relative" id="gauge_cluster">
          <div className="absolute top-3 right-4 flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-widest font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping" />
            CANLI SENSÖR VERİLERİ (OBD2)
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
            
            {/* GAUGE 1: MOTOR DEVRİ (RPM) */}
            <div className="flex flex-col items-center justify-center p-4 bg-[#070B13]/50 rounded-xl border border-gray-900 relative group overflow-hidden" id="gauge_rpm">
              {/* Dynamic RPM gauge card lighting */}
              <div className={`absolute inset-0 bg-radial from-transparent to-[#070B13]/95 pointer-events-none`} />
              <div className={`absolute -inset-10 bg-gradient-to-br transition-opacity duration-300 pointer-events-none opacity-5 ${
                isRedline ? "from-red-500 to-transparent" : "from-cyan-500 to-transparent"
              }`} />

              <div className="relative w-44 h-44 flex items-center justify-center">
                
                {/* SVG Circular Dial */}
                <svg className="w-full h-full -rotate-225">
                  {/* Gauge background track */}
                  <circle
                    cx="88"
                    cy="88"
                    r="72"
                    className="stroke-gray-800"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 72 * 0.75} ${2 * Math.PI * 72}`}
                    strokeLinecap="round"
                  />
                  {/* Gauge active value line */}
                  <circle
                    cx="88"
                    cy="88"
                    r="72"
                    className={`transition-all duration-150 ${
                      isRedline ? "stroke-red-500" : "stroke-cyan-500"
                    }`}
                    strokeWidth="10"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 72}`}
                    strokeDashoffset={calculateStrokeDashOffset(rpm, 8000, 72)}
                    strokeLinecap="round"
                    style={{
                      filter: isRedline 
                        ? "drop-shadow(0 0 8px rgba(239, 68, 68, 0.6))" 
                        : "drop-shadow(0 0 8px rgba(6, 182, 212, 0.4))"
                    }}
                  />
                </svg>

                {/* Gauge Digital Readings */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center mt-2">
                  <Gauge className={`w-5 h-5 mb-1 ${isRedline ? "text-red-500 animate-bounce" : "text-cyan-400"}`} />
                  <span className="text-3xl font-mono font-bold tracking-tight text-white">
                    {rpm}
                  </span>
                  <span className={`text-[10px] tracking-wider uppercase font-semibold ${isRedline ? "text-red-400" : "text-gray-400"}`}>
                    d/d (RPM)
                  </span>
                </div>

                {/* High Redline Indicator */}
                {isRedline && (
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-950 text-red-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-red-800 animate-pulse">
                    YÜKSEK DEVİR!
                  </div>
                )}
              </div>

              {/* Subtitle/Footer for gauge */}
              <div className="w-full flex justify-between items-center px-2 mt-2 border-t border-gray-900/60 pt-2 z-10">
                <span className="text-[11px] text-gray-500">Maks: 8000 RPM</span>
                <span className="text-[11px] text-gray-500">Rölanti: ~850 RPM</span>
              </div>
            </div>

            {/* GAUGE 2: ARAÇ HIZI (SPEED) */}
            <div className="flex flex-col items-center justify-center p-4 bg-[#070B13]/50 rounded-xl border border-gray-900 relative group overflow-hidden" id="gauge_speed">
              <div className="absolute inset-0 bg-radial from-transparent to-[#070B13]/95 pointer-events-none" />
              <div className="absolute -inset-10 bg-gradient-to-br from-blue-500 to-transparent transition-opacity duration-300 pointer-events-none opacity-5" />

              <div className="relative w-44 h-44 flex items-center justify-center">
                
                {/* SVG Circular Dial */}
                <svg className="w-full h-full -rotate-225">
                  <circle
                    cx="88"
                    cy="88"
                    r="72"
                    className="stroke-gray-800"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 72 * 0.75} ${2 * Math.PI * 72}`}
                    strokeLinecap="round"
                  />
                  <circle
                    cx="88"
                    cy="88"
                    r="72"
                    className="stroke-blue-400"
                    strokeWidth="10"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 72}`}
                    strokeDashoffset={calculateStrokeDashOffset(speed, 240, 72)}
                    strokeLinecap="round"
                    style={{
                      filter: "drop-shadow(0 0 8px rgba(96, 165, 250, 0.4))"
                    }}
                  />
                </svg>

                {/* Gauge Digital Readings */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center mt-2">
                  <Activity className="w-5 h-5 mb-1 text-blue-400" />
                  <span className="text-4xl font-mono font-bold tracking-tight text-white">
                    {speed}
                  </span>
                  <span className="text-[10px] tracking-wider uppercase text-gray-400 font-semibold">
                    km/s (km/h)
                  </span>
                </div>
              </div>

              {/* Subtitle/Footer for gauge */}
              <div className="w-full flex justify-between items-center px-2 mt-2 border-t border-gray-900/60 pt-2 z-10">
                <span className="text-[11px] text-gray-500">Maks: 240 km/s</span>
                <span className="text-[11px] text-gray-500">Aktif Sürüş Hızı</span>
              </div>
            </div>

            {/* GAUGE 3: SOĞUTMA SUYU SICAKLIĞI (ECT) */}
            <div className="flex flex-col items-center justify-center p-4 bg-[#070B13]/50 rounded-xl border border-gray-900 relative group overflow-hidden" id="gauge_temp">
              <div className="absolute inset-0 bg-radial from-transparent to-[#070B13]/95 pointer-events-none" />
              <div className={`absolute -inset-10 bg-gradient-to-br transition-opacity duration-300 pointer-events-none opacity-5 ${
                isHighTemp ? "from-red-500 to-transparent" : "from-emerald-500 to-transparent"
              }`} />

              <div className="relative w-44 h-44 flex items-center justify-center">
                
                {/* SVG Circular Dial */}
                <svg className="w-full h-full -rotate-225">
                  <circle
                    cx="88"
                    cy="88"
                    r="72"
                    className="stroke-gray-800"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 72 * 0.75} ${2 * Math.PI * 72}`}
                    strokeLinecap="round"
                  />
                  <circle
                    cx="88"
                    cy="88"
                    r="72"
                    className={`transition-all duration-150 ${
                      isOverheating ? "stroke-red-600" : isHighTemp ? "stroke-amber-500" : "stroke-emerald-400"
                    }`}
                    strokeWidth="10"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 72}`}
                    strokeDashoffset={calculateStrokeDashOffset(coolantTemp, 150, 72)}
                    strokeLinecap="round"
                    style={{
                      filter: isHighTemp 
                        ? "drop-shadow(0 0 8px rgba(248, 113, 113, 0.6))" 
                        : "drop-shadow(0 0 8px rgba(52, 211, 153, 0.4))"
                    }}
                  />
                </svg>

                {/* Gauge Digital Readings */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center mt-2">
                  <Thermometer className={`w-5 h-5 mb-1 ${
                    isOverheating ? "text-red-500 animate-pulse" : isHighTemp ? "text-amber-400" : "text-emerald-400"
                  }`} />
                  <span className="text-3.5xl font-mono font-bold tracking-tight text-white">
                    {coolantTemp}
                  </span>
                  <span className="text-[10px] tracking-wider uppercase text-gray-400 font-semibold">
                    SOĞUTMA SUYU (°C)
                  </span>
                </div>

                {/* Overheating Badge */}
                {isHighTemp && (
                  <div className={`absolute top-6 left-1/2 -translate-x-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded border animate-pulse ${
                    isOverheating 
                      ? "bg-red-950 text-red-500 border-red-800" 
                      : "bg-amber-950 text-amber-500 border-amber-800"
                  }`}>
                    {isOverheating ? "HARARET TEHLİKESİ!" : "YÜKSEK SICAKLIK"}
                  </div>
                )}
              </div>

              {/* Subtitle/Footer for gauge */}
              <div className="w-full flex justify-between items-center px-2 mt-2 border-t border-gray-900/60 pt-2 z-10">
                <span className="text-[11px] text-gray-500">Maks: 150 °C</span>
                <span className="text-[11px] text-gray-500">Normal: 80 - 95 °C</span>
              </div>
            </div>

          </div>

          {/* Additional auxiliary metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 border-t border-gray-900 pt-4 text-center">
            <div className="p-2 bg-[#070B13]/30 rounded-lg border border-gray-900/50">
              <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Akü Voltajı</span>
              <span className="text-md font-mono font-bold text-amber-400">{voltage} V</span>
            </div>
            <div className="p-2 bg-[#070B13]/30 rounded-lg border border-gray-900/50">
              <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-semibold">ECU Protokolü</span>
              <span className="text-md font-mono font-bold text-cyan-400">
                {isSimulator ? "ISO 15765-4 (Sim)" : "ISO 15765-4 (CAN)"}
              </span>
            </div>
            <div className="p-2 bg-[#070B13]/30 rounded-lg border border-gray-900/50">
              <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Bağlantı Modu</span>
              <span className="text-md font-mono font-bold text-blue-400">
                {isSimulator ? "VIRTUAL SERIAL" : "WEB BLUETOOTH"}
              </span>
            </div>
            <div className="p-2 bg-[#070B13]/30 rounded-lg border border-gray-900/50">
              <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-semibold">MIL Durumu</span>
              <span className={`text-md font-mono font-bold ${dtcCodes.length > 0 ? "text-red-500" : "text-emerald-400"}`}>
                {dtcCodes.length > 0 ? "⚠️ HATA VAR" : "✅ ARASIZ TEMİZ"}
              </span>
            </div>
          </div>
        </section>

        {/* TWO-COLUMN LOWER AREA: CONTROLS & AI DIAGNOSTICS */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT COLUMN: CONTROL DECK (4 Cols) */}
          <section className="lg:col-span-5 space-y-6">
            
            {/* SIMULATOR CONTROLLER PANEL */}
            {isSimulator && (
              <div className="bg-[#0B101D] border border-amber-950/40 rounded-2xl p-5 relative overflow-hidden" id="simulator_deck">
                <div className="absolute top-0 right-0 bg-amber-500/10 text-amber-400 text-[10px] font-mono px-2 py-0.5 rounded-bl border-l border-b border-amber-950/40">
                  SIMÜLASYON DÜZENEĞİ
                </div>

                <h3 className="text-sm font-bold text-amber-400 mb-4 flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-amber-400" />
                  Sensör Simülatörü Kontrolleri
                </h3>

                <div className="space-y-4">
                  {/* Throttle slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-300 font-medium flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-500" />
                        Gaz Pedalı Basıncı (Hız/RPM)
                      </span>
                      <span className="text-amber-400 font-bold font-mono">{simThrottle}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={simThrottle}
                      onChange={(e) => setSimThrottle(parseInt(e.target.value))}
                      className="w-full accent-amber-500 bg-[#070B13] h-1.5 rounded-lg appearance-none cursor-pointer"
                      aria-label="Gaz Pedalı Basıncı Yüzdesi"
                    />
                    <p className="text-[10px] text-gray-500">
                      Gazı artırarak devri {Math.round(850 + (simThrottle/100)*5800)} RPM'e ve hızı {Math.round((simThrottle/100)*190)} km/s'e yükseltin.
                    </p>
                  </div>

                  {/* Coolant temp slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-300 font-medium flex items-center gap-1">
                        <Thermometer className="w-3 h-3 text-red-500" />
                        Simüle Soğutma Suyu Sıcaklığı
                      </span>
                      <span className="text-amber-400 font-bold font-mono">{simTemp} °C</span>
                    </div>
                    <input
                      type="range"
                      min="40"
                      max="140"
                      value={simTemp}
                      onChange={(e) => setSimTemp(parseInt(e.target.value))}
                      className="w-full accent-amber-500 bg-[#070B13] h-1.5 rounded-lg appearance-none cursor-pointer"
                      aria-label="Soğutma Suyu Sıcaklığı Değeri"
                    />
                    <p className="text-[10px] text-gray-500">
                      Normal motor sıcaklığı 90°C'dir. 115°C üzerine çıkararak hararet teşhis testi simüle edin.
                    </p>
                  </div>

                  {/* Inject Malfunction Type selector */}
                  <div className="space-y-1 pt-2 border-t border-gray-900">
                    <label className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
                      Arıza Kodu Enjekte Et (DTC Injector)
                    </label>
                    <select
                      value={simErrorType}
                      onChange={handleMalfunctionChange}
                      className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-3 py-2 text-xs text-amber-400 font-semibold focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                      aria-label="Arıza Kodu Seçin"
                    >
                      <option value="NONE">✅ Herhangi bir arıza saptanmadı (Sistem Temiz)</option>
                      <option value="P0113">⚠️ P0113 - Emme Havası Sıcaklık Sensörü 1 Devre Yüksek Giriş</option>
                      <option value="P0115">⚠️ P0115 - Motor Soğutma Suyu Sıcaklık Sensörü Arızası</option>
                      <option value="P0171">⚠️ P0171 - Sistem Çok Fakir (Sıra 1)</option>
                      <option value="P0302">⚠️ P0302 - Silindir 2 Ateşleme Kaçırma Saptandı</option>
                      <option value="P0420">⚠️ P0420 - Katalizör Sistemi Etkinliği Eşik Altında</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ACTION TRIGGERS & DISCOVERY PANEL */}
            <div className="bg-[#0B101D] border border-[#141B2D] rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-cyan-400 mb-1 flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-cyan-400" />
                OBD-II Teşhis Kontrol İstasyonu
              </h3>

              <div className="space-y-3">
                {/* Scan DTC codes button with loading */}
                <button
                  onClick={handleScanDtc}
                  disabled={isScanningDtc}
                  className="w-full bg-gradient-to-r from-blue-900/60 to-cyan-900/60 hover:from-blue-800/80 hover:to-cyan-800/80 disabled:from-gray-900 disabled:to-gray-900 border border-cyan-800/50 hover:border-cyan-700 rounded-xl py-3 px-4 text-xs font-bold transition-all relative overflow-hidden"
                  id="btn_scan_dtc"
                >
                  {isScanningDtc ? (
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
                      <span>TARANIYOR... %{scanProgress}</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <Activity className="w-4 h-4 text-cyan-400" />
                      <span>OBD ARIZA TEŞHİS KODU TARA (DTC SCAN)</span>
                    </div>
                  )}
                </button>

                {/* Simulated scan progress bar */}
                {isScanningDtc && (
                  <div className="space-y-1">
                    <div className="w-full bg-[#070B13] rounded-full h-1.5 overflow-hidden">
                      <div 
                        className="bg-cyan-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${scanProgress}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-cyan-300 block text-center animate-pulse">
                      {scanMessage}
                    </span>
                  </div>
                )}

                {/* Year/Model Custom Manual entry or code input for user */}
                <div className="pt-2 border-t border-gray-900 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                      Manuel Hata Kodu Ekle
                    </span>
                    <span className="text-[9px] text-gray-500">Opsiyonel</span>
                  </div>
                  <input
                    type="text"
                    value={customDtc}
                    onChange={(e) => setCustomDtc(e.target.value.toUpperCase())}
                    placeholder="Örn: P0133, P0300 vb."
                    className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white uppercase focus:border-cyan-500 focus:outline-none"
                    aria-label="Manuel Hata Kodu Girişi"
                  />
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    OBD adaptörü tarafından taranmayan özel bir hata kodu veya ek sürüş şikayetlerinizi buraya yazarak yapay zeka analizine dahil edebilirsiniz.
                  </p>
                </div>

                {/* Launch AI analysis button */}
                <button
                  onClick={handleAIAnalysis}
                  disabled={isDiagnosing}
                  className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-800 disabled:text-gray-500 text-[#070B13] font-bold py-3 rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/10 hover:shadow-cyan-400/20 active:scale-98"
                  id="btn_ai_diagnose"
                >
                  <Cpu className="w-4 h-4" />
                  {isDiagnosing ? "YAPAY ZEKA ANALİZİ YAPILIYOR..." : "GEMINI YAPAY ZEKA İLE ANALİZ ET"}
                </button>
              </div>
            </div>

            {/* RAW HEX TERMINAL LOGGER */}
            <div className="bg-[#05080E] border border-gray-900 rounded-2xl p-4 space-y-2 font-mono">
              <div className="flex items-center justify-between border-b border-gray-900 pb-2">
                <span className="text-xs font-bold text-gray-400 flex items-center gap-1">
                  <Terminal className="w-3.5 h-3.5 text-cyan-500" />
                  OBD2 HEX Terminal Konsolu
                </span>
                <button
                  onClick={() => {
                    setLogs([{ timestamp: new Date().toLocaleTimeString(), type: "info", message: "Terminal temizlendi." }]);
                  }}
                  className="text-gray-600 hover:text-cyan-400 text-[10px] flex items-center gap-1 transition-all"
                  id="btn_clear_terminal"
                  title="Konsol geçmişini sıfırlayın"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Temizle
                </button>
              </div>

              {/* Logs area */}
              <div className="h-44 overflow-y-auto space-y-1.5 text-[11px] pr-1 scrollbar-thin scrollbar-thumb-gray-800" id="terminal_logs">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-1.5 items-start">
                    <span className="text-gray-600 text-[9px] select-none pt-0.5">{log.timestamp}</span>
                    {log.type === "tx" && (
                      <span className="text-blue-400 font-bold shrink-0">TX: {log.message}</span>
                    )}
                    {log.type === "rx" && (
                      <span className="text-emerald-400 shrink-0">RX: {log.message}</span>
                    )}
                    {log.type === "info" && (
                      <span className="text-gray-400 shrink-0">INF: {log.message}</span>
                    )}
                    {log.type === "error" && (
                      <span className="text-red-500 shrink-0 font-semibold">ERR: {log.message}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </section>

          {/* RIGHT COLUMN: AI DIAGNOSTICS & TELEMETRY INSIGHTS (7 Cols) */}
          <section className="lg:col-span-7" id="ai_diagnosis_section">
            <div className="bg-[#0B101D] border border-[#141B2D] rounded-2xl p-6 h-full flex flex-col justify-between">
              
              <div className="space-y-4 flex-1">
                <div className="flex items-center justify-between border-b border-gray-900 pb-3">
                  <div>
                    <h3 className="text-md font-bold text-white flex items-center gap-2">
                      <Zap className="w-5 h-5 text-cyan-400 animate-pulse" />
                      Gemini Yapay Zeka Teşhis ve Rapor Paneli
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Sürüş değerleri, motor ısısı ve hata kodlarının profesyonel tahlili.
                    </p>
                  </div>
                  <div className="bg-cyan-950 text-cyan-400 text-[10px] font-mono px-2 py-1 rounded border border-cyan-800/30">
                    Model: gemini-3.8-flash
                  </div>
                </div>

                {/* AI Error Display */}
                {diagnosticError && (
                  <div className="bg-red-950/20 border border-red-500/20 p-4 rounded-xl text-red-400 text-xs flex items-start gap-2 animate-pulse">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Bağlantı/Yetkilendirme Sorunu: </span>
                      {diagnosticError}
                    </div>
                  </div>
                )}

                {/* DIAGNOSIS OUTPUT / TERMINAL AREA */}
                <div className="bg-[#05080E]/70 border border-gray-900 rounded-xl p-5 min-h-[350px] relative overflow-hidden flex flex-col justify-center">
                  
                  {isDiagnosing ? (
                    /* Pulsating scanning effect while waiting */
                    <div className="flex flex-col items-center justify-center text-center space-y-4 py-12 z-10">
                      <div className="relative">
                        <div className="w-16 h-16 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
                        <Cpu className="w-6 h-6 text-cyan-400 absolute inset-0 m-auto animate-pulse" />
                      </div>
                      <div className="space-y-1.5">
                        <h4 className="text-sm font-bold text-white uppercase tracking-wider animate-pulse">
                          YAPAY ZEKA TEŞHİS RAPORU HAZIRLANIYOR...
                        </h4>
                        <p className="text-xs text-gray-400 max-w-sm">
                          Hata kodları (DTC) çözümleniyor, motor sensör verileri ve {carModel} araç karakteristiği değerlendiriliyor.
                        </p>
                      </div>
                    </div>
                  ) : diagnosis ? (
                    /* Rendered Diagnosis Markdown Text */
                    <div className="markdown-body text-gray-300 space-y-3 prose prose-invert max-w-none text-left select-text">
                      {renderMarkdownText(diagnosis)}
                    </div>
                  ) : (
                    /* Default state before analysis runs */
                    <div className="text-center py-12 space-y-4">
                      <div className="w-16 h-16 rounded-full bg-gray-950 flex items-center justify-center mx-auto border border-gray-900">
                        <Cpu className="w-8 h-8 text-gray-600" />
                      </div>
                      <div className="space-y-1 max-w-md mx-auto">
                        <h4 className="text-sm font-bold text-gray-300">Henüz Bir Analiz Raporu Başlatılmadı</h4>
                        <p className="text-xs text-gray-500 leading-relaxed">
                          Aracınızın OBD-II sensör verilerini yukarıdaki panelden simüle edin veya BLE ile bağlanarak okuyun, ardından 
                          <strong>"Gemini Yapay Zeka ile Analiz Et"</strong> butonuna tıklayarak profesyonel arıza analiz raporu alın.
                        </p>
                      </div>
                      
                      {/* Interactive suggestion cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto pt-4 text-left">
                        <div 
                          onClick={() => {
                            setSimErrorType("P0115");
                            setDtcCodes(["P0115"]);
                            setSimTemp(120);
                            addLog("info", "Test senaryosu yüklendi: Motor Harareti / ECT Sensör Arızası.");
                          }}
                          className="bg-[#0B101D] hover:bg-[#0E1726] border border-gray-900 p-3 rounded-lg cursor-pointer transition-all hover:border-cyan-800/40"
                        >
                          <span className="block text-[11px] font-bold text-cyan-400 flex items-center gap-1">
                            <Thermometer className="w-3.5 h-3.5" /> ECT Sensör Testi
                          </span>
                          <span className="text-[10px] text-gray-400 mt-1 block">
                            P0115 arıza kodunu ve 120°C motor hararet durumunu simüle edin.
                          </span>
                        </div>
                        <div 
                          onClick={() => {
                            setSimErrorType("P0302");
                            setDtcCodes(["P0302"]);
                            setSimThrottle(50);
                            addLog("info", "Test senaryosu yüklendi: Silindir 2 Ateşleme Kaçırma.");
                          }}
                          className="bg-[#0B101D] hover:bg-[#0E1726] border border-gray-900 p-3 rounded-lg cursor-pointer transition-all hover:border-cyan-800/40"
                        >
                          <span className="block text-[11px] font-bold text-amber-500 flex items-center gap-1">
                            <Activity className="w-3.5 h-3.5" /> Silindir Kaçırma Testi
                          </span>
                          <span className="text-[10px] text-gray-400 mt-1 block">
                            P0302 arıza kodunu ve sarsıntılı motor rölanti devrini simüle edin.
                          </span>
                        </div>
                      </div>

                    </div>
                  )}

                </div>
              </div>

              {/* Bottom legal advisory footer */}
              <div className="mt-4 pt-3 border-t border-gray-900 flex items-center gap-2.5 text-[10px] text-gray-500 leading-tight">
                <Info className="w-4 h-4 text-gray-500 shrink-0" />
                <p>
                  <strong>Sorumluluk Reddi:</strong> Yapay zeka tarafından sağlanan analiz ve tamir tavsiyeleri sadece bilgilendirme amaçlıdır. 
                  Sürüş güvenliğiniz ve doğru mekanik onarım için yetkili servis veya lisanslı bir oto tamir ustasına başvurmanız şiddetle tavsiye edilir.
                </p>
              </div>

            </div>
          </section>

        </div>

      </main>

      {/* Floating status strip */}
      <footer className="border-t border-[#141B2D] bg-[#05080E] py-4 text-center text-xs text-gray-500 font-medium">
        <p>© 2026 OBD2 BLE Cockpit Diagnostics. Built with Google Gemini API and Web Bluetooth API.</p>
      </footer>

    </div>
  );
}
