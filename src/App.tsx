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
  CheckCircle,
  Wrench,
  ToggleLeft,
  Settings2,
  Send,
  SlidersIcon,
  Layers
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Standard OBD-II PIDs and BLE Constants
const NORDIC_UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NORDIC_RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // write
const NORDIC_TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify

const VGATE_SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
const VGATE_CHAR_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"; // write & notify

// Vehicle Profile Definitions
interface VehicleProfile {
  id: string;
  name: string;
  engine: string;
  protocol: string;
  initCommands: string[];
  moduleHeaders: {
    engine: string;
    body: string;
    dashboard?: string;
  };
  chronicIssues: string[];
  defaultDtcList: string[];
}

const VEHICLE_PROFILES: Record<string, VehicleProfile> = {
  "ford_mondeo_mk3": {
    id: "ford_mondeo_mk3",
    name: "2005 Ford Mondeo MK3 (HS/MS-CAN)",
    engine: "2.0 TDCi (Duratorq 130 HP)",
    protocol: "SAE J1850 PWM / ISO 15765-4 (CAN)",
    initCommands: ["ATZ", "ATE0", "ATH1", "ATSP6", "ATSH720"],
    moduleHeaders: {
      engine: "720",
      body: "730",
      dashboard: "760"
    },
    chronicIssues: [
      "Enjektör kodlama kaybı ve yakıt rayı basınç dalgalanması",
      "EGR valfi tıkanması ve siyah duman atma problemi",
      "Çift kütleli volan (DMF) aşınması ve şanzıman sarsıntısı",
      "Kam mili konum sensörü arızası (Isınınca stop etme)",
      "Radyatör fan rezistansı yanması (Düşük kademe fanın çalışmaması)"
    ],
    defaultDtcList: ["P0115", "P0302", "P0102"]
  },
  "renault_megane_4": {
    id: "renault_megane_4",
    name: "2016 Renault Megane 4 (UCH / BCM)",
    engine: "1.5 dCi (Energy dCi 110 HP)",
    protocol: "ISO 15765-4 (CAN 11bit 500kbps)",
    initCommands: ["ATZ", "ATE0", "ATH1", "ATSP6", "ATSH7E0"],
    moduleHeaders: {
      engine: "7E0",
      body: "7A0",
      dashboard: "744"
    },
    chronicIssues: [
      "UCH (Konfor Beyni) yazılım hataları ve gösterge paneli sıfırlanması",
      "EDC Çift kavramalı şanzıman ısınma uyarısı (Kavrama yıpranması)",
      "Hands-free Eller Serbest kart algılama anten arızası",
      "R-Link 2 multimedya ekran kilitlenmesi ve bluetooth kopmaları",
      "Elektrikli direksiyon kilidi (ELV) kilitlenme arızası"
    ],
    defaultDtcList: ["P0420", "P0500", "P0113"]
  }
};

