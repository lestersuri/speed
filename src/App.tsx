import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { MapPinOff, Navigation, AlertCircle, Sun, Moon, Volume2, VolumeX, Car, BellRing, Bug } from 'lucide-react';
import NoSleep from 'nosleep.js';

const COLOR_SCHEMES = [
  { id: 'default', name: 'Default' },
  { id: 'emerald', name: 'Neon Green', hexClass: 'bg-emerald-500', textClass: 'text-emerald-500' },
  { id: 'blue', name: 'Electric Blue', hexClass: 'bg-blue-500', textClass: 'text-blue-500' },
  { id: 'rose', name: 'Crimson Red', hexClass: 'bg-rose-500', textClass: 'text-rose-500' },
  { id: 'amber', name: 'Sunset Orange', hexClass: 'bg-amber-500', textClass: 'text-amber-500' },
  { id: 'purple', name: 'Deep Purple', hexClass: 'bg-purple-500', textClass: 'text-purple-500' },
];

// Haversine formula to calculate distance between two coordinates in meters
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [speedMs, setSpeedMs] = useState<number | null>(null);
  const [unit, setUnit] = useState<'kmh' | 'mph'>('kmh');
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [colorScheme, setColorScheme] = useState('default');
  
  // Speed Limit States
  const [speedLimitKmh, setSpeedLimitKmh] = useState<number | null>(null);
  const [isOverLimit, setIsOverLimit] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [isFetchingLimit, setIsFetchingLimit] = useState(false);
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastFetchRef = useRef<{ lat: number, lon: number, time: number } | null>(null);
  const lastBeepRef = useRef<number>(0);
  const watchIdRef = useRef<number | null>(null);
  const isSimulatingRef = useRef<boolean>(false);
  const isFetchingRef = useRef<boolean>(false);
  const wakeLockRef = useRef<any>(null);
  const noSleepRef = useRef<NoSleep | null>(null);

  useEffect(() => {
    noSleepRef.current = new NoSleep();
    return () => {
      if (noSleepRef.current) {
        noSleepRef.current.disable();
      }
    };
  }, []);

  const requestWakeLock = async () => {
    let nativeSuccess = false;

    // 1. Try native wake lock first (Chrome, Edge, Safari 16.4+)
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setIsWakeLockActive(true);
        nativeSuccess = true;
        
        wakeLockRef.current.addEventListener('release', () => {
          console.log('Native Screen Wake Lock released');
          setIsWakeLockActive(false);
        });
        console.log('Native Screen Wake Lock acquired');
      }
    } catch (err: any) {
      console.error(`Native wake lock failed: ${err.message}`);
    }

    // 2. Fallback to NoSleep.js (Older iOS Safari or if native fails)
    if (!nativeSuccess) {
      try {
        if (noSleepRef.current) {
          await noSleepRef.current.enable();
          setIsWakeLockActive(true);
          console.log('Wake lock enabled via NoSleep.js');
        }
      } catch (err: any) {
        console.error(`NoSleep wake lock failed: ${err.message}`);
        setIsWakeLockActive(false);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current !== null) {
      try {
        await wakeLockRef.current.release();
      } catch (e) {}
      wakeLockRef.current = null;
    }
    
    if (noSleepRef.current) {
      noSleepRef.current.disable();
    }
    
    setIsWakeLockActive(false);
    console.log('Wake lock disabled');
  };

  const initAudio = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextClass();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      setAudioEnabled(true);
    } catch (e) {
      console.error("Web Audio API not supported", e);
      setAudioEnabled(false);
    }
  };

  const playBeep = () => {
    if (!audioCtxRef.current || !audioEnabled) return;
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    
    const ctx = audioCtxRef.current;
    
    // Create a more noticeable, urgent two-tone alarm
    const playTone = (freq: number, startTime: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(freq, startTime);
      
      // Attack and release for a sharper sound
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.15, startTime + 0.05);
      gainNode.gain.setValueAtTime(0.15, startTime + duration - 0.05);
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    // Play a high-low-high pattern
    playTone(1200, now, 0.15);
    playTone(900, now + 0.2, 0.15);
    playTone(1200, now + 0.4, 0.15);
  };

  const checkSpeedLimit = async (lat: number, lon: number) => {
    if (isFetchingRef.current) return;

    const now = Date.now();
    if (lastFetchRef.current) {
      const dist = getDistance(lastFetchRef.current.lat, lastFetchRef.current.lon, lat, lon);
      const timeDiff = now - lastFetchRef.current.time;
      // Fetch if we moved more than 50 meters or 15 seconds have passed
      if (dist < 50 && timeDiff < 15000) return;
    }

    isFetchingRef.current = true;
    setIsFetchingLimit(true);
    lastFetchRef.current = { lat, lon, time: now };

    try {
      // Query Overpass API for nearest road with a maxspeed tag within 100 meters
      // The [out:json] must be the very first thing in the query
      const query = `[out:json][timeout:5];way(around:100,${lat},${lon})["maxspeed"];out tags;`;
      
      const endpoints = [
        'https://overpass-api.de/api/interpreter',
        'https://lz4.overpass-api.de/api/interpreter',
        'https://z.overpass-api.de/api/interpreter'
      ];
      
      let data = null;
      
      for (const endpoint of endpoints) {
        try {
          const controller = new AbortController();
          // 6 seconds timeout to match the 5s Overpass timeout + 1s buffer
          const timeoutId = setTimeout(() => controller.abort(), 6000);
          
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (res.ok) {
            data = await res.json();
            break; // Success, exit loop
          } else if (res.status === 429) {
            console.warn(`Endpoint ${endpoint} rate limited (429).`);
            // If rate limited, wait a bit before trying the next one
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (err) {
          console.warn(`Endpoint ${endpoint} failed, trying next...`);
        }
      }
      
      if (!data) {
        throw new Error("All Overpass API endpoints failed or timed out.");
      }
      
      if (data.elements && data.elements.length > 0) {
        const maxspeed = data.elements[0].tags.maxspeed;
        if (maxspeed.toLowerCase().includes('mph')) {
           const val = parseInt(maxspeed);
           if (!isNaN(val)) setSpeedLimitKmh(val * 1.60934);
        } else {
           const val = parseInt(maxspeed);
           if (!isNaN(val)) setSpeedLimitKmh(val);
        }
      } else {
        // No speed limit data found for this location
        setSpeedLimitKmh(null);
      }
    } catch (e) {
      console.error("Failed to fetch speed limit", e);
    } finally {
      isFetchingRef.current = false;
      setIsFetchingLimit(false);
    }
  };

  const runTestSimulation = async () => {
    // Block real GPS updates
    isSimulatingRef.current = true;
    
    // Set a fake speed of 65 mph (approx 29 m/s)
    setSpeedMs(29.0);
    
    // Hardcode the speed limit to 55 mph (88.5 km/h) for the simulation
    // This ensures the test works reliably without depending on OSM data availability
    setSpeedLimitKmh(88.5139);
    
    // Stop simulation after 15 seconds
    setTimeout(() => {
      isSimulatingRef.current = false;
      lastFetchRef.current = null;
      setSpeedLimitKmh(null);
      setSpeedMs(0);
    }, 15000);
  };

  useEffect(() => {
    if (!hasStarted) return;

    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setIsTracking(true);
    setError(null);
    
    // Handle visibility changes to re-request wake lock if needed
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && hasStarted) {
        // Note: this might fail on iOS without direct user interaction, 
        // but nosleep handles backgrounding better than native wakeLock
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (isSimulatingRef.current) return;
        
        const currentSpeed = position.coords.speed;
        setSpeedMs(currentSpeed !== null ? currentSpeed : 0);
        setError(null);
        
        // Check for speed limit updates
        checkSpeedLimit(position.coords.latitude, position.coords.longitude);
      },
      (err) => {
        let errorMsg = 'Unknown error';
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMsg = 'Location access denied';
            break;
          case err.POSITION_UNAVAILABLE:
            errorMsg = 'Location unavailable';
            break;
          case err.TIMEOUT:
            errorMsg = 'Location request timed out';
            break;
        }
        setError(errorMsg);
        setIsTracking(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000,
      }
    );

    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [hasStarted]);

  // Check if over limit and trigger beep
  useEffect(() => {
    if (speedLimitKmh && speedMs !== null) {
      const currentKmh = speedMs * 3.6;
      // Trigger alarm exactly at the limit value
      if (currentKmh >= speedLimitKmh) {
        setIsOverLimit(true);
        const now = Date.now();
        // Beep every 2 seconds while over limit
        if (now - lastBeepRef.current > 2000) {
          playBeep();
          lastBeepRef.current = now;
        }
      } else {
        setIsOverLimit(false);
      }
    } else {
      setIsOverLimit(false);
    }
  }, [speedMs, speedLimitKmh, audioEnabled]);

  const getDisplaySpeed = () => {
    if (speedMs === null) return 0;
    if (unit === 'kmh') {
      return Math.round(speedMs * 3.6);
    } else {
      return Math.round(speedMs * 2.23694);
    }
  };

  const displaySpeed = getDisplaySpeed();
  
  // Calculate progress for a circular gauge
  const maxSpeed = unit === 'kmh' ? 240 : 160;
  const progress = Math.min(displaySpeed / maxSpeed, 1);
  const radius = 120;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progress * circumference;

  // Theme classes
  const bgClass = isDarkMode ? 'bg-zinc-950' : 'bg-zinc-50';
  const textClass = isDarkMode ? 'text-white' : 'text-zinc-900';
  const cardBgClass = isDarkMode ? 'bg-zinc-900/80 border-zinc-800/80' : 'bg-white/80 border-zinc-200/80';
  const inactiveBtnClass = isDarkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600';
  const activeBtnClass = isDarkMode ? 'bg-white text-black shadow-md' : 'bg-zinc-900 text-white shadow-md';
  const emptyTrackClass = isDarkMode ? 'text-zinc-900' : 'text-zinc-200';
  const subTextClass = isDarkMode ? 'text-zinc-500' : 'text-zinc-400';

  const getActiveColorClass = () => {
    if (isOverLimit) return 'text-red-500'; // Override with red if over limit
    if (colorScheme === 'default') {
      return isDarkMode ? 'text-white' : 'text-zinc-900';
    }
    return COLOR_SCHEMES.find(s => s.id === colorScheme)?.textClass || 'text-white';
  };

  const activeColor = getActiveColorClass();

  const renderSpeedLimitSign = () => {
    const limitDisplay = speedLimitKmh 
      ? (unit === 'kmh' ? Math.round(speedLimitKmh) : Math.round(speedLimitKmh / 1.60934))
      : 0;

    const isUnknown = limitDisplay === 0;

    if (unit === 'kmh') {
      // EU Style Sign
      return (
        <motion.div 
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`w-16 h-16 rounded-full border-4 ${isUnknown ? 'border-zinc-300' : 'border-red-500'} bg-white flex items-center justify-center shadow-lg transition-colors`}
        >
          <span className={`${isUnknown ? 'text-zinc-400' : 'text-black'} font-bold text-2xl tracking-tighter transition-colors`}>{limitDisplay}</span>
        </motion.div>
      );
    } else {
      // US Style Sign
      return (
        <motion.div 
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`w-14 h-16 border-2 ${isUnknown ? 'border-zinc-300' : 'border-black'} bg-white flex flex-col items-center justify-center shadow-lg p-1 rounded-sm transition-colors`}
        >
          <span className={`${isUnknown ? 'text-zinc-400' : 'text-black'} font-bold text-[8px] leading-none text-center mb-0.5 transition-colors`}>SPEED<br/>LIMIT</span>
          <span className={`${isUnknown ? 'text-zinc-400' : 'text-black'} font-bold text-xl leading-none tracking-tighter transition-colors`}>{limitDisplay}</span>
        </motion.div>
      );
    }
  };

  // Start Screen
  if (!hasStarted) {
    return (
      <div className={`min-h-screen ${bgClass} ${textClass} flex flex-col items-center justify-center p-6 font-sans transition-colors duration-500`}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center text-center max-w-sm"
        >
          <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center mb-8 shadow-2xl border border-zinc-800">
            <Car size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold mb-3 tracking-tight">Minimalist Speedometer</h1>
          <p className={`${subTextClass} mb-10 text-sm leading-relaxed`}>
            Track your speed accurately via GPS. We'll also alert you if you exceed the local speed limit.
          </p>
          <button 
            onClick={() => {
              initAudio();
              requestWakeLock();
              setHasStarted(true);
            }}
            className="w-full bg-white text-black px-8 py-4 rounded-2xl font-bold text-lg shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Start Driving
          </button>
          <p className="text-xs text-zinc-500 mt-6">
            Requires location access to function.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bgClass} ${textClass} flex flex-col items-center justify-center p-6 font-sans transition-colors duration-500 selection:bg-zinc-500/30`}>
      {/* Header / Status */}
      <div className="absolute top-12 left-0 right-0 flex justify-between items-center px-8 max-w-md mx-auto w-full z-20">
        <div className="flex flex-col gap-2">
          {error ? (
            <div className="flex items-center gap-2 text-red-500 bg-red-500/10 px-3 py-1.5 rounded-full text-xs font-semibold border border-red-500/20">
              <MapPinOff size={14} />
              <span>{error}</span>
            </div>
          ) : isTracking ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-emerald-500 bg-emerald-500/10 px-3 py-1.5 rounded-full text-xs font-semibold border border-emerald-500/20">
                <Navigation size={14} className="animate-pulse" />
                <span>GPS Active</span>
              </div>
              {isWakeLockActive && (
                <div className="flex items-center gap-1 text-amber-500 bg-amber-500/10 px-2 py-1.5 rounded-full text-[10px] font-semibold border border-amber-500/20" title="Screen will stay awake">
                  <Sun size={12} />
                  <span>Awake</span>
                </div>
              )}
            </div>
          ) : (
            <div className={`flex items-center gap-2 ${isDarkMode ? 'text-zinc-400 bg-zinc-800/50 border-zinc-700/50' : 'text-zinc-500 bg-zinc-200/50 border-zinc-300/50'} px-3 py-1.5 rounded-full text-xs font-semibold border`}>
              <AlertCircle size={14} />
              <span>Locating...</span>
            </div>
          )}
          
          {isFetchingLimit && (
            <div className={`flex items-center gap-2 ${isDarkMode ? 'text-zinc-400' : 'text-zinc-500'} text-[10px] font-medium ml-1`}>
              <div className="w-2 h-2 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span>Updating limit...</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={runTestSimulation}
            className={`p-2 rounded-full transition-colors ${isDarkMode ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-600'}`}
            aria-label="Simulate Highway"
            title="Simulate Highway"
          >
            <Bug size={18} />
          </button>
          <button
            onClick={playBeep}
            className={`p-2 rounded-full transition-colors ${isDarkMode ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-600'}`}
            aria-label="Test Alarm"
            title="Test Alarm"
          >
            <BellRing size={18} />
          </button>
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`p-2 rounded-full transition-colors ${isDarkMode ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-600'}`}
            aria-label="Toggle audio alerts"
          >
            {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-2 rounded-full transition-colors ${isDarkMode ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-600'}`}
            aria-label="Toggle theme"
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </div>

      {/* Speed Limit Sign */}
      <div className="absolute top-28 right-8 z-20">
        {renderSpeedLimitSign()}
      </div>

      {/* Speedometer Gauge */}
      <div className="relative flex items-center justify-center w-80 h-80 mb-12 mt-8">
        {/* Background Circle */}
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 280 280">
          <circle
            cx="140"
            cy="140"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className={`${emptyTrackClass} transition-colors duration-500`}
          />
          {/* Progress Circle */}
          <motion.circle
            cx="140"
            cy="140"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            className={`${activeColor} transition-colors duration-500`}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ type: "spring", bounce: 0, duration: 0.8 }}
          />
        </svg>

        {/* Speed Display */}
        <div className="flex flex-col items-center justify-center z-10 mt-4">
          <motion.span 
            key={displaySpeed}
            initial={{ opacity: 0.8, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-8xl font-bold tracking-tighter tabular-nums ${activeColor} transition-colors duration-500`}
          >
            {displaySpeed}
          </motion.span>
          <span className={`${subTextClass} text-lg font-semibold tracking-widest uppercase mt-1 transition-colors duration-500`}>
            {unit === 'kmh' ? 'km/h' : 'mph'}
          </span>
        </div>
        
        {/* Over limit warning text */}
        {isOverLimit && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute -bottom-6 text-red-500 font-bold text-sm tracking-widest uppercase animate-pulse"
          >
            Slow Down
          </motion.div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center gap-6 w-full max-w-xs">
        {/* Unit Toggle */}
        <div className={`flex w-full p-1.5 rounded-2xl shadow-sm border backdrop-blur-md transition-colors duration-500 ${cardBgClass}`}>
          <button
            onClick={() => setUnit('kmh')}
            className={`flex-1 py-3 rounded-xl text-sm font-bold tracking-wide transition-all duration-300 ${
              unit === 'kmh' ? activeBtnClass : inactiveBtnClass
            }`}
          >
            KM/H
          </button>
          <button
            onClick={() => setUnit('mph')}
            className={`flex-1 py-3 rounded-xl text-sm font-bold tracking-wide transition-all duration-300 ${
              unit === 'mph' ? activeBtnClass : inactiveBtnClass
            }`}
          >
            MPH
          </button>
        </div>

        {/* Color Scheme Selector */}
        <div className="flex items-center justify-center gap-3 mt-2">
          {COLOR_SCHEMES.map((scheme) => {
            const isSelected = colorScheme === scheme.id;
            
            // Determine the visual color of the swatch
            let swatchBg = scheme.hexClass;
            if (scheme.id === 'default') {
              swatchBg = isDarkMode ? 'bg-white' : 'bg-zinc-900';
            }

            return (
              <button
                key={scheme.id}
                onClick={() => setColorScheme(scheme.id)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform duration-200 ${
                  isSelected ? 'scale-110 ring-2 ring-offset-2 ' + (isDarkMode ? 'ring-offset-zinc-950 ring-white/50' : 'ring-offset-zinc-50 ring-zinc-900/50') : 'hover:scale-110'
                }`}
                aria-label={`Select ${scheme.name} color scheme`}
              >
                <div className={`w-6 h-6 rounded-full ${swatchBg} shadow-sm`} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