// DTC Common Explanations in Turkish
const DTC_DICTIONARY: Record<string, string> = {
  "P0102": "Kütle Hava Akış (MAF) Sensörü Devresi Düşük Giriş - Hava akış ölçümü hatalı.",
  "P0113": "Emme Havası Sıcaklık (IAT) Sensörü 1 Devresi Yüksek Giriş - Emilen hava sıcaklığı anormal.",
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
  
  // Custom API key & Selected Profile
  const [selectedProfileId, setSelectedProfileId] = useState<string>("ford_mondeo_mk3");
  const [userApiKey, setUserApiKey] = useState<string>("");
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [customDtc, setCustomDtc] = useState<string>("");

  // Advanced Bluetooth Connection Options
  const [bleFilterMode, setBleFilterMode] = useState<"standard" | "all" | "custom">("standard");
  const [customDevicePrefix, setCustomDevicePrefix] = useState<string>("OBD");
  const [bleProfile, setBleProfile] = useState<"auto" | "vgate" | "nordic" | "custom">("auto");
  const [customServiceUuid, setCustomServiceUuid] = useState<string>("");
  const [customWriteCharUuid, setCustomWriteCharUuid] = useState<string>("");
  const [customNotifyCharUuid, setCustomNotifyCharUuid] = useState<string>("");

  // Current active profile shortcut
  const activeProfile = VEHICLE_PROFILES[selectedProfileId];
  
  // Telemetry Metrics
  const [rpm, setRpm] = useState<number>(850); 
  const [coolantTemp, setCoolantTemp] = useState<number>(85); 
  const [speed, setSpeed] = useState<number>(0);
  const [voltage, setVoltage] = useState<number>(14.1); 
  const [dtcCodes, setDtcCodes] = useState<string[]>(["P0115"]);

  // Scanner State
  const [isScanningDtc, setIsScanningDtc] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [scanMessage, setScanMessage] = useState<string>("");

  // Simulator Settings
  const [simThrottle, setSimThrottle] = useState<number>(0);
  const [simTemp, setSimTemp] = useState<number>(85);
  const [simErrorType, setSimErrorType] = useState<string>("P0115");

  // Terminal Logs
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: new Date().toLocaleTimeString(), type: "info", message: "ALPAT OBD-II Sistemi başlatıldı. Uygun bir araç profili seçerek bağlantı kurabilirsiniz." }
  ]);

  // Command panel states
  const [commandTestConsole, setCommandTestConsole] = useState<string>("");
  const [isExecutingModuleCmd, setIsExecutingModuleCmd] = useState<boolean>(false);
  const [moduleCmdResult, setModuleCmdResult] = useState<string | null>(null);

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

  // Update simulator profile-specific metrics and error presets
  useEffect(() => {
    // When changing vehicle profile, update the active default error type
    const profile = VEHICLE_PROFILES[selectedProfileId];
    if (profile) {
      setSimErrorType(profile.defaultDtcList[0] || "NONE");
      setDtcCodes([profile.defaultDtcList[0]]);
      addLog("info", `Profil Değiştirildi: ${profile.name}. CAN filtreleri ve AT komut dizini yüklendi.`);
    }
  }, [selectedProfileId, addLog]);

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
      addLog("info", "Bluetooth tarama parametreleri yapılandırılıyor...");

      const options: any = {};
      const targetServices = [NORDIC_UART_SERVICE_UUID, VGATE_SERVICE_UUID];

      if (bleProfile === "custom" && customServiceUuid.trim()) {
        const cleanUuid = customServiceUuid.trim().toLowerCase();
        if (!targetServices.includes(cleanUuid)) {
          targetServices.push(cleanUuid);
        }
      }

      options.optionalServices = targetServices;

      // Filter settings
      if (bleFilterMode === "all") {
        options.acceptAllDevices = true;
        addLog("info", "Filtresiz BLE taraması aktif. Tüm Bluetooth LE cihazları listelenecektir.");
      } else if (bleFilterMode === "custom" && customDevicePrefix.trim()) {
        options.filters = [{ namePrefix: customDevicePrefix.trim() }];
        addLog("info", `Özel isim öneki filtresi aktif: "${customDevicePrefix.trim()}"`);
      } else {
        options.filters = [
          { namePrefix: "OBD" },
          { namePrefix: "ELM" },
          { namePrefix: "V-LINK" },
          { namePrefix: "VGATE" },
          { namePrefix: "CARISTA" },
          { namePrefix: "LELink" },
          { namePrefix: "Viecar" },
          { namePrefix: "Veepeak" }
        ];
        addLog("info", "Standart OBD2 BLE filtreleri aktif (OBD, ELM, VGATE, LELink vb. aranıyor)...");
      }

      const device = await nav.bluetooth.requestDevice(options);

      setBtState("connecting");
      const deviceName = (device as any).name || "İsimsiz OBD Adaptörü";
      setActiveDevice(deviceName);
      addLog("info", `Cihaz seçildi: ${deviceName}. GATT servisine bağlanılıyor...`);

      (device as any).addEventListener("gattserverdisconnected", handleGattDisconnect);

      const server = await (device as any).gatt?.connect();
      if (!server) throw new Error("GATT Sunucusuna bağlanılamadı.");
      gattServerRef.current = server;

      setBtState("initializing");
      addLog("info", "Hizmetler ve karakteristikler sorgulanıyor...");

      let service;
      let rxChar;
      let txChar;

      if (bleProfile === "vgate") {
        addLog("info", "Profil Filtresi: Vgate / LELink OBD servisi bağlanıyor...");
        service = await server.getPrimaryService(VGATE_SERVICE_UUID);
        rxChar = await service.getCharacteristic(VGATE_CHAR_UUID);
        txChar = rxChar; 
        addLog("info", "Vgate / LELink standart BLE OBD servisi başarıyla kuruldu.");
      } else if (bleProfile === "nordic") {
        addLog("info", "Profil Filtresi: Nordic UART (NUS) servisi bağlanıyor...");
        service = await server.getPrimaryService(NORDIC_UART_SERVICE_UUID);
        rxChar = await service.getCharacteristic(NORDIC_RX_CHAR_UUID);
        txChar = await service.getCharacteristic(NORDIC_TX_CHAR_UUID);
        addLog("info", "Nordic UART (NUS) BLE OBD servisi başarıyla kuruldu.");
      } else if (bleProfile === "custom" && customServiceUuid.trim() && customWriteCharUuid.trim() && customNotifyCharUuid.trim()) {
        const sUuid = customServiceUuid.trim().toLowerCase();
        const wUuid = customWriteCharUuid.trim().toLowerCase();
        const nUuid = customNotifyCharUuid.trim().toLowerCase();
        addLog("info", `Profil Filtresi: Özel UUID servisi bağlanıyor... Svc: ${sUuid}`);
        try {
          service = await server.getPrimaryService(sUuid);
          rxChar = await service.getCharacteristic(wUuid);
          txChar = await service.getCharacteristic(nUuid);
          addLog("info", "Özel BLE OBD servisleri başarıyla kuruldu.");
        } catch (eCustom) {
          throw new Error(`Belirttiğiniz özel UUID servisleri cihazda bulunamadı: ${eCustom.message}`);
        }
      } else {
        // Auto detection mode
        addLog("info", "Profil Filtresi: Otomatik algılama devrede. Vgate servisi deneniyor...");
        try {
          service = await server.getPrimaryService(VGATE_SERVICE_UUID);
          rxChar = await service.getCharacteristic(VGATE_CHAR_UUID);
          txChar = rxChar; 
          addLog("info", "Vgate / LELink standart BLE OBD servisi başarıyla kuruldu.");
        } catch (e) {
          addLog("info", "Vgate servisi bulunamadı. Nordic UART (NUS) servisi deneniyor...");
          try {
            service = await server.getPrimaryService(NORDIC_UART_SERVICE_UUID);
            rxChar = await service.getCharacteristic(NORDIC_RX_CHAR_UUID);
            txChar = await service.getCharacteristic(NORDIC_TX_CHAR_UUID);
            addLog("info", "Nordic UART (NUS) BLE OBD servisi başarıyla kuruldu.");
          } catch (e2) {
            throw new Error("Uyumlu bir ELM327 OBD BLE servisi bulunamadı. Lütfen Ayarlar'dan manuel bağlantı profilini veya tüm cihazları seçmeyi deneyin.");
          }
        }
      }

      writeCharRef.current = rxChar;
      notifyCharRef.current = txChar;

      await txChar.startNotifications();
      txChar.addEventListener("characteristicvaluechanged", handleBluetoothNotification);

      setBtState("connected");
      setIsSimulator(false); 
      addLog("info", `Bluetooth Bağlantısı Aktif! ELM327 adaptörüne ${activeProfile.name} özel komut dizini gönderiliyor...`);

      // Send AT initialization sequence tailored to profile
      await new Promise(r => setTimeout(r, 600));
      for (const cmd of activeProfile.initCommands) {
        await sendBLECommand(cmd);
        await new Promise(r => setTimeout(r, 600));
      }

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
    }, 1000); 
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
    setScanMessage("Araç sistemleri ve CAN Bus taranıyor...");

    const steps = [
      "SAE J1850 / ISO 15765 protokol hızı kontrol ediliyor...",
      `ECU Modül Adresleri sorgulanıyor (Hedef Header: ATSH${activeProfile.moduleHeaders.engine})...`,
      `Arıza kayıt defteri okunuyor (DTC)...`,
      `Kalıcı ve geçici arıza kodları çözümleniyor...`,
      "Hata okuma işlemi başarıyla tamamlandı."
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
        addLog("info", `Arıza kodları taranıp çözümlendi. Aktif DTC: ${dtcCodes.join(", ")}`);
      }
    }, 800);
  };

  // Execute Simulated Module Diagnostic Tests
  const handleExecuteModuleCmd = (cmdTitle: string, commandHex: string, expectedResponseHex: string) => {
    setIsExecutingModuleCmd(true);
    setModuleCmdResult(null);
    addLog("tx", `[MODÜL TESTİ] ${commandHex}`);
    
    setTimeout(() => {
      setIsExecutingModuleCmd(false);
      setModuleCmdResult(expectedResponseHex);
      addLog("rx", expectedResponseHex);
      addLog("info", `"${cmdTitle}" testi başarıyla yürütüldü. Modül onay mesajı alındı.`);
    }, 1200);
  };

  // Gemini API analysis via Server-Side API
  const handleAIAnalysis = async () => {
    setIsDiagnosing(true);
    setDiagnosis("");
    setDiagnosticError(null);
    addLog("info", `Teşhis verileri toplanıyor: ${activeProfile.name} için kronik problemler ve sensör verileri analiz ediliyor...`);

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
          carModel: `${activeProfile.name} - Motor: ${activeProfile.engine}`,
          customDtcInput: `${customDtc}. Bu aracın kronik sorunları şunlardır: ${activeProfile.chronicIssues.join(", ")}. Lütfen bu kronik sorunların mevcut sensör değerleri ve DTC kodlarıyla ilişkisini de yorumla.`,
          userApiKey: userApiKey
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Sunucu teşhis talebini işleyemedi.");
      }

      setDiagnosis(data.diagnosis);
      addLog("info", "Gemini araç teşhis raporu başarıyla üretildi.");
    } catch (err: any) {
      setDiagnosticError(err.message || "Yapay zeka analizi sırasında bir bağlantı sorunu oluştu.");
      addLog("error", `AI Analiz hatası: ${err.message}`);
    } finally {
      setIsDiagnosing(false);
    }
  };

  // Custom renderer for markdown with high fidelity design
  const renderMarkdownText = (text: string) => {
    if (!text) return null;
    const lines = text.split("\n");
    return lines.map((line, index) => {
      let cleanLine = line.trim();
      if (cleanLine.startsWith("## ")) {
        return (
          <h2 key={index} className="text-sm font-bold text-cyan-400 mt-5 mb-2 border-b border-cyan-950/40 pb-1 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            {cleanLine.replace("## ", "")}
          </h2>
        );
      }
      if (cleanLine.startsWith("### ")) {
        return (
          <h3 key={index} className="text-xs font-semibold text-amber-400 mt-4 mb-1">
            {cleanLine.replace("### ", "")}
          </h3>
        );
      }
      if (cleanLine.startsWith("- ") || cleanLine.startsWith("* ")) {
        const parts = cleanLine.substring(2).split("**");
        return (
          <li key={index} className="ml-4 list-disc text-gray-300 my-1 text-xs">
            {parts.map((part, pIdx) => pIdx % 2 === 1 ? <strong key={pIdx} className="text-cyan-300 font-semibold">{part}</strong> : part)}
          </li>
        );
      }
      if (cleanLine === "") {
        return <div key={index} className="h-1.5" />;
      }
      const parts = cleanLine.split("**");
      return (
        <p key={index} className="text-gray-300 leading-relaxed my-1 text-xs">
          {parts.map((part, pIdx) => pIdx % 2 === 1 ? <strong key={pIdx} className="text-cyan-300 font-semibold">{part}</strong> : part)}
        </p>
      );
    });
  };

  const calculateStrokeDashOffset = (value: number, max: number, radius: number) => {
    const circumference = 2 * Math.PI * radius;
    const boundedValue = Math.max(0, Math.min(value, max));
    const percentage = boundedValue / max;
    const arcLength = circumference * 0.75;
    return circumference - (percentage * arcLength);
  };

  const isHighTemp = coolantTemp > 102;
  const isOverheating = coolantTemp > 115;
  const isRedline = rpm > 6200;

  return (
    <div className="min-h-screen bg-[#070B13] text-white font-sans antialiased selection:bg-cyan-500/30 overflow-x-hidden" id="app_root">
      
      {/* Background Neon Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#141B2D_1px,transparent_1px),linear-gradient(to_bottom,#141B2D_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-25" />

      {/* Main Header */}
      <header className="relative border-b border-[#141B2D] bg-[#0A101D]/90 backdrop-blur-md sticky top-0 z-40 px-4 py-3" id="app_header">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          
          {/* Brand/Logo & Vehicle Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full sm:w-auto">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 opacity-75 blur-xs animate-pulse" />
                <div className="relative bg-[#0E1726] p-2 rounded-lg border border-cyan-500/20">
                  <Car className="w-6 h-6 text-cyan-400" />
                </div>
              </div>
              <div>
                <h1 className="text-md font-bold tracking-tight bg-gradient-to-r from-white via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  ALPAT OBD2 COCKPIT
                </h1>
                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
                  {isSimulator ? "🤖 SİMÜLATÖR AKTİF" : `🔌 BAĞLI: ${activeDevice}`}
                </p>
              </div>
            </div>

            {/* Vehicle Profile Switcher */}
            <div className="relative" id="vehicle_profile_picker">
              <label htmlFor="vehicle_select" className="sr-only">Araç Profili Seçin</label>
              <select
                id="vehicle_select"
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="bg-[#0E1726] border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-cyan-400 font-semibold focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
              >
                {Object.values(VEHICLE_PROFILES).map((profile) => (
                  <option key={profile.id} value={profile.id} className="bg-[#0A101D] text-white">
                    🚗 {profile.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action Center */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            
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
              {isSimulator ? "Sanal Mod" : "Fiziksel Mod"}
            </button>

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
                {btState === "initializing" && "Kuruluyor..."}
                {btState === "disconnected" && "Adaptöre Bağlan"}
              </button>
            )}

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
        
        {/* Settings Panel */}
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
                    Gelişmiş Profil ve Yapay Zeka Ayarları
                  </h3>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="text-gray-400 hover:text-white text-xs"
                  >
                    Kapat
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
                        Seçili Profil Motor/Donanım
                      </label>
                      <div className="bg-[#070B13] p-2.5 rounded-lg border border-gray-800 text-xs text-gray-300">
                        <div className="flex justify-between mb-1">
                          <span className="text-gray-500">Motor Bilgisi:</span>
                          <span className="text-cyan-400 font-bold">{activeProfile.engine}</span>
                        </div>
                        <div className="flex justify-between mb-1">
                          <span className="text-gray-500">OBD-II Protokolü:</span>
                          <span className="text-amber-400 font-bold">{activeProfile.protocol}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Başlangıç Komutları:</span>
                          <span className="text-emerald-400 font-mono font-bold">{activeProfile.initCommands.join(" -> ")}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="api_key_input" className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                          Google Gemini API Anahtarı
                        </label>
                        <span className="text-[10px] text-gray-500 italic">Opsiyonel</span>
                      </div>
                      <div className="relative">
                        <input
                          id="api_key_input"
                          type="password"
                          value={userApiKey}
                          onChange={(e) => setUserApiKey(e.target.value)}
                          placeholder="Boş bırakılırsa sistem sunucu anahtarını kullanır"
                          className="w-full bg-[#070B13] border border-gray-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                        />
                        <Key className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2.5" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#070B13]/60 p-3 rounded-lg border border-gray-800 space-y-2">
                    <h4 className="text-xs font-semibold text-cyan-400 flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Araç Kronik Hataları Entegrasyonu
                    </h4>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Seçtiğiniz araç profili, Gemini AI arıza analiz raporuna dahil edilir. AI, sensör değerlerinin anormalliğini incelerken bu modelin bilinen kronik arıza hafızasından yararlanır:
                    </p>
                    <div className="flex flex-col gap-1 pl-2">
                      {activeProfile.chronicIssues.map((issue, idx) => (
                        <div key={idx} className="text-[10px] text-gray-300 flex items-start gap-1">
                          <span className="text-cyan-500 font-bold">•</span>
                          <span>{issue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Advanced BLE Connection Options Deck */}
                <div className="border-t border-gray-800 pt-4 mt-4 space-y-4">
                  <h4 className="text-xs font-bold text-cyan-400 flex items-center gap-1.5 uppercase tracking-wider">
                    <Bluetooth className="w-4 h-4 text-cyan-400 animate-pulse" />
                    Gelişmiş OBD-II Bluetooth Bağlantı Ayarları
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* BLE Filtering Mode */}
                    <div className="space-y-2">
                      <label className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                        1. Tarama ve Filtreleme Modu
                      </label>
                      <select
                        value={bleFilterMode}
                        onChange={(e) => setBleFilterMode(e.target.value as any)}
                        className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="standard">Filtreli Tarama (Standart OBD/ELM Cihazları)</option>
                        <option value="all">Filtresiz Tarama (Tüm Aktif BLE Cihazlarını Göster)</option>
                        <option value="custom">Özel İsim Öneki Filtresi (Prefix)</option>
                      </select>

                      {bleFilterMode === "custom" && (
                        <div className="space-y-1 mt-1">
                          <label className="block text-[9px] text-gray-500 uppercase">Özel İsim Öneki (Prefix)</label>
                          <input
                            type="text"
                            value={customDevicePrefix}
                            onChange={(e) => setCustomDevicePrefix(e.target.value)}
                            placeholder="Örn: OBD, ELM, VGATE, LELink"
                            className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-2 py-1 text-[11px] text-white focus:border-cyan-500 focus:outline-none"
                          />
                        </div>
                      )}
                      <p className="text-[10px] text-gray-500 leading-normal">
                        *Cihazınız standart listede görünmüyorsa "Filtresiz Tarama" veya "Özel İsim" modunu seçebilirsiniz.
                      </p>
                    </div>

                    {/* BLE Hardware Service Profile */}
                    <div className="space-y-2">
                      <label className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                        2. Adaptör Donanım Profili (BLE Service)
                      </label>
                      <select
                        value={bleProfile}
                        onChange={(e) => setBleProfile(e.target.value as any)}
                        className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="auto">Otomatik Algıla (Vgate veya Nordic UART dener)</option>
                        <option value="vgate">Sadece Vgate iCar / LELink Standart BLE</option>
                        <option value="nordic">Sadece Nordic UART (NUS) BLE Adaptör</option>
                        <option value="custom">Özel (Manuel UUID Girin)</option>
                      </select>
                      <p className="text-[10px] text-gray-500 leading-normal">
                        *Vgate iCar Pro, LELink, Carista, Veepeak vb. modeller için profili sabitleyebilirsiniz.
                      </p>
                    </div>

                    {/* Custom BLE Service inputs */}
                    <div className="space-y-2">
                      <label className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                        3. Özel BLE Servis UUID Tanımları
                      </label>
                      {bleProfile === "custom" ? (
                        <div className="space-y-1.5">
                          <div>
                            <label className="block text-[9px] text-gray-500 uppercase">Primary Service UUID</label>
                            <input
                              type="text"
                              value={customServiceUuid}
                              onChange={(e) => setCustomServiceUuid(e.target.value)}
                              placeholder="0000ffe0-0000-1000-8000-00805f9b34fb"
                              className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-2 py-1 text-[11px] text-white font-mono focus:border-cyan-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] text-gray-500 uppercase">Write Characteristic UUID</label>
                            <input
                              type="text"
                              value={customWriteCharUuid}
                              onChange={(e) => setCustomWriteCharUuid(e.target.value)}
                              placeholder="Karakteristik yazma UUID"
                              className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-2 py-1 text-[11px] text-white font-mono focus:border-cyan-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] text-gray-500 uppercase">Notify Characteristic UUID</label>
                            <input
                              type="text"
                              value={customNotifyCharUuid}
                              onChange={(e) => setCustomNotifyCharUuid(e.target.value)}
                              placeholder="Karakteristik bildirim UUID"
                              className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-2 py-1 text-[11px] text-white font-mono focus:border-cyan-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="bg-[#070B13]/40 p-2.5 rounded-lg border border-gray-800/40 text-[10px] text-gray-400 space-y-1.5">
                          <p><strong className="text-cyan-400">Vgate BLE Svc:</strong> 0000ffe0... | Char: 0000ffe1...</p>
                          <p><strong className="text-cyan-400">Nordic NUS Svc:</strong> 6e400001... | RX/TX Char...</p>
                          <p className="text-gray-500 leading-normal">Mevcut profil otomatik taranmaktadır. Özel bir gömülü BLE aygıtı kullanıyorsanız bu alanı 'Özel' yaparak UUID belirtebilirsiniz.</p>
                        </div>
                      )}
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
                  Araç beyninde <strong className="text-red-300">{dtcCodes.length} adet</strong> aktif hata kodu saptandı:
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
              Yapay Zeka Teşhisine Git
            </button>
          </motion.div>
        )}

        {/* INSTRUMENT PANEL */}
        <section className="bg-[#0B101D] border border-[#141B2D] rounded-2xl p-6 shadow-2xl relative" id="gauge_cluster">
          <div className="absolute top-3 right-4 flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-widest font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping" />
            CANLI OBD VERİLERİ ({activeProfile.name})
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
            
            {/* GAUGE 1: MOTOR DEVRİ */}
            <div className="flex flex-col items-center justify-center p-4 bg-[#070B13]/50 rounded-xl border border-gray-900 relative group overflow-hidden" id="gauge_rpm">
              <div className="absolute inset-0 bg-radial from-transparent to-[#070B13]/95 pointer-events-none" />
              <div className={`absolute -inset-10 bg-gradient-to-br transition-opacity duration-300 pointer-events-none opacity-5 ${
                isRedline ? "from-red-500 to-transparent" : "from-cyan-500 to-transparent"
              }`} />

              <div className="relative w-44 h-44 flex items-center justify-center">
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

                <div className="absolute inset-0 flex flex-col items-center justify-center text-center mt-2">
                  <Gauge className={`w-5 h-5 mb-1 ${isRedline ? "text-red-500 animate-bounce" : "text-cyan-400"}`} />
                  <span className="text-3xl font-mono font-bold tracking-tight text-white">
                    {rpm}
                  </span>
                  <span className={`text-[10px] tracking-wider uppercase font-semibold ${isRedline ? "text-red-400" : "text-gray-400"}`}>
                    d/d (RPM)
                  </span>
                </div>

                {isRedline && (
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-950 text-red-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-red-800 animate-pulse">
                    YÜKSEK DEVİR!
                  </div>
                )}
              </div>

              <div className="w-full flex justify-between items-center px-2 mt-2 border-t border-gray-900/60 pt-2 z-10">
                <span className="text-[11px] text-gray-500">Maks: 8000 RPM</span>
                <span className="text-[11px] text-gray-500">Rölanti: ~850 RPM</span>
              </div>
            </div>

            {/* GAUGE 2: ARAÇ HIZI */}
            <div className="flex flex-col items-center justify-center p-4 bg-[#070B13]/50 rounded-xl border border-gray-900 relative group overflow-hidden" id="gauge_speed">
              <div className="absolute inset-0 bg-radial from-transparent to-[#070B13]/95 pointer-events-none" />
              <div className="absolute -inset-10 bg-gradient-to-br from-blue-500 to-transparent transition-opacity duration-300 pointer-events-none opacity-5" />

              <div className="relative w-44 h-44 flex items-center justify-center">
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

              <div className="w-full flex justify-between items-center px-2 mt-2 border-t border-gray-900/60 pt-2 z-10">
                <span className="text-[11px] text-gray-500">Maks: 240 km/s</span>
                <span className="text-[11px] text-gray-500">Aktif Sürüş Hızı</span>
              </div>
            </div>

            {/* GAUGE 3: HARARET GÖSTERGESİ */}
            <div className="flex flex-col items-center justify-center p-4 bg-[#070B13]/50 rounded-xl border border-gray-900 relative group overflow-hidden" id="gauge_temp">
              <div className="absolute inset-0 bg-radial from-transparent to-[#070B13]/95 pointer-events-none" />
              <div className={`absolute -inset-10 bg-gradient-to-br transition-opacity duration-300 pointer-events-none opacity-5 ${
                isHighTemp ? "from-red-500 to-transparent" : "from-emerald-500 to-transparent"
              }`} />

              <div className="relative w-44 h-44 flex items-center justify-center">
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

              <div className="w-full flex justify-between items-center px-2 mt-2 border-t border-gray-900/60 pt-2 z-10">
                <span className="text-[11px] text-gray-500">Maks: 150 °C</span>
                <span className="text-[11px] text-gray-500">Normal: 80 - 95 °C</span>
              </div>
            </div>

          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 border-t border-gray-900 pt-4 text-center">
            <div className="p-2 bg-[#070B13]/30 rounded-lg border border-gray-900/50">
              <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Akü Voltajı</span>
              <span className="text-md font-mono font-bold text-amber-400">{voltage} V</span>
            </div>
            <div className="p-2 bg-[#070B13]/30 rounded-lg border border-gray-900/50">
              <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Aktif Adresleme (Headers)</span>
              <span className="text-md font-mono font-bold text-cyan-400">
                {isSimulator ? "SIM-MODE" : `CAN ATSH${activeProfile.moduleHeaders.engine}`}
              </span>
            </div>
            <div className="p-2 bg-[#070B13]/30 rounded-lg border border-gray-900/50">
              <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Filtreleme Modu</span>
              <span className="text-md font-mono font-bold text-blue-400">
                {selectedProfileId === "ford_mondeo_mk3" ? "HS/MS Dual-Bus" : "ISO-TP 500k"}
              </span>
            </div>
            <div className="p-2 bg-[#070B13]/30 rounded-lg border border-gray-900/50">
              <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-semibold">MIL Durumu</span>
              <span className={`text-md font-mono font-bold ${dtcCodes.length > 0 ? "text-red-500" : "text-emerald-400"}`}>
                {dtcCodes.length > 0 ? "⚠️ HATA KAYDI" : "✅ ARASIZ TEMİZ"}
              </span>
            </div>
          </div>
        </section>

        {/* TWO-COLUMN LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT COLUMN: CONTROL PANEL & SIMULATION DECK (5 Cols) */}
          <section className="lg:col-span-5 space-y-6">
            
            {/* VIRTUAL COMMAND / ACTUATOR TEST PANEL */}
            <div className="bg-[#0B101D] border border-cyan-950/40 rounded-2xl p-5 relative overflow-hidden" id="module_test_panel">
              <div className="absolute top-0 right-0 bg-cyan-500/10 text-cyan-400 text-[10px] font-mono px-2 py-0.5 rounded-bl border-l border-b border-cyan-950/40">
                MODÜL KONTROL
              </div>

              <h3 className="text-sm font-bold text-cyan-400 mb-2 flex items-center gap-1.5">
                <Settings2 className="w-4 h-4 text-cyan-400" />
                Sanal Beyin / Aktüatör Test Paneli
              </h3>
              
              <p className="text-[11px] text-gray-400 mb-4">
                Seçili araç profilindeki gömülü kontrol ünitelerine (<strong className="text-cyan-300">UCH / BCM / GEM</strong>) komut göndermeyi simüle eden geliştirici panelidir. Gönderilen CAN id filtrelemeleri ve hex çıktıları Terminalden izlenebilir.
              </p>

              {selectedProfileId === "ford_mondeo_mk3" ? (
                <div className="space-y-3" id="ford_commands">
                  <div className="bg-[#070B13]/60 p-3 rounded-lg border border-gray-800 space-y-2">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Ford Mondeo MK3 Özel Teşhisleri (GEM / ECU)</span>
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        onClick={() => handleExecuteModuleCmd(
                          "Gösterge Paneli İbre Sweep Testi", 
                          `ATSH${activeProfile.moduleHeaders.dashboard} -> 30 01 01`, 
                          "768 02 70 01 [OK - IBRE SWEEP TAMAMLANDI]"
                        )}
                        className="bg-cyan-950/30 hover:bg-cyan-900/30 text-cyan-300 border border-cyan-800/40 rounded-lg p-2 text-xs text-left transition-all flex items-center justify-between"
                      >
                        <div>
                          <div className="font-semibold">🚗 Gösterge Sweep (Self-Test)</div>
                          <div className="text-[10px] text-gray-500 font-mono">ATSH760 {">"} 300101</div>
                        </div>
                        <ChevronRight className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleExecuteModuleCmd(
                          "Radyatör Fan Eşik Değeri Aktivasyonu", 
                          `ATSH${activeProfile.moduleHeaders.engine} -> 30 02 03`, 
                          "728 02 70 02 [OK - FAN TETIK SENSÖR EŞİĞİ GÜNCELLENDİ]"
                        )}
                        className="bg-cyan-950/30 hover:bg-cyan-900/30 text-cyan-300 border border-cyan-800/40 rounded-lg p-2 text-xs text-left transition-all flex items-center justify-between"
                      >
                        <div>
                          <div className="font-semibold">⚡ Fan Düşük Hız Aktivasyonu</div>
                          <div className="text-[10px] text-gray-500 font-mono">ATSH720 {">"} 300203</div>
                        </div>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3" id="renault_commands">
                  <div className="bg-[#070B13]/60 p-3 rounded-lg border border-gray-800 space-y-2">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Megane 4 UCH / Konfor Beyni Parametre Testleri</span>
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        onClick={() => handleExecuteModuleCmd(
                          "Köşe Aydınlatması Dinamik Aktivasyonu", 
                          `ATSH${activeProfile.moduleHeaders.body} -> 30 11 A2`, 
                          "7B0 03 70 11 A2 [OK - KÖŞE AYDINLATMASI ETKINLEŞTİRİLDİ]"
                        )}
                        className="bg-cyan-950/30 hover:bg-cyan-900/30 text-cyan-300 border border-cyan-800/40 rounded-lg p-2 text-xs text-left transition-all flex items-center justify-between"
                      >
                        <div>
                          <div className="font-semibold">💡 Köşe Aydınlatma Aktivasyonu (BCM)</div>
                          <div className="text-[10px] text-gray-500 font-mono">ATSH7A0 {">"} 3011A2</div>
                        </div>
                        <ChevronRight className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleExecuteModuleCmd(
                          "Emniyet Kemeri Sesli İkaz İptali", 
                          `ATSH${activeProfile.moduleHeaders.body} -> 30 15 C1`, 
                          "7B0 03 70 15 C1 [OK - BUZZER DESKTOP DEVREDIŞI]"
                        )}
                        className="bg-cyan-950/30 hover:bg-cyan-900/30 text-cyan-300 border border-cyan-800/40 rounded-lg p-2 text-xs text-left transition-all flex items-center justify-between"
                      >
                        <div>
                          <div className="font-semibold">🔊 Emniyet Kemeri Uyarı Sesi İptali</div>
                          <div className="text-[10px] text-gray-500 font-mono">ATSH7A0 {">"} 3015C1</div>
                        </div>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Live result banner */}
              <AnimatePresence>
                {(isExecutingModuleCmd || moduleCmdResult) && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 p-2.5 rounded-lg border text-xs font-mono"
                    style={{
                      backgroundColor: isExecutingModuleCmd ? "rgba(14, 23, 38, 0.6)" : "rgba(6, 78, 59, 0.2)",
                      borderColor: isExecutingModuleCmd ? "#1e293b" : "#065f46"
                    }}
                  >
                    {isExecutingModuleCmd ? (
                      <div className="flex items-center gap-2 text-gray-400">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                        <span>Sorgu modüle gönderiliyor, CAN ID hizalanıyor...</span>
                      </div>
                    ) : (
                      <div className="text-emerald-400">
                        <div className="text-[10px] uppercase text-gray-500 font-sans font-bold">Alınan Modül Cevabı (RX):</div>
                        <div className="font-semibold text-xs mt-0.5">{moduleCmdResult}</div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* SENSORS SIMULATOR ADJUSTMENTS */}
            {isSimulator && (
              <div className="bg-[#0B101D] border border-amber-950/40 rounded-2xl p-5 relative overflow-hidden" id="simulator_deck">
                <div className="absolute top-0 right-0 bg-amber-500/10 text-amber-400 text-[10px] font-mono px-2 py-0.5 rounded-bl border-l border-b border-amber-950/40">
                  DÜZENEK KONTROLÜ
                </div>

                <h3 className="text-sm font-bold text-amber-400 mb-3 flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-amber-400" />
                  Sensör Simülatörü Sürgüleri
                </h3>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-300 font-medium flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-500" />
                        Gaz Pedalı Basıncı (Hız / RPM)
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
                      aria-label="Gaz Pedalı Basıncı"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-300 font-medium flex items-center gap-1">
                        <Thermometer className="w-3 h-3 text-red-500" />
                        Soğutma Suyu Sıcaklığı
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
                      aria-label="Sıcaklık Ayarı"
                    />
                  </div>

                  {/* Inject Malfunction Type Selector */}
                  <div className="space-y-1 pt-2 border-t border-gray-900">
                    <label htmlFor="sim_error_select" className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
                      Arıza Kodu Enjekte Et (DTC Injector)
                    </label>
                    <select
                      id="sim_error_select"
                      value={simErrorType}
                      onChange={handleMalfunctionChange}
                      className="w-full bg-[#070B13] border border-gray-800 rounded-lg px-3 py-2 text-xs text-amber-400 font-semibold focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                    >
                      <option value="NONE">✅ Herhangi bir arıza yok (Sistem Temiz)</option>
                      {activeProfile.defaultDtcList.map((dtc) => (
                        <option key={dtc} value={dtc}>
                          ⚠️ {dtc} - {DTC_DICTIONARY[dtc] || "Bilinmeyen Arıza"}
                        </option>
                      ))}
                      <option value="P0300">⚠️ P0300 - Rastgele/Çoklu Silindir Ateşleme Kaçırma</option>
                      <option value="P0171">⚠️ P0171 - Sistem Çok Fakir (Sıra 1)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ACTION TRIGGERS */}
            <div className="bg-[#0B101D] border border-gray-900 rounded-2xl p-5 space-y-3" id="quick_actions">
              <h3 className="text-sm font-bold text-gray-300 flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-cyan-400" />
                Hızlı Teşhis Fonksiyonları
              </h3>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleScanDtc}
                  disabled={isScanningDtc}
                  className="bg-[#0E1726] hover:bg-[#152238] border border-gray-800 hover:border-gray-700 text-white text-xs py-2 px-3 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all"
                  id="btn_scan_dtc"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isScanningDtc ? "animate-spin" : ""}`} />
                  Arıza Kodu Tara
                </button>

                <button
                  onClick={() => {
                    setDtcCodes([]);
                    setSimErrorType("NONE");
                    addLog("info", "ECU hata hafızası silme komutu gönderildi (PID: 04). Motor arıza lambası söndürüldü.");
                    alert("ECU Hata Hafızası Sıfırlandı. Motor Arıza Lambası (Check Engine) söndürüldü.");
                  }}
                  className="bg-[#0E1726] hover:bg-[#1B1212] border border-gray-800 hover:border-red-950 text-gray-300 hover:text-red-400 text-xs py-2 px-3 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all"
                  id="btn_clear_dtc"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-red-500" />
                  Hata Kodunu Sil
                </button>
              </div>

              {/* Scan Progress Bar */}
              <AnimatePresence>
                {isScanningDtc && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-1.5 pt-2"
                  >
                    <div className="flex justify-between items-center text-[10px] font-mono text-cyan-400">
                      <span>{scanMessage}</span>
                      <span>%{scanProgress}</span>
                    </div>
                    <div className="w-full bg-[#070B13] h-1.5 rounded-full overflow-hidden border border-gray-900">
                      <motion.div 
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${scanProgress}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </section>

          {/* RIGHT COLUMN: AI DIAGNOSTICS & REALTIME LOGS (7 Cols) */}
          <section className="lg:col-span-7 space-y-6">
            
            {/* GEMINI AI DIAGNOSIS PANEL */}
            <div className="bg-[#0B101D] border border-cyan-900/20 rounded-2xl p-5 shadow-xl relative overflow-hidden" id="ai_diagnosis_section">
              <div className="absolute top-0 right-0 bg-cyan-500/10 text-cyan-400 text-[10px] font-mono px-2 py-0.5 rounded-bl border-l border-b border-cyan-950/40">
                GEMINI AI INSIGHTS
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-cyan-500/10 rounded-lg border border-cyan-500/20 text-cyan-400">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Yapay Zeka Destekli Akıllı Teşhis</h3>
                  <p className="text-[11px] text-gray-400">Aracınızın sensör verilerini ve model kronik hatalarını analiz eder.</p>
                </div>
              </div>

              {/* Symptom/Observation Input */}
              <div className="space-y-2 mb-4" id="ai_user_inputs">
                <div className="flex justify-between items-center">
                  <label htmlFor="symptom_textarea" className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                    Araçtaki Belirtiler / Kullanıcı Gözlemleri
                  </label>
                  <span className="text-[10px] text-gray-500">Opsiyonel</span>
                </div>
                <textarea
                  id="symptom_textarea"
                  value={customDtc}
                  onChange={(e) => setCustomDtc(e.target.value)}
                  placeholder="Örn: Sabit hızda giderken tekleme yapıyor, egzozdan siyah duman atıyor..."
                  rows={2}
                  className="w-full bg-[#070B13] border border-gray-800 rounded-lg p-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <button
                onClick={handleAIAnalysis}
                disabled={isDiagnosing}
                className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all hover:shadow-lg hover:shadow-cyan-500/10 active:scale-95"
                id="btn_ai_analyse"
              >
                {isDiagnosing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Analiz Hazırlanıyor, Lütfen Bekleyin...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-amber-400" />
                    Yapay Zeka ile Analiz Et & Teşhis Raporu Üret
                  </>
                )}
              </button>

              {/* Diagnostic Errors */}
              {diagnosticError && (
                <div className="mt-4 p-3 bg-red-950/40 border border-red-500/20 rounded-lg text-red-400 text-xs">
                  <strong>Analiz Başarısız:</strong> {diagnosticError}
                </div>
              )}

              {/* Result Container */}
              {isDiagnosing && (
                <div className="mt-4 p-8 bg-[#070B13]/60 rounded-xl border border-gray-800 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
                    <Cpu className="w-5 h-5 text-cyan-400 absolute inset-0 m-auto animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Gemini Teşhis Motoru Çalışıyor</h4>
                    <p className="text-[10px] text-gray-500 mt-1 max-w-sm">
                      Sensör verileri, enjekte edilen hata kodları ve <strong className="text-cyan-400">{activeProfile.name}</strong> kronik sorun kalıpları eşleştiriliyor...
                    </p>
                  </div>
                </div>
              )}

              {diagnosis && !isDiagnosing && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 bg-[#070B13] border border-gray-800 rounded-xl p-4 overflow-y-auto max-h-[350px]"
                  id="ai_diagnosis_result"
                >
                  <div className="flex items-center justify-between border-b border-gray-800 pb-2 mb-3">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                      <CheckCircle className="w-4 h-4" />
                      YAPAY ZEKA TEŞHİS RAPORU HAZIR
                    </div>
                    <span className="text-[9px] font-mono text-gray-500">Gemini 3.8 Flash</span>
                  </div>
                  <div className="space-y-1">
                    {renderMarkdownText(diagnosis)}
                  </div>
                </motion.div>
              )}
            </div>

            {/* TERMINAL LOGS */}
            <div className="bg-[#0B101D] border border-gray-900 rounded-2xl p-5 shadow-md relative" id="terminal_logs">
              <div className="flex items-center justify-between border-b border-gray-900 pb-2 mb-3">
                <h3 className="text-xs font-bold text-gray-400 flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  OBD-II Hex & BLE Terminali
                </h3>
                <button
                  onClick={() => setLogs([])}
                  className="text-[10px] text-gray-500 hover:text-white transition-colors"
                >
                  Konsolu Temizle
                </button>
              </div>

              <div className="bg-[#070B13] border border-gray-950 rounded-lg p-3 font-mono text-[10px] space-y-1.5 max-h-[160px] overflow-y-auto flex flex-col-reverse">
                {logs.length === 0 ? (
                  <div className="text-gray-600 italic">Kayıt bulunmuyor...</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-1">
                      <span className="text-gray-600">[{log.timestamp}]</span>
                      {log.type === "tx" && (
                        <span className="text-blue-400 font-bold">TX {"->"}</span>
                      )}
                      {log.type === "rx" && (
                        <span className="text-emerald-400 font-bold">RX {"<-"}</span>
                      )}
                      {log.type === "error" && (
                        <span className="text-red-500 font-bold">[!]</span>
                      )}
                      {log.type === "info" && (
                        <span className="text-cyan-500 font-bold">[*]</span>
                      )}
                      <span className={
                        log.type === "tx" 
                          ? "text-blue-300" 
                          : log.type === "rx" 
                          ? "text-emerald-300 font-semibold" 
                          : log.type === "error" 
                          ? "text-red-300 font-semibold" 
                          : "text-gray-400"
                      }>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </section>

        </div>

      </main>

      {/* FOOTER */}
      <footer className="border-t border-[#141B2D] mt-12 py-6 bg-[#070B13] text-center text-xs text-gray-500 relative" id="app_footer">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 ALPAT. Tüm hakları saklıdır.</p>
          <div className="flex gap-4">
            <span className="hover:text-cyan-400 cursor-pointer">Kullanıcı Kılavuzu</span>
            <span className="hover:text-cyan-400 cursor-pointer">Gelişmiş Parametreler</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
